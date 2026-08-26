"""FAANG-convention filenames and tailored-resume proposals.

The proposal this builds is measured, not promised. Two things it will not do,
both of which are easy to get wrong here:

  * It never quotes an improved score it has not computed. A "+24 points"
    figure that is really a constant tells a candidate their resume got better
    when nothing was measured — and they will believe it, because the number
    looks like a measurement.
  * It never invents an achievement. Bullet rewrites go through
    services.stage_fixes, whose prompt forbids introducing a metric,
    technology or outcome the original does not already imply. A resume
    claiming "99.9% uptime" the candidate cannot defend in an interview is
    worse for them than a weaker line that is true.

What it does do is reorganise and re-word content the candidate already has,
and surface the gaps as things for them to decide about.
"""

import logging
import re

from sqlalchemy.orm import Session

from app.core.taxonomy import canonical, expand_skills, skill_candidates
from app.ml.features import extract_features
from app.ml.inference import model_available, predict_score
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import services

logger = logging.getLogger(__name__)

MAX_KEYWORDS = 12

# Filenames are read by recruiters and ATS ingestion alike; both cope badly
# with punctuation. Anything outside this set is dropped rather than escaped.
_UNSAFE = re.compile(r"[^A-Za-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")

# Kept short enough that the whole name stays under common filesystem limits
# once the four tokens and the extension are joined.
MAX_TOKEN_CHARS = 28


def sanitize_token(text: str | None, fallback: str = "UNKNOWN") -> str:
    """One uppercase, underscore-joined filename token.

    Returns the fallback rather than an empty string: a name like
    "LASTNAME__RESUME__GOOGLE.pdf" with a hole in it reads as a bug, and a
    leading underscore is worse than a placeholder that says what is missing.
    """
    cleaned = _UNSAFE.sub(" ", text or "")
    cleaned = _WHITESPACE.sub("_", cleaned.strip()).upper()
    cleaned = cleaned.strip("_")[:MAX_TOKEN_CHARS].strip("_")
    return cleaned or fallback


def split_name(full_name: str | None) -> tuple[str, str]:
    """(first, last) from a display name.

    Last name is the final whitespace-separated part — wrong for some naming
    conventions, but the alternative is asking for two fields the product does
    not otherwise need. Single-word names use the same value for both rather
    than inventing one.
    """
    parts = [p for p in (full_name or "").split() if p]
    if not parts:
        return "FIRSTNAME", "LASTNAME"
    if len(parts) == 1:
        return sanitize_token(parts[0], "FIRSTNAME"), sanitize_token(parts[0], "LASTNAME")
    return sanitize_token(parts[0], "FIRSTNAME"), sanitize_token(parts[-1], "LASTNAME")


def build_filename(full_name: str | None, job_title: str, company: str) -> str:
    """LASTNAME_FIRSTNAME_RESUME_ROLE_COMPANY.pdf"""
    first, last = split_name(full_name)
    return (
        f"{last}_{first}_RESUME_"
        f"{sanitize_token(job_title, 'ROLE')}_"
        f"{sanitize_token(company, 'COMPANY')}.pdf"
    )


def build_preview(
    db: Session,
    user_id: str,
    job_id: int,
    analysis_id: int,
    full_name: str | None,
    include_rewrites: bool = False,
) -> dict | None:
    """A tailoring proposal for one resume against one posting.

    Nothing is written to the database. The caller decides whether to act on
    this, which is the entire point of separating preview from compile.

    include_rewrites gates the one paid step: bullet suggestions cost a Claude
    call, so opening a preview is free and asking for rewrites is deliberate.
    """
    job = db.query(JobListing).filter(JobListing.id == job_id).first()
    if job is None:
        return None

    scan = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == user_id)
        .first()
    )
    if scan is None or not scan.resume_text:
        return None

    resume_text = scan.resume_text
    jd_text = job.description or ""

    # Both scores come from the same trained model on the same text. The
    # "current" figure is this resume against THIS posting — not the score
    # from whatever JD it was originally scanned against, which would make the
    # comparison meaningless.
    current_score = None
    semantic = None
    if model_available() and jd_text:
        current_score = round(float(predict_score(resume_text, jd_text)), 1)
        semantic = round(extract_features(resume_text, jd_text)["tfidf_cosine"] * 100, 1)

    staged = services.stage_fixes(
        resume_text, jd_text, experiences=None if not include_rewrites else []
    )
    missing = staged["missing_keywords"][:MAX_KEYWORDS]

    implied_pool = expand_skills(skill_candidates(resume_text))
    state_explicitly = [kw for kw in missing if canonical(kw) in implied_pool]
    genuine_gaps = [kw for kw in missing if kw not in state_explicitly]

    return {
        "job_id": job.id,
        "job_title": job.title,
        "company": job.company,
        "analysis_id": scan.id,
        "download_filename": build_filename(full_name, job.title, job.company),
        "original_resume_text": resume_text,
        # Measured against this posting. None when no model is on disk —
        # never a stand-in like 65.
        "current_score": current_score,
        "semantic_match": semantic,
        # Deliberately absent: there is no "projected_score". A number for a
        # resume that does not exist yet cannot be measured, and quoting one
        # would be a promise rather than a result. The score is recomputed for
        # real once the tailored version is compiled.
        "missing_keywords": genuine_gaps,
        "state_explicitly": state_explicitly,
        "bullet_suggestions": staged["bullet_suggestions"],
        "has_job_description": bool(jd_text),
    }
