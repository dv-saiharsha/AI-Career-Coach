from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.ratelimit import RateLimit
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import autofill, faang, optimizer, services, tailor
from app.modules.resume_builder.latex import LatexCompileError, LatexToolchainMissing
from app.schemas.resume_builder import (
    AutofillSchema,
    CompileResumeRequestSchema,
    CompileResumeResponseSchema,
    OptimizePlanByAnalysisRequestSchema,
    OptimizePlanRequestSchema,
    OptimizePlanSchema,
    QualityReportRequestSchema,
    QualityReportSchema,
    QuickTailorRequestSchema,
    QuickTailorResponseSchema,
    StageFixesRequestSchema,
    StageFixesResponseSchema,
    TailorHandoffRequestSchema,
    TailorHandoffSchema,
    TailorPreviewRequestSchema,
    TailorPreviewSchema,
)

HOUR = 3600

router = APIRouter()


@router.post("/stage-fixes/{analysis_id}", response_model=StageFixesResponseSchema)
def stage_fixes(
    analysis_id: int,
    payload: StageFixesRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_stage_fixes", 20, HOUR, "Too many fix requests. Try again in a while.")),
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


@router.post("/optimize-plan", response_model=OptimizePlanSchema)
def optimize_plan(
    payload: OptimizePlanRequestSchema,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """A scored, honest plan toward the target band for pasted-in text.

    See resume_builder/optimizer.py for what this can and cannot honestly
    promise. In short: it will not push a score past ~85, because past that
    point the trained model can no longer distinguish a real match from a
    keyword-stuffed one — measured, not assumed, in that module's docstring.
    Nothing here invents a metric, a tool, or an employer; every edit is
    licensed by the resume text it is scoring.
    """
    return optimizer.plan(payload.resume_text, payload.job_description)


@router.post("/optimize-plan/{analysis_id}", response_model=OptimizePlanSchema)
def optimize_plan_for_analysis(
    analysis_id: int,
    payload: OptimizePlanByAnalysisRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Same plan, against the resume already on file — no re-upload."""
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
    return optimizer.plan(record.resume_text, payload.job_description)


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


@router.post("/tailor-handoff", response_model=TailorHandoffSchema)
def tailor_handoff(
    payload: TailorHandoffRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_tailor", 20, HOUR, "Too many tailoring requests. Try again in a while.")),
):
    """What to change on this resume for this specific job.

    Free — keyword extraction and the trained model, no LLM call. Clicking a
    job card should not spend money, and bullet rewriting stays behind
    /stage-fixes where the user asks for it explicitly.

    404 covers both "no such job" and "not your resume": distinguishing them
    would confirm another user's scan exists.
    """
    result = tailor.build_handoff(db, current_user.id, payload.job_id, payload.analysis_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Job or resume not found")
    return result


@router.post("/tailor-preview", response_model=TailorPreviewSchema)
def tailor_preview(
    payload: TailorPreviewRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_tailor", 20, HOUR, "Too many tailoring requests. Try again in a while.")),
):
    """A tailoring proposal for one resume against one posting.

    Writes nothing. The stored resume is untouched until the user compiles an
    accepted version through /compile-and-score — separating proposal from
    commit is what makes the acceptance gate meaningful rather than cosmetic.

    Free unless include_rewrites is set, which spends one Claude call.
    """
    result = faang.build_preview(
        db, current_user.id, payload.job_id, payload.analysis_id,
        payload.full_name, payload.include_rewrites,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Job or resume not found")
    return result


@router.get("/autofill/{analysis_id}", response_model=AutofillSchema)
def autofill_from_scan(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Pre-fill the builder form from a resume the user already uploaded.

    Free — regex and section splitting, no LLM call and no scoring — so the
    form can populate on open without costing anything or making the user
    wait.

    Writes nothing. This re-reads text that is already stored and hands it
    back structured; the user edits it and only /compile-and-score produces a
    document. Nothing is corrected in place, so a bad parse costs an edit
    rather than corrupting the stored scan.
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
    return autofill.build_autofill(record.resume_text)


@router.post("/quick-tailor/{analysis_id}", response_model=QuickTailorResponseSchema)
def quick_tailor(
    analysis_id: int,
    payload: QuickTailorRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_quick_tailor", 15, HOUR, "Too many resumes generated. Try again in a while.")),
):
    """A finished FAANG-format resume from a scan already on file.

    One page by default; two for a candidate with enough history to fill
    them. The page count is achieved by compiling and measuring rather than
    assumed from the template — see resume_builder/fit.py — so the response
    reports what the compiler produced and what had to be trimmed to get
    there.

    Rate limited at 15/hour: no LLM call, but every attempt runs several
    tectonic compiles, which is real CPU on a shared worker.
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

    try:
        return services.quick_tailor(
            record,
            payload.full_name,
            payload.job_description,
            payload.target_pages,
        )
    except LatexToolchainMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
