"""Job card -> tailored resume handoff.

Given a cached listing and one of the user's own scans, this reports what the
posting asks for that the resume does not evidence, and re-scores the resume
against that specific job description.

What it deliberately does NOT do is write the resume for the candidate. The
gaps come back as suggestions to act on, not as bullets silently inserted into
a PDF: a resume that claims skills its owner cannot defend in an interview is
worse for them than one with an honest gap, and they are the only person who
knows which of these they actually have.

Compilation is therefore a separate, explicit step. `/compile-and-score`
already takes structured content the user has reviewed and produces the PDF —
this route hands it a starting point, it does not bypass it.
"""

import logging

from sqlalchemy.orm import Session

from app.core.taxonomy import expand_skills, group_by_domain, skill_candidates
from app.ml.features import extract_features
from app.ml.inference import model_available, predict_score
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import services

logger = logging.getLogger(__name__)

MAX_GAPS = 15


def build_handoff(db: Session, user_id: str, job_id: int, analysis_id: int) -> dict | None:
    """Gap analysis for one resume against one listing.

    Returns None when either record is missing or is not the caller's — the
    router turns that into a 404 rather than distinguishing "no such job" from
    "not yours", which would confirm the row exists.
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
    # The posting body, not the JD the resume was originally scanned against —
    # the whole point is re-targeting at this specific job.
    jd_text = job.description or ""

    # Free: keyword extraction and taxonomy, no LLM call. stage_fixes is called
    # without experiences so it stays on its no-cost path; bullet rewriting is
    # the user's explicit next step, not something to spend on every card click.
    staged = services.stage_fixes(resume_text, jd_text, experiences=None)
    missing = staged["missing_keywords"][:MAX_GAPS]

    # Skills the resume implies but never states. Distinct from a real gap:
    # the candidate has these, they just aren't written down where a keyword
    # search would find them — which is a much easier fix than acquiring a
    # skill, and shouldn't be presented as the same problem.
    implied_pool = expand_skills(skill_candidates(resume_text))
    from app.core.taxonomy import canonical

    implied = [kw for kw in missing if canonical(kw) in implied_pool]
    genuine_gaps = [kw for kw in missing if kw not in implied]

    # Score against THIS job, so the user can see the delta from their
    # original scan rather than a number computed against a different posting.
    targeted_score = None
    semantic = None
    if model_available() and jd_text:
        targeted_score = float(predict_score(resume_text, jd_text))
        semantic = round(extract_features(resume_text, jd_text)["tfidf_cosine"] * 100, 1)

    return {
        "job_id": job.id,
        "job_title": job.title,
        "company": job.company,
        "analysis_id": scan.id,
        "resume_filename": scan.resume_filename,
        # The score this resume gets against this posting. None when no model
        # is on disk — never a placeholder number.
        "targeted_ats_score": targeted_score,
        "semantic_match": semantic,
        # What the original scan scored, against whatever JD it used. Shown
        # beside the targeted score so the difference is visible.
        "original_ats_score": round(float(scan.ats_score), 1) if scan.ats_score is not None else None,
        # Terms the posting names that the resume neither states nor implies.
        "missing_keywords": genuine_gaps,
        # Terms the resume implies but never spells out. Easier to fix, and a
        # different kind of problem — an ATS keyword search still misses them.
        "state_explicitly": implied,
        "gaps_by_domain": group_by_domain(genuine_gaps),
        "has_job_description": bool(jd_text),
    }
