import base64
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.ratelimit import RateLimit
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.job import JobListing
from app.models.tailored_resume import TailoredResume
from app.modules.jd_analyzer import service as jd_service
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import autofill, cache, faang, matching, optimizer, outlook, saved, services, smart_tailor, tailor
from app.ml.inference import ScoringModelUnavailable, model_available, predict_score
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
    ResumeJobMatchRequestSchema,
    ReviewedPreviewSchema,
    SavedTailoredResumeSchema,
    SaveTailoredResumeRequestSchema,
    SmartTailorRequestSchema,
    SmartTailorResponseSchema,
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
    except ScoringModelUnavailable as exc:
        # 503 with a plain sentence: the server is missing its trained model
        # file (it is gitignored, so a fresh clone has none). Not a bug in the
        # request, and not the bare 500 it used to be.
        raise HTTPException(
            status_code=503,
            detail=(
                "This server doesn't have the ATS scoring model installed, so the resume "
                "can't be scored right now. Nothing you did caused this."
            ),
        ) from exc
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
    tectonic compiles, which is real CPU on a shared worker. When job_id is
    given, an identical (user, analysis, job, target_pages) request is served
    from resume_builder/cache.py instead — skipping every compile.
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

    jd_text = payload.job_description
    analysis_text = None
    if payload.job_id is not None:
        job = db.query(JobListing).filter(JobListing.id == payload.job_id).first()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        jd_text = job.description or ""
        # Looked up under the same text the listing was analysed with (title + description).
        analysis_text = jd_service.listing_text(job.title, job.description)

        cached = cache.get_cached(
            db, current_user.id, analysis_id, payload.job_id, "quick_tailor", payload.target_pages
        )
        if cached is not None:
            return {**cached, "from_cache": True}

    try:
        result = services.quick_tailor(
            record,
            payload.full_name,
            jd_text,
            payload.target_pages,
            accepted_skills=payload.accepted_skills,
            bullet_overrides=[b.model_dump() for b in payload.bullet_overrides],
            analysis_text=analysis_text,
        )
    except LatexToolchainMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if payload.job_id is not None:
        cache.put_cached(
            db, current_user.id, analysis_id, payload.job_id, "quick_tailor", result, payload.target_pages
        )
    return result


@router.post("/smart-tailor/{analysis_id}", response_model=SmartTailorResponseSchema)
def smart_tailor_resume(
    analysis_id: int,
    payload: SmartTailorRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_smart_tailor", 12, HOUR, "Too many tailoring requests. Try again in a while.")),
):
    """Tailor Resume: the full pipeline in smart_tailor.py — JD analysis,
    requirement matching, fact-checked rewrites, page fit, validation.

    Writes nothing but a cache row. The scan is read, never changed, so the
    original resume is always still there to tailor again or for another job.

    One LLM call (plus the JD analysis, unless that posting was analysed
    before), so it is rate limited like the other paid paths. A listing's
    result is cached per (user, scan, job, design, pages); a request that
    carries confirmed skills is not, since its output depends on them.
    """
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Resume scan not found")
    if not record.resume_text:
        raise HTTPException(
            status_code=400,
            detail="The original resume text isn't available for this scan. Please re-scan your resume.",
        )

    jd_text, analysis_text = payload.job_description, None
    job_title, company = payload.job_title.strip(), payload.company.strip()
    if payload.job_id is not None:
        job = db.query(JobListing).filter(JobListing.id == payload.job_id).first()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        jd_text = job.description or ""
        analysis_text = jd_service.listing_text(job.title, job.description)
        job_title, company = job.title or job_title, job.company or company
    if not (jd_text or "").strip():
        raise HTTPException(status_code=422, detail="Choose a job or paste a job description to tailor against.")

    kind = f"smart_tailor:{payload.design}"
    cacheable = payload.job_id is not None and not payload.confirmed_skills
    if cacheable:
        cached = cache.get_cached(db, current_user.id, analysis_id, payload.job_id, kind, payload.target_pages)
        if cached is not None:
            return {**cached, "from_cache": True}

    try:
        result = smart_tailor.tailor(
            record, jd_text, analysis_text=analysis_text, job_title=job_title, company=company,
            full_name=payload.full_name, design=payload.design, target_pages=payload.target_pages,
            confirmed_skills=payload.confirmed_skills, db=db,
        )
    except smart_tailor.TailorInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LatexToolchainMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        raise HTTPException(status_code=422, detail=f"The tailored resume failed to compile: {exc}") from exc

    if cacheable:
        cache.put_cached(db, current_user.id, analysis_id, payload.job_id, kind, result, payload.target_pages)
    return result


def _resume_for_user(db: Session, user_id: str, analysis_id: int) -> ResumeAnalysis:
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == user_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Resume scan not found")
    if not record.resume_text:
        raise HTTPException(
            status_code=400,
            detail="The resume text isn't available for this scan. Choose another resume or upload it again.",
        )
    return record


def _resolve_job_context(db: Session, payload) -> tuple[str, str, str, str | None]:
    if payload.job_id is not None:
        job = db.query(JobListing).filter(JobListing.id == payload.job_id).first()
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        description = (job.description or "").strip()
        if not description:
            raise HTTPException(status_code=422, detail="The source did not provide a job description.")
        return description, job.title, job.company, jd_service.listing_text(job.title, job.description)

    description = (payload.job_description or "").strip()
    title = (payload.job_title or "").strip()
    if not description or not title:
        raise HTTPException(status_code=422, detail="Enter a job title and full job description.")
    return description, title, (payload.company or "").strip(), None


def _saved_resume_payload(row: TailoredResume) -> dict:
    return {
        "id": row.id,
        "source_analysis_id": row.source_analysis_id,
        "job_id": row.job_id,
        "job_title": row.job_title,
        "company": row.company,
        "resume_filename": row.resume_filename,
        "score_before": row.score_before,
        "score_after": row.score_after,
        "score_change": outlook.score_change(row.score_before, row.score_after),
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "download_url": f"/resume-builder/saved-tailored/{row.id}/file",
    }


@router.post("/match/{analysis_id}")
def match_resume_to_job(
    analysis_id: int,
    payload: ResumeJobMatchRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_tailor", 30, HOUR, "Too many resume-match requests. Try again later.")),
):
    record = _resume_for_user(db, current_user.id, analysis_id)
    description, title, company, analysis_text = _resolve_job_context(db, payload)
    try:
        return matching.analyze_resume_job(
            record,
            description,
            job_title=title,
            company=company,
            analysis_text=analysis_text,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/preview-reviewed", response_model=ReviewedPreviewSchema)
def preview_reviewed_resume(
    payload: SaveTailoredResumeRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_preview_reviewed", 40, HOUR, "Too many preview updates. Try again in a while.")),
):
    """Compile and re-score the candidate's edits without saving them, so the
    preview and the score shown always match the text in the editor. No LLM
    call; one or more tectonic compiles, hence the rate limit."""
    record = _resume_for_user(db, current_user.id, payload.source_analysis_id)
    description, title, company, _analysis_text = _resolve_job_context(db, payload)
    try:
        compiled = saved.compile_reviewed_resume(
            payload.content.model_dump(), description, title, company, payload.target_pages
        )
    except LatexToolchainMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        raise HTTPException(status_code=422, detail=f"Resume failed to compile: {exc}") from exc
    score_before = round(float(predict_score(record.resume_text, description)), 1) if model_available() else None
    return {
        "pdf_base64": base64.b64encode(compiled["pdf_bytes"]).decode("ascii"),
        "page_count": compiled["page_count"],
        "target_pages": compiled["target_pages"],
        "fits": compiled["fits"],
        "adjustments": compiled["adjustments"],
        "filename": compiled["filename"],
        "score_before": score_before,
        "score_after": compiled["score"],
        "score_change": outlook.score_change(score_before, compiled["score"]),
    }


@router.post("/saved-tailored", response_model=SavedTailoredResumeSchema)
def save_tailored_resume(
    payload: SaveTailoredResumeRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("resume_quick_tailor", 15, HOUR, "Too many resumes saved. Try again later.")),
):
    record = _resume_for_user(db, current_user.id, payload.source_analysis_id)
    description, title, company, _analysis_text = _resolve_job_context(db, payload)
    try:
        compiled = saved.compile_reviewed_resume(
            payload.content.model_dump(), description, title, company, payload.target_pages
        )
    except LatexToolchainMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LatexCompileError as exc:
        raise HTTPException(status_code=422, detail=f"Resume failed to compile: {exc}") from exc

    score_before = round(float(predict_score(record.resume_text, description)), 1) if model_available() else None
    row = TailoredResume(
        user_id=current_user.id,
        source_analysis_id=record.id,
        job_id=payload.job_id,
        job_title=title,
        company=company or None,
        job_description=description,
        resume_filename=compiled["filename"],
        resume_text=compiled["resume_text"],
        resume_content=json.dumps(compiled["content"]),
        pdf_bytes=compiled["pdf_bytes"],
        score_before=score_before,
        score_after=compiled["score"],
        details_json=json.dumps({
            "design": payload.design,
            "target_pages": payload.target_pages,
            "page_count": compiled["page_count"],
            "fits": compiled["fits"],
            "adjustments": compiled["adjustments"],
        }),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _saved_resume_payload(row)


@router.get("/saved-tailored", response_model=list[SavedTailoredResumeSchema])
def list_saved_tailored_resumes(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    rows = (
        db.query(TailoredResume)
        .filter(TailoredResume.user_id == current_user.id)
        .order_by(TailoredResume.created_at.desc(), TailoredResume.id.desc())
        .all()
    )
    return [_saved_resume_payload(row) for row in rows]


@router.get("/saved-tailored/{tailored_id}/file")
def download_saved_tailored_resume(
    tailored_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = (
        db.query(TailoredResume)
        .filter(TailoredResume.id == tailored_id, TailoredResume.user_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Saved resume not found")
    return StreamingResponse(
        iter([row.pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{row.resume_filename}"'},
    )


@router.delete("/saved-tailored/{tailored_id}", status_code=204)
def delete_saved_tailored_resume(
    tailored_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = (
        db.query(TailoredResume)
        .filter(TailoredResume.id == tailored_id, TailoredResume.user_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Saved resume not found")
    db.delete(row)
    db.commit()
