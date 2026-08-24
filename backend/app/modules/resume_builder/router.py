from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import services
from app.modules.resume_builder.latex import LatexCompileError, LatexToolchainMissing
from app.schemas.resume_builder import (
    CompileResumeRequestSchema,
    CompileResumeResponseSchema,
    QualityReportRequestSchema,
    QualityReportSchema,
    StageFixesRequestSchema,
    StageFixesResponseSchema,
)

router = APIRouter()


@router.post("/stage-fixes/{analysis_id}", response_model=StageFixesResponseSchema)
def stage_fixes(
    analysis_id: int,
    payload: StageFixesRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if not record.resume_text:
        raise HTTPException(
            status_code=400,
            detail="The original resume text isn't available for this scan. Please re-scan your resume and try again.",
        )

    experiences = [e.model_dump() for e in payload.experiences] if payload.experiences else None
    return services.stage_fixes(record.resume_text, record.job_description, experiences)


@router.post("/quality-report", response_model=QualityReportSchema)
def quality_report(
    payload: QualityReportRequestSchema,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Bullet, section-context, and recency diagnostics.

    No LLM call and no scoring — pure text analysis, so this is free to call
    as often as the UI likes.
    """
    experiences = [e.model_dump() for e in payload.experiences]
    return services.quality_report(payload.resume_text, payload.job_description, experiences)


@router.post("/quality-report/{analysis_id}", response_model=QualityReportSchema)
def quality_report_for_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Same diagnostics against a stored scan, so the UI needn't re-send text.

    The original upload is read from resume_file_bytes — a column on the row,
    not a path on disk or an object key — so there is no missing-file case to
    handle, only a NULL one on scans that predate the column. Those still get
    text-based layout checks; only the column verdict goes to None.
    """
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if not record.resume_text:
        raise HTTPException(
            status_code=400,
            detail="The original resume text isn't available for this scan. Please re-scan your resume.",
        )
    return services.quality_report(
        record.resume_text, record.job_description, None, record.resume_file_bytes
    )


@router.post("/compile-and-score", response_model=CompileResumeResponseSchema)
def compile_and_score(
    payload: CompileResumeRequestSchema,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        return services.compile_and_score(payload.model_dump())
    except LatexToolchainMissing as exc:
        # 503, not 500: this is an environment/deployment gap ("tectonic
        # isn't installed here"), not a problem with the request or a bug —
        # the distinction matters for anyone monitoring error rates.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        # Message is latex.py's own trimmed log tail, not a raw exception
        # repr — no file paths, no command line, just the tectonic error.
        raise HTTPException(status_code=500, detail=f"Resume failed to compile: {exc}") from exc
