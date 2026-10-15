import io
import re
from typing import Callable

from app.core.llm import llm_client
from app.core.skill_match import mentions_any
from app.core.taxonomy import canonical, expand_skills, group_by_domain, skill_candidates
from app.modules.resume_analyzer import integrity, layout_check, quality
from app.ml.inference import model_available, predict_score
from app.modules.jd_analyzer import service as jd_service
from app.modules.jd_analyzer.schemas import JDAnalysis

SYSTEM_PROMPT = (
    "You are an ATS (applicant tracking system) resume screening engine combined with a "
    "career coach. First determine whether the uploaded document is actually a resume/CV "
    "at all — not a job description, cover letter, random document, or unrelated file. "
    "If it is not a resume, set is_resume to false and give the other fields reasonable "
    "empty/zero defaults, since they won't be used. If it is a resume, set is_resume to "
    "true and identify matched/missing/extracted skills, a keyword-frequency breakdown, "
    "and specific, actionable feedback. Never suggest adding a skill that already appears "
    "on the resume. Do not compute a numeric match score — that is "
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
    """Plain text from an uploaded resume.

    PDFs go through PyMuPDF rather than pdfplumber. That was a measured
    change, not a preference — on a 2-page resume pdfplumber takes 72ms
    against PyMuPDF's 2.3ms, and on an 8-page one 915ms against 13.7ms. The
    whole deterministic analysis path is budgeted at 100ms, so extraction
    alone was spending nine times that on a long document.

    Output is not merely close, it is token-identical: across two-column,
    ligature/unicode, table-grid, image-only and 8-page fixtures the
    whitespace-normalised text matches exactly. test_extraction.py holds that
    matrix so a future swap back has to argue with the numbers.

    The one case where they disagree, PyMuPDF is the correct one. pdfplumber
    reads rotated text backwards — a sidebar reading "SIDEBAR SKILLS Python Go
    Rust" came back as "RABEDIS SLLIKS nohtyP oG tsuR". Sidebar skill columns
    are common in modern resume templates, and hard_skill_match is the
    heaviest metric in the rubric at weight 30, so those candidates were being
    scored against reversed gibberish.

    Both extractors return empty for an image-only PDF, so the caller's
    "couldn't read any text from that file" refusal is unaffected.
    """
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        import fitz

        document = fitz.open(stream=content, filetype="pdf")
        try:
            return "\n".join(page.get_text("text") for page in document)
        finally:
            # Explicit rather than left to refcounting: fitz holds the page
            # buffer in C, where the GC's timing is not the process's memory
            # profile.
            document.close()
    if ext == "docx":
        import docx

        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    raise ValueError("Unsupported file type. Upload a PDF or DOCX resume.")


# Where ats_score came from. Returned with every scan so a number is never
# shown without saying what produced it.
SCORE_SOURCE_MODEL = "model"
SCORE_SOURCE_KEYWORDS = "keyword_fallback"


def _keyword_ratio(matched: list, missing: list) -> float:
    """Share of the job's keywords the resume covers, 0-100. The same figure
    on both paths, so a scan scores the same whichever one produced the lists."""
    return round(100 * len(matched) / ((len(matched) + len(missing)) or 1), 1)


def _score_with_source(resume_text: str, jd_text: str, fallback_ratio: float) -> tuple[float, str]:
    """ats_score always comes from the trained model when one exists — it's
    deterministic and free, unlike asking the LLM for a number. The keyword-
    ratio fallback only applies before anyone has ever run train_ats_model.py,
    and the second value says which of the two this is."""
    if model_available():
        return float(predict_score(resume_text, jd_text)), SCORE_SOURCE_MODEL
    return fallback_ratio, SCORE_SOURCE_KEYWORDS


def score_with_source(resume_text: str, jd_text: str, jd_analysis: JDAnalysis | None = None) -> tuple[float, str]:
    """The ATS score a scan gives, for any resume text: the trained model's when
    it is installed, otherwise the share of the job's keywords the resume covers
    (taxonomy-aware), with the second value saying which. Every flow that shows
    a before/after (match, tailor, preview, save) scores both sides with this
    and the same jd_analysis, so the two numbers are always comparable."""
    result = _rule_based_analysis(resume_text, jd_text, jd_analysis)
    return round(float(result["ats_score"]), 1), result["score_source"]


def _rule_based_analysis(resume_text: str, jd_text: str, jd_analysis: JDAnalysis | None = None) -> dict:
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
    # The keyword list the analysis yields (the older flat list, derived from
    # it); with no analysis, or a rules-only one, exactly skill_candidates.
    candidates = (
        jd_service.keywords_from(jd_analysis, jd_text, skill_candidates)
        if jd_analysis is not None
        else skill_candidates(jd_text)
    )
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
    ats_score, score_source = _score_with_source(resume_text, jd_text, round(100 * len(matched) / total, 1))
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
        "score_source": score_source,
        "missing_skills": missing[:15],
        "matched_skills": matched[:15],
        "extracted_skills": matched[:15],
        "keyword_analysis": keyword_analysis[:25],
        "suggestions": suggestions[:8],
    }


def _llm_analysis(resume_text: str, jd_text: str, jd_analysis: JDAnalysis | None = None) -> dict:
    # The job, already analysed: what it requires and what it only prefers, so
    # the model compares the resume against that and not against its own first
    # reading of the posting.
    summary = (
        f"STRUCTURED SUMMARY OF THE JOB:\n{jd_service.structured_summary(jd_analysis)}\n\n"
        if jd_analysis is not None and jd_analysis.source != "rules"
        else ""
    )
    user_prompt = (
        f"RESUME:\n{resume_text[:8000]}\n\n"
        f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\n"
        f"{summary}"
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
    # trained model is the sole, deterministic source of ats_score. Without a
    # model the score falls back to the keyword ratio, as on the rule-based
    # path; it used to fall back to 0.0 here, which a user reads as "your
    # resume matches nothing".
    data["ats_score"], data["score_source"] = _score_with_source(
        resume_text, jd_text, _keyword_ratio(data["matched_skills"], data["missing_skills"])
    )
    return data


def _drop_suggestions_naming_matched_skills(suggestions: list[str], matched_skills: list[str]) -> list[str]:
    """Remove suggestions that tell the candidate to add a skill they already
    have. The prompt asks the model not to, but a model that is told is not a
    model that complies, and "Consider adding Kubernetes" beside a matched
    Kubernetes is the kind of contradiction that makes the rest of the advice
    look untrustworthy. Checked here, against the final matched list."""
    if not matched_skills:
        return suggestions
    return [text for text in suggestions if not mentions_any(text, matched_skills)]


def _refresh_keyword_score(result: dict) -> dict:
    """Recompute a keyword-ratio score from the final skill lists. Reconciling
    moves skills from missing to matched after the score was first computed, so
    the ratio has to be taken afterwards. A model score is left alone."""
    if result.get("score_source") == SCORE_SOURCE_KEYWORDS:
        result["ats_score"] = _keyword_ratio(result.get("matched_skills") or [], result.get("missing_skills") or [])
    return result


def _reconcile_implied(resume_text: str, result: dict) -> dict:
    """Move skills the resume demonstrably has out of `missing_skills`.

    The LLM path builds its own skill lists, so without this the taxonomy only
    ever applied to the rule-based fallback — and since Claude is normally
    configured, the false negative it exists to fix (PyTorch listed, "deep
    learning" reported missing) would survive in production.

    Two different things can be hiding in `missing_skills`:

      * the resume WRITES the skill (the model simply got it wrong — a small
        local model does, now and then). It moves to matched with nothing said
        about it: there is nothing for the candidate to fix.
      * the resume only IMPLIES it. It moves to matched and is flagged, not
        silently merged: the candidate still needs to write the phrase down
        for a literal ATS search, so that one earns a suggestion.
    """
    implied_pool = expand_skills(skill_candidates(resume_text))
    still_missing, literal, newly_implied = [], [], []

    for skill in result.get("missing_skills") or []:
        if mentions_any(resume_text, [skill]):
            literal.append(skill)
        elif canonical(skill) in implied_pool:
            newly_implied.append(skill)
        else:
            still_missing.append(skill)

    if not literal and not newly_implied:
        return result

    result["missing_skills"] = still_missing
    result["matched_skills"] = (result.get("matched_skills") or []) + literal + newly_implied

    implied_set = {s.lower() for s in newly_implied}
    literal_set = {s.lower() for s in literal}
    for item in result.get("keyword_analysis") or []:
        keyword = item.get("keyword", "").lower()
        if keyword in implied_set:
            item["present"] = True
            item["implied"] = True
        elif keyword in literal_set:
            item["present"] = True
            item["implied"] = False
            item["frequency"] = max(int(item.get("frequency") or 0), 1)

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

    # Whether the score above can be believed. Measured, not assumed: the
    # trained model gives a verbatim copy of the posting 88 and a real resume
    # with quantified achievements 49, so a high ats_score is evidence of
    # keyword overlap and nothing else until something checks for repetition.
    # See integrity.py for the numbers.
    #
    # Attached beside the score for the same reason the rest of this function
    # is — the number stays what the model predicted, and this says how much
    # weight to put on it.
    score_integrity = integrity.assess(resume_text, jd_text)

    return {
        "score_integrity": score_integrity,
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


# The stages this function passes through, in order, as reported to on_stage.
# Named here rather than as string literals at each call so the client's
# checklist and the server's reality cannot drift apart silently.
SCAN_STAGES: tuple[str, ...] = (
    "extracting",
    "checking",
    "analyzing",
    "reconciling",
    "diagnostics",
)


def analyze_resume_against_job(
    filename: str,
    content: bytes,
    jd_text: str,
    on_stage: Callable[[str], None] | None = None,
) -> dict:
    """Score one resume against one job description.

    `on_stage` is called as each real step begins, and is how the UI reports
    genuine progress instead of narrating on a timer. It is optional and its
    failures are swallowed by the caller's bridge: a scan must not fail
    because nobody was listening to its progress.

    Honest about proportions, not just order — "analyzing" is the Claude call
    and is most of the wall time. Five stages do not mean five equal fifths,
    and the client is told which stage is the long one rather than being
    given a bar that implies otherwise.
    """
    def stage(name: str) -> None:
        if on_stage is not None:
            on_stage(name)

    stage("extracting")
    resume_text = extract_text(filename, content)
    if not resume_text.strip():
        raise ValueError("Couldn't read any text from that file. Try exporting it again as a text-based PDF.")
    if not jd_text.strip():
        raise ValueError("Paste the job description you're targeting.")
    # Cheap, free pre-filter — catches obviously-not-a-resume uploads (random
    # documents, images, empty files) before spending an LLM call on them.
    stage("checking")
    if not looks_like_resume(resume_text):
        raise NotAResumeError(NOT_A_RESUME_MESSAGE)

    # The job description is analysed first, once, and both paths below work
    # from the result. analyze() never raises: with no model it returns the
    # rules-only analysis, which keeps the older keyword list exactly.
    jd_analysis: JDAnalysis | None = None

    if llm_client.available:
        try:
            stage("analyzing")
            jd_analysis = jd_service.analyze(jd_text)
            result = _llm_analysis(resume_text, jd_text, jd_analysis)
            result["_source"] = "llm"
            result["jd_analysis"] = jd_analysis.model_dump(mode="json")
            result["resume_text"] = resume_text
            # Applied here too, not just on the fallback: this is the path
            # that actually runs in production.
            stage("reconciling")
            llm_suggestion_count = len(result["suggestions"])
            result = _reconcile_implied(resume_text, result)
            # Only what the model wrote is filtered; the "state it explicitly"
            # lines reconcile just added name matched skills on purpose.
            result["suggestions"] = (
                _drop_suggestions_naming_matched_skills(
                    result["suggestions"][:llm_suggestion_count], result["matched_skills"]
                )
                + result["suggestions"][llm_suggestion_count:]
            )
            result = _refresh_keyword_score(result)
            stage("diagnostics")
            result["diagnostics"] = build_diagnostics(resume_text, jd_text, result, content)
            return result
        except NotAResumeError:
            raise
        except Exception:
            pass  # fall through to rule-based scoring

    # The fallback path runs the same named stages, so a client that lost the
    # LLM mid-scan sees the checklist continue rather than stall on
    # "analyzing" while rule-based scoring quietly finishes the job.
    stage("analyzing")
    if jd_analysis is None:
        jd_analysis = jd_service.analyze(jd_text)
    result = _rule_based_analysis(resume_text, jd_text, jd_analysis)
    result["_source"] = "rules"
    result["jd_analysis"] = jd_analysis.model_dump(mode="json")
    result["resume_text"] = resume_text
    stage("diagnostics")
    result["diagnostics"] = build_diagnostics(resume_text, jd_text, result, content)
    return result
