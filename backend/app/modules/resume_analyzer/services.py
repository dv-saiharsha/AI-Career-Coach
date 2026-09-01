import io
import re

from app.core.llm import llm_client
from app.core.taxonomy import canonical, expand_skills, group_by_domain, skill_candidates
from app.modules.resume_analyzer import layout_check, quality
from app.ml.inference import model_available, predict_score

SYSTEM_PROMPT = (
    "You are an ATS (applicant tracking system) resume screening engine combined with a "
    "career coach. First determine whether the uploaded document is actually a resume/CV "
    "at all — not a job description, cover letter, random document, or unrelated file. "
    "If it is not a resume, set is_resume to false and give the other fields reasonable "
    "empty/zero defaults, since they won't be used. If it is a resume, set is_resume to "
    "true and identify matched/missing/extracted skills, a keyword-frequency breakdown, "
    "and specific, actionable feedback. Do not compute a numeric match score — that is "
    "handled separately by a dedicated scoring model."
)


class NotAResumeError(ValueError):
    """Raised when the uploaded document isn't actually a resume/CV."""


NOT_A_RESUME_MESSAGE = (
    "That doesn't look like a resume. Please upload your resume (PDF or Word .docx) to get an ATS match score."
)

# Cheap, free pre-filter before spending an LLM call: most real resumes have
# an email or phone number, or at least a couple of standard section headers.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(\+?\d[\d\-\s().]{7,}\d)")
_RESUME_SIGNAL_KEYWORDS = (
    "experience", "education", "skills", "employment", "work history", "summary",
    "objective", "projects", "certifications", "resume", "curriculum vitae",
    "references", "qualifications", "professional experience",
)


def looks_like_resume(text: str) -> bool:
    stripped = text.strip()
    if not (80 <= len(stripped) <= 30000):
        return False
    lower = stripped.lower()
    has_contact = bool(_EMAIL_RE.search(stripped)) or bool(_PHONE_RE.search(stripped))
    keyword_hits = sum(1 for kw in _RESUME_SIGNAL_KEYWORDS if kw in lower)
    return has_contact or keyword_hits >= 2


ANALYSIS_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "is_resume": {
            "type": "boolean",
            "description": "True if the uploaded document is actually a resume/CV, false otherwise",
        },
        "matched_skills": {"type": "array", "items": {"type": "string"}},
        "missing_skills": {"type": "array", "items": {"type": "string"}},
        "extracted_skills": {
            "type": "array",
            "items": {"type": "string"},
            "description": "All skills found on the resume",
        },
        "keyword_analysis": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string"},
                    "present": {"type": "boolean"},
                    "frequency": {"type": "integer"},
                },
                "required": ["keyword", "present", "frequency"],
            },
        },
        "suggestions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific, actionable resume improvements",
        },
    },
    "required": [
        "is_resume", "matched_skills", "missing_skills",
        "extracted_skills", "keyword_analysis", "suggestions",
    ],
}


def extract_text(filename: str, content: bytes) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        import pdfplumber

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n".join(parts)
    if ext == "docx":
        import docx

        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    raise ValueError("Unsupported file type. Upload a PDF or DOCX resume.")


def _score(resume_text: str, jd_text: str, fallback_ratio: float) -> float:
    """ats_score always comes from the trained model when one exists — it's
    deterministic and free, unlike asking the LLM for a number. The keyword-
    ratio fallback only applies before anyone has ever run train_ats_model.py."""
    if model_available():
        return float(predict_score(resume_text, jd_text))
    return fallback_ratio


def _rule_based_analysis(resume_text: str, jd_text: str) -> dict:
    """Keyword analysis with taxonomy-aware matching.

    A JD keyword counts as present when the resume states it literally OR when
    the resume's own skills imply it — a resume listing PyTorch matches a JD
    asking for "deep learning" rather than reporting it missing, which is the
    false negative flat substring matching produces.

    This affects only what the user is shown. app/ml/features.py keeps its own
    literal matching untouched, because the trained model was fit on that exact
    computation and changing it would create train/serve skew.
    """
    resume_lower = resume_text.lower()
    # Single tokens from the shared extractor, plus multi-word skills it can't
    # see ("deep learning", "rest apis") — without these the taxonomy never
    # fires on the phrases that most need it.
    candidates = skill_candidates(jd_text)
    resume_implied = expand_skills(skill_candidates(resume_text))

    matched, missing, keyword_analysis = [], [], []
    for kw in candidates:
        freq = resume_lower.count(kw.lower())
        node = canonical(kw)
        implied_only = freq == 0 and node in resume_implied
        present = freq > 0 or implied_only
        (matched if present else missing).append(kw)
        keyword_analysis.append({
            "keyword": kw,
            "present": present,
            "frequency": freq,
            # Distinguishes "you wrote this" from "your other skills imply
            # this" — the second still deserves a nudge to state it outright,
            # since a recruiter's literal search won't find it.
            "implied": implied_only,
        })

    total = len(candidates) or 1
    ats_score = _score(resume_text, jd_text, round(100 * len(matched) / total, 1))
    suggestions = [
        f'Add or emphasize "{kw}" — it appears in the job description but not your resume.'
        for kw in missing[:6]
    ]
    # An implied skill is a distinct, more encouraging fix: the candidate has
    # the capability but never wrote the phrase, and a recruiter's literal
    # keyword search will miss it.
    suggestions.extend(
        f'State "{item["keyword"]}" explicitly — your other skills imply it, but an ATS keyword '
        f"search only matches the literal phrase."
        for item in keyword_analysis
        if item["implied"]
    )
    if not suggestions:
        suggestions = ["Your resume covers the job description's key terms well. Focus next on quantifying your impact."]

    return {
        "ats_score": ats_score,
        "missing_skills": missing[:15],
        "matched_skills": matched[:15],
        "extracted_skills": matched[:15],
        "keyword_analysis": keyword_analysis[:25],
        "suggestions": suggestions[:8],
    }


def _llm_analysis(resume_text: str, jd_text: str) -> dict:
    user_prompt = (
        f"RESUME:\n{resume_text[:8000]}\n\n"
        f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\n"
        "Score how well the resume matches the job description as an ATS would."
    )
    data = llm_client.complete_tool_json(SYSTEM_PROMPT, user_prompt, "submit_analysis", ANALYSIS_TOOL_SCHEMA)
    if not data.get("is_resume", True):
        raise NotAResumeError(NOT_A_RESUME_MESSAGE)
    data.setdefault("matched_skills", [])
    data.setdefault("missing_skills", [])
    data.setdefault("extracted_skills", [])
    data.setdefault("keyword_analysis", [])
    data.setdefault("suggestions", [])
    # The LLM no longer produces a score at all (see SYSTEM_PROMPT) — the
    # trained model is the sole, deterministic source of ats_score.
    data["ats_score"] = _score(resume_text, jd_text, 0.0)
    return data


def _reconcile_implied(resume_text: str, result: dict) -> dict:
    """Move skills the resume demonstrably implies out of `missing_skills`.

    The LLM path builds its own skill lists, so without this the taxonomy only
    ever applied to the rule-based fallback — and since Claude is normally
    configured, the false negative it exists to fix (PyTorch listed, "deep
    learning" reported missing) would survive in production.

    Implied skills move to matched and are flagged, not silently merged: the
    candidate still needs to write the phrase down for a literal ATS search.
    """
    implied_pool = expand_skills(skill_candidates(resume_text))
    still_missing, newly_implied = [], []

    for skill in result.get("missing_skills") or []:
        if canonical(skill) in implied_pool:
            newly_implied.append(skill)
        else:
            still_missing.append(skill)

    if not newly_implied:
        return result

    result["missing_skills"] = still_missing
    result["matched_skills"] = (result.get("matched_skills") or []) + newly_implied

    implied_set = {s.lower() for s in newly_implied}
    for item in result.get("keyword_analysis") or []:
        if item.get("keyword", "").lower() in implied_set:
            item["present"] = True
            item["implied"] = True

    result["suggestions"] = (result.get("suggestions") or []) + [
        f'State "{skill}" explicitly — your other skills imply it, but an ATS keyword '
        f"search only matches the literal phrase."
        for skill in newly_implied
    ]
    return result


def build_diagnostics(
    resume_text: str, jd_text: str, result: dict, file_bytes: bytes | None = None
) -> dict:
    """Explanatory metadata for a scan.

    Deliberately returns no score. `result["ats_score"]` stays exactly what the
    trained model predicted — this is attached alongside it, never folded into
    it, so the number a user sees is always the one the model was measured on.
    """
    bullets = [
        line
        for line in resume_text.splitlines()
        if line.strip().startswith(("•", "-", "*", "–", "—")) and len(line.split()) > 3
    ]
    bullet_report = quality.evaluate_bullets(bullets)

    keyword_analysis = result.get("keyword_analysis") or []
    implied = [item["keyword"] for item in keyword_analysis if item.get("implied")]
    missing = result.get("missing_skills") or []

    # Structural readiness: does the document survive text extraction at all.
    # Independent of content — a resume can name every keyword the job asks for
    # and still be unreadable to a parser because it's two-column or a scan.
    #
    # file_bytes is the raw upload. Only a PDF yields a column verdict; for a
    # DOCX PyMuPDF can't open it, and layout_check reports the check as skipped
    # rather than guessing single-column.
    readiness = layout_check.inspect_ats_parsing_readiness(resume_text, file_bytes)

    return {
        "taxonomy_matched_skills": (result.get("matched_skills") or [])[:15],
        "taxonomy_missing_skills": missing[:15],
        "implied_skills": implied,
        "bullet_impact_rating": bullet_report["impact_rating"],
        "quantified_metrics_ratio": bullet_report["quantified_ratio"],
        "strong_verb_ratio": bullet_report["strong_verb_ratio"],
        "bullet_feedback": bullet_report["bullets"],
        "domain_gaps": group_by_domain(missing),
        "parsing_readiness": {
            "readiness_score": readiness["parsing_readiness_score"],
            "is_single_column": readiness["is_single_column"],
            "detected_headers": readiness["detected_headers"],
            # Kept as structured objects rather than flattened to strings: each
            # carries a severity and an actionable detail, and a bare list of
            # sentences would drop both.
            "formatting_warnings": readiness["warnings"],
            "column_check_skipped_reason": readiness["column_check_skipped_reason"],
            "extracted_characters": readiness["extracted_characters"],
        },
    }


def analyze_resume_against_job(filename: str, content: bytes, jd_text: str) -> dict:
    resume_text = extract_text(filename, content)
    if not resume_text.strip():
        raise ValueError("Couldn't read any text from that file. Try exporting it again as a text-based PDF.")
    if not jd_text.strip():
        raise ValueError("Paste the job description you're targeting.")
    # Cheap, free pre-filter — catches obviously-not-a-resume uploads (random
    # documents, images, empty files) before spending an LLM call on them.
    if not looks_like_resume(resume_text):
        raise NotAResumeError(NOT_A_RESUME_MESSAGE)

    if llm_client.available:
        try:
            result = _llm_analysis(resume_text, jd_text)
            result["_source"] = "llm"
            result["resume_text"] = resume_text
            # Applied here too, not just on the fallback: this is the path
            # that actually runs in production.
            result = _reconcile_implied(resume_text, result)
            result["diagnostics"] = build_diagnostics(resume_text, jd_text, result, content)
            return result
        except NotAResumeError:
            raise
        except Exception:
            pass  # fall through to rule-based scoring

    result = _rule_based_analysis(resume_text, jd_text)
    result["_source"] = "rules"
    result["resume_text"] = resume_text
    result["diagnostics"] = build_diagnostics(resume_text, jd_text, result, content)
    return result
