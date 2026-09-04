"""Fix-staging (missing keywords + bullet rewrite suggestions) and honest
re-scoring for the LaTeX resume builder.

Scoring deliberately does NOT introduce a new formula. ApplyCenter already has a
trained regression model (app/ml/inference.predict_score, MAE 7.3, R2 0.72 on
2,066 labeled examples) that is the authoritative ats_score everywhere else in
the product — resume_analyzer/services.py calls the same function. Compiling
a resume to a nicer PDF is not a reason for it to be scored by a different,
untrained method; that would make "before" and "after" numbers incomparable
and, worse, easy to inflate by construction. The one thing genuinely new here
is exposing tfidf_cosine (already computed by ml/features.py, feeding the
same trained model) as its own supporting figure, since it's a real computed
similarity — not a stand-in constant for something never actually calculated.
"""

import base64
import json
import logging

from app.core.llm import llm_client
from app.core.taxonomy import expand_skills, group_by_domain, skill_candidates_from_posting
from app.modules.resume_analyzer import layout_check, quality
from app.ml.features import extract_features
from app.ml.inference import predict_score
from app.modules.resume_builder import autofill, fit, guards, latex
from app.modules.resume_builder.latex import LatexCompileError, LatexToolchainMissing  # noqa: F401 (re-exported)

logger = logging.getLogger(__name__)

MAX_BULLET_SUGGESTIONS = 6

BULLET_REWRITE_SYSTEM_PROMPT = (
    "You are a resume writing coach. Given a candidate's current experience bullets, "
    "the job description they're targeting, and the keywords missing from their resume, "
    "suggest rewritten versions of the weakest bullets — ones that lack a quantified "
    "outcome (a number, percentage, or dollar amount) or don't use language from the job "
    "description. Each suggestion must describe the same real work the original bullet "
    "does; never invent a metric, technology, or outcome the original doesn't imply. If a "
    "bullet is already strong, don't suggest changing it — return fewer suggestions rather "
    "than force one on every bullet."
)

BULLET_SUGGESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "experience_index": {"type": "integer"},
                    "original": {"type": "string"},
                    "suggested": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["experience_index", "original", "suggested", "reason"],
            },
        }
    },
    "required": ["suggestions"],
}


def _resume_text_from_payload(data: dict) -> str:
    """Flatten the structured compile payload into plain text for scoring.

    Mirrors what PyMuPDF/python-docx extraction would produce from an
    uploaded file — line-separated prose — so the same trained model that
    scores an upload scores a compiled resume the same way.
    """
    lines: list[str] = [data.get("summary", "")]
    lines.extend(data.get("technical_skills") or [])
    lines.extend(data.get("tools_skills") or [])
    for exp in data.get("experiences") or []:
        lines.append(f"{exp.get('title', '')} {exp.get('company', '')}")
        lines.extend(exp.get("bullets") or [])
    for edu in data.get("education") or []:
        lines.append(f"{edu.get('degree', '')} {edu.get('institution', '')}")
    return "\n".join(line for line in lines if line)


def stage_fixes(resume_text: str, jd_text: str, experiences: list[dict] | None) -> dict:
    """Missing keywords (always, free) plus bullet rewrite suggestions
    (only if `experiences` is given and Claude is configured — one LLM
    call, same cost shape as the existing resume analyzer's per-request
    calls, not a batch operation)."""
    missing_keywords = [
        kw for kw in skill_candidates_from_posting(jd_text) if kw.lower() not in resume_text.lower()
    ]

    suggestions: list[dict] = []
    if experiences and llm_client.available:
        bullets_block = "\n".join(
            f"[{i}] {b}" for i, exp in enumerate(experiences) for b in exp.get("bullets", [])
        )
        if bullets_block:
            user_prompt = (
                f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\n"
                f"MISSING KEYWORDS:\n{', '.join(missing_keywords[:15]) or 'none'}\n\n"
                f"CURRENT BULLETS (indexed by experience entry):\n{bullets_block[:6000]}\n\n"
                "Suggest rewrites for the weakest bullets only."
            )
            try:
                result = llm_client.complete_tool_json(
                    BULLET_REWRITE_SYSTEM_PROMPT,
                    user_prompt,
                    "submit_bullet_suggestions",
                    BULLET_SUGGESTIONS_SCHEMA,
                )
                proposed = (result.get("suggestions") or [])[:MAX_BULLET_SUGGESTIONS]

                # The prompt above forbids inventing a metric or a technology.
                # This is where that is checked rather than trusted. Anything
                # asserting a figure the original bullet does not carry, or a
                # tool the resume never mentions, is dropped — not flagged,
                # because a rewrite shown with a caution still gets copied,
                # and the person copying it is the one who has to defend it.
                suggestions, rejected = guards.review_suggestions(proposed, resume_text)
                if rejected:
                    # Logged, never returned. The rate is worth watching: a
                    # model that starts failing this consistently is a prompt
                    # regression, and without a number nobody would notice.
                    logger.warning(
                        "Dropped %d of %d bullet rewrites that failed the fabrication check: %s",
                        len(rejected),
                        len(proposed),
                        "; ".join(
                            reason for item in rejected for reason in item.get("rejection", [])
                        )[:500],
                    )
            except Exception:
                # Same fall-through posture as resume_analyzer: a suggestion
                # feature failing shouldn't break the request, just return
                # fewer suggestions than requested.
                suggestions = []

    return {"missing_keywords": missing_keywords[:15], "bullet_suggestions": suggestions}


def compile_and_score(payload: dict) -> dict:
    """Render the resume to LaTeX, compile to PDF, and score it with the
    real trained model — the honest hybrid: a computed keyword overlap, a
    computed TF-IDF cosine, and a model-predicted score, no invented weights."""
    resume_text = _resume_text_from_payload(payload)
    jd_text = payload.get("job_description", "")

    tex_source = latex.render_resume_tex(payload)
    pdf_bytes = latex.compile_tex_to_pdf(tex_source)
    page_count = latex.count_pdf_pages(pdf_bytes)

    ats_score = predict_score(resume_text, jd_text)
    features = extract_features(resume_text, jd_text)

    return {
        "ats_score": ats_score,
        "semantic_match": round(features["tfidf_cosine"] * 100, 1),
        "keyword_matched_count": features["keyword_matched_count"],
        "keyword_total_count": features["jd_keyword_count"],
        "page_count": page_count,
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
    }


def parse_stored_result(result_json: str) -> dict:
    return json.loads(result_json)


def quality_report(
    resume_text: str,
    jd_text: str,
    experiences: list[dict] | None,
    file_bytes: bytes | None = None,
) -> dict:
    """Bullet, context, recency, and layout diagnostics for a resume.

    Returns no score. Everything here explains *why* a resume reads weak,
    which is the thing a single number can't do — ats_score stays with the
    trained model.

    file_bytes is the stored original upload. When absent (a scan predating
    the column, or a DOCX PyMuPDF cannot open), layout inspection still runs
    on the text: header detection and extractability need no coordinates, and
    only the column verdict goes to None.
    """
    experiences = experiences or []
    bullets = [b for exp in experiences for b in (exp.get("bullets") or [])]
    # Fall back to the raw text's own bullet lines when no structured
    # experience was supplied, so an uploaded resume still gets graded.
    if not bullets and resume_text:
        bullets = [
            line for line in resume_text.splitlines()
            if line.strip().startswith(("•", "-", "*", "–", "—")) and len(line.split()) > 3
        ]

    # skill_candidates, not keyword_candidates: the phrase-aware version, so
    # domain gaps report "deep learning" rather than the fragments "Deep" and
    # "Learning" landing in the Other bucket.
    jd_keywords = skill_candidates_from_posting(jd_text)
    contexts = [quality.skill_context(resume_text, kw) for kw in jd_keywords[:15]]
    missing = [c["skill"] for c in contexts if not c["found"]]

    readiness = layout_check.inspect_ats_parsing_readiness(resume_text, file_bytes)

    return {
        "bullets": quality.evaluate_bullets(bullets),
        "skill_contexts": contexts,
        "role_recency": quality.evaluate_recency(experiences),
        "parsing_readiness": {
            "readiness_score": readiness["parsing_readiness_score"],
            "is_single_column": readiness["is_single_column"],
            "detected_headers": readiness["detected_headers"],
            "formatting_warnings": readiness["warnings"],
            "column_check_skipped_reason": readiness["column_check_skipped_reason"],
            "extracted_characters": readiness["extracted_characters"],
        },
        # Grouped so a gap reads as "3 of 5 Cloud Infrastructure skills" rather
        # than as an unordered bag of words.
        "domain_gaps": group_by_domain(missing),
    }


def quick_tailor(record, full_name: str, jd_text: str, target_pages: int) -> dict:
    """A finished, page-fitted FAANG-format resume from a stored scan.

    Everything here comes out of the candidate's own uploaded resume:
    autofill parses it into structured sections, the JD decides which of
    their bullets lead, and fit.py compiles-and-measures until it is the
    requested length. Nothing is written for them — see fit.py's docstring
    for why there is no expansion ladder to match the trim ladder.

    The score is the trained model's, computed on the resulting text, so a
    candidate is told what their new resume actually scores rather than what
    the tailoring was supposed to achieve.
    """
    parsed = autofill.build_autofill(record.resume_text or "")
    stored = parse_stored_result(record.result_json or "{}")

    # Their matched skills lead, then the ones they staged as genuinely held.
    # Not the JD's full keyword list: that would put skills on the resume the
    # candidate never claimed, which is the one thing this must not do.
    technical = [s for s in (stored.get("matched_skills") or []) if s][:18]
    tools = [s for s in (stored.get("extracted_skills") or []) if s and s not in technical][:12]

    keywords = {k.lower() for k in expand_skills(skill_candidates_from_posting(jd_text))} if jd_text else set()

    payload = {
        "candidate_name": (full_name or "").strip() or parsed.get("name") or "Candidate",
        "email": parsed.get("email") or "",
        "phone": parsed.get("phone") or "",
        "location": parsed.get("location") or "",
        "linkedin": parsed.get("linkedin") or "",
        "summary": parsed.get("summary") or "",
        "technical_skills": technical,
        "tools_skills": tools,
        "experiences": parsed.get("experiences") or [],
        "education": parsed.get("education") or [],
    }

    fitted = fit.fit_to_pages(payload, target_pages, keywords)
    resume_text = _resume_text_from_payload(fitted["content"])

    return {
        "pdf_base64": base64.b64encode(fitted["pdf_bytes"]).decode("ascii"),
        "tex_source": fitted["tex"],
        "page_count": fitted["page_count"],
        "target_pages": target_pages,
        "fits": fitted["fits"],
        "adjustments": fitted["adjustments"],
        "ats_score": predict_score(resume_text, jd_text),
        # Imported here, not at module scope: faang imports this module, and
        # at the top level that is a cycle.
        "filename": _faang_filename(payload["candidate_name"]),
    }


def _faang_filename(full_name: str) -> str:
    """LASTNAME_FIRSTNAME_RESUME.pdf.

    build_filename also takes a role and a company, and there is neither on
    this path — the only thing available is the pasted job description, which
    is prose. Taking its first forty characters produced
    DOE_JANE_RESUME_SENIOR_BACKEND_ENGINEER_KUBE_COMPANY.pdf, truncated
    mid-word, with a literal "COMPANY" placeholder in it. A guess that looks
    like a mistake is worse than the shorter name, so the role and company
    are omitted rather than invented.
    """
    from app.modules.resume_builder import faang

    first, last = faang.split_name(full_name)
    return f"{last}_{first}_RESUME.pdf"
