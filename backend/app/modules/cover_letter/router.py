import base64
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.cover_letter import services, tex
from app.modules.resume_builder.latex import (
    LatexCompileError,
    LatexToolchainMissing,
    compile_tex_to_pdf,
)
from app.schemas.cover_letter import CoverLetterSchema, GenerateCoverLetterRequestSchema

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/generate", response_model=CoverLetterSchema)
def generate(
    payload: GenerateCoverLetterRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Draft a cover letter for one posting from one resume, and compile it.

    Costs one Claude call — roughly $0.017 at current pricing — so this is a
    deliberate action behind a button, never something a page fires on load.

    Writes nothing. The letter exists in the response and in whatever the user
    downloads; nothing is stored, so regenerating with a different tone
    replaces nothing and costs another call.

    404 covers both "no such job" and "not your resume". Distinguishing them
    would confirm another user's scan exists.
    """
    job = db.query(JobListing).filter(JobListing.id == payload.job_id).first()
    scan = (
        db.query(ResumeAnalysis)
        .filter(
            ResumeAnalysis.id == payload.analysis_id,
            ResumeAnalysis.user_id == current_user.id,
        )
        .first()
    )
    if job is None or scan is None:
        raise HTTPException(status_code=404, detail="Job or resume not found")
    if not scan.resume_text:
        raise HTTPException(
            status_code=400,
            detail="The original resume text isn't available for this scan. Please re-scan your resume.",
        )
    if not (job.description or "").strip():
        # Without the posting there is nothing to tailor to, and a letter
        # written from the title alone is a template with a company name in
        # it. Better to say so than to bill for one.
        raise HTTPException(
            status_code=400,
            detail="This listing was cached without its description, so there's nothing to tailor a letter to.",
        )

    try:
        draft = services.generate_letter(
            resume_text=scan.resume_text,
            job_title=job.title,
            company=job.company,
            job_description=job.description,
            tone=payload.tone,
        )
    except RuntimeError as exc:
        # 503 rather than 500: the key is missing from the environment, which
        # is a deployment gap, not a bad request or a bug.
        raise HTTPException(
            status_code=503,
            detail="Cover letter generation isn't configured on this server.",
        ) from exc

    pdf_base64 = None
    try:
        source = tex.render_cover_letter_tex(
            candidate_name=payload.full_name or "Candidate",
            contact_line=tex.contact_line(current_user.email, payload.phone, payload.linkedin),
            company=job.company,
            job_title=job.title,
            paragraphs=draft["paragraphs"],
        )
        pdf_base64 = base64.b64encode(compile_tex_to_pdf(source)).decode()
    except (LatexToolchainMissing, LatexCompileError) as exc:
        # The letter text is returned regardless. The Claude call has already
        # been paid for, and the user can copy the paragraphs even if this
        # server cannot produce a PDF — losing the draft over a missing
        # binary would waste their money as well as their time.
        logger.warning("Cover letter compiled to text but not PDF: %s", exc)

    return {
        "job_id": job.id,
        "analysis_id": scan.id,
        "job_title": job.title,
        "company": job.company,
        "tone": draft["tone"],
        "download_filename": services.build_filename(payload.full_name, job.title, job.company),
        "paragraphs": draft["paragraphs"],
        "grounded_in": draft["grounded_in"],
        "unsupported_claims": draft["unsupported_claims"],
        "pdf_base64": pdf_base64,
    }
