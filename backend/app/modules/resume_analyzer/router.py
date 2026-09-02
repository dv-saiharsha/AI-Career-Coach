import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.ratelimit import check_rate_limit
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.modules.notifications.service import notify_resume_scanned
from app.modules.resume_analyzer import integrity, parse_checks, review, rubric
from app.modules.resume_analyzer.report import build_report_pdf, build_updated_resume_pdf
from app.modules.resume_analyzer.services import (
    NOT_A_RESUME_MESSAGE,
    analyze_resume_against_job,
    extract_text,
    looks_like_resume,
)
from app.schemas.resume import (
    RescanRequest,
    AnalysisResultSchema,
    GenerateResumeRequestSchema,
    ResumeHistoryItemSchema,
    ScoreBreakdownSchema,
)
from app.schemas.resume_review import ResumeReviewSchema

router = APIRouter()

_MODEL_METADATA_PATH = Path(__file__).resolve().parents[3] / "app" / "ml" / "models" / "ats_model_metadata.json"

# /analyze calls Claude (or, on failure, the free rule-based fallback) — real
# per-call cost with no other ceiling on it. 20/hour is generous for
# iterating on one resume across several job descriptions in a sitting while
# still bounding worst-case spend from one account.
MAX_ANALYSES_PER_WINDOW = 20
ANALYSIS_WINDOW_SECONDS = 3600

# Read fully into memory before parsing (PyMuPDF/python-docx have no
# streaming API this project uses) — bounded so a very large or repeated
# upload can't exhaust worker memory or get handed wholesale to a PDF parser
# with no size floor.
MAX_RESUME_UPLOAD_BYTES = 10 * 1024 * 1024


@router.get("/model-info")
def model_info():
    """Public-ish diagnostic: when the live scoring model was last trained, on
    how much data, and its measured accuracy — so this isn't a black box."""
    if not _MODEL_METADATA_PATH.exists():
        raise HTTPException(status_code=404, detail="No trained model yet — scores are using the fallback scorer.")
    return json.loads(_MODEL_METADATA_PATH.read_text(encoding="utf-8"))


@router.post("/analyze", response_model=AnalysisResultSchema)
async def analyze_resume(
    background_tasks: BackgroundTasks,
    resume: UploadFile = File(...),
    job_description: str = Form(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    if not check_rate_limit(f"resume_analyze:{current_user.id}", MAX_ANALYSES_PER_WINDOW, ANALYSIS_WINDOW_SECONDS):
        raise HTTPException(status_code=429, detail="Too many resume scans. Try again in a while.")

    content = await resume.read()
    if len(content) > MAX_RESUME_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large. Resumes should be under 10MB.")
    try:
        result = analyze_resume_against_job(resume.filename or "resume", content, job_description)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Read before this scan is saved, so it's genuinely the *previous* one —
    # the notification below compares against it.
    previous = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == current_user.id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )

    resume_text = result.pop("resume_text", "")
    record = ResumeAnalysis(
        user_id=current_user.id,
        resume_filename=resume.filename or "resume",
        job_description=job_description,
        ats_score=result["ats_score"],
        result_json=json.dumps(result),
        resume_text=resume_text,
        resume_file_bytes=content,
    )
    db.add(record)

    # Record this as the account's resume on file.
    #
    # It was only ever set by the onboarding upload, so anyone who skipped
    # that step and scanned through the analyzer instead had a scored resume
    # and a profile that still said they had none. The dashboard reads this
    # field to decide whether to ask for one, so they were asked again on
    # every visit, underneath their own score.
    #
    # Always the latest scan rather than only the first: the newest upload is
    # the one the candidate is working on, and "your resume on file" showing
    # something from three weeks ago is worse than showing nothing.
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
    if profile is not None:
        profile.primary_resume_filename = record.resume_filename

    db.commit()
    db.refresh(record)

    notify_resume_scanned(
        db, current_user.id,
        analysis_id=record.id,
        new_score=float(record.ats_score),
        previous_score=float(previous.ats_score) if previous else None,
        latest_band=rubric.band(record.ats_score),
        background_tasks=background_tasks,
    )

    return {**result, "id": record.id, "created_at": record.created_at.isoformat()}


@router.get("/on-file")
def resume_on_file(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """What resume this account already has, if any.

    Exists so the analyzer can offer to re-use it instead of asking for the
    same file again. Re-uploading an unchanged CV to score it against a
    different posting is work the product was making people do for no reason,
    and it stored another copy of identical bytes every time.

    `can_rescan` is separate from `has_resume` on purpose: rows created before
    the bytes were retained carry a filename and a score but nothing to scan
    again, and offering a button that cannot work is worse than not offering
    one.
    """
    latest = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == current_user.id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )
    if latest is None:
        return {"has_resume": False, "can_rescan": False}

    return {
        "has_resume": True,
        "analysis_id": latest.id,
        "filename": latest.resume_filename,
        "ats_score": round(float(latest.ats_score), 1) if latest.ats_score is not None else None,
        "band": rubric.band(latest.ats_score),
        "scanned_at": latest.created_at.isoformat() if latest.created_at else None,
        # Truncated: this is a reminder of what it was scored against, not the
        # posting itself, and a full JD in a status line is unreadable.
        "scanned_against": (latest.job_description or "")[:120] or None,
        "size_bytes": len(latest.resume_file_bytes) if latest.resume_file_bytes else None,
        "can_rescan": bool(latest.resume_file_bytes),
    }


@router.post("/rescan")
def rescan_stored_resume(
    background_tasks: BackgroundTasks,
    payload: RescanRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Score the resume already on file against a new job description.

    Same rate limit as /analyze — it is the same amount of work and the same
    LLM call, and exempting it would leave an unmetered path to the expensive
    operation the limit exists to bound.
    """
    if not check_rate_limit(
        f"resume_analyze:{current_user.id}", MAX_ANALYSES_PER_WINDOW, ANALYSIS_WINDOW_SECONDS
    ):
        raise HTTPException(status_code=429, detail="Too many resume scans. Try again in a while.")

    latest = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == current_user.id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )
    if latest is None or not latest.resume_file_bytes:
        raise HTTPException(
            status_code=404,
            detail="No stored resume to re-scan. Upload your CV once and this will work from then on.",
        )

    try:
        result = analyze_resume_against_job(
            latest.resume_filename or "resume",
            latest.resume_file_bytes,
            payload.job_description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record = ResumeAnalysis(
        user_id=current_user.id,
        resume_filename=latest.resume_filename,
        job_description=payload.job_description,
        ats_score=result["ats_score"],
        result_json=json.dumps({k: v for k, v in result.items() if k != "resume_text"}),
        resume_text=result.get("resume_text", ""),
        # Carried forward rather than re-read: it is the same document, and a
        # re-scan that dropped the bytes would silently make the next re-scan
        # impossible.
        resume_file_bytes=latest.resume_file_bytes,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    notify_resume_scanned(
        db,
        current_user.id,
        analysis_id=record.id,
        new_score=float(record.ats_score),
        previous_score=float(latest.ats_score) if latest.ats_score is not None else None,
        latest_band=rubric.band(record.ats_score),
        background_tasks=background_tasks,
    )

    payload_out = {k: v for k, v in result.items() if k != "resume_text"}
    return {**payload_out, "id": record.id, "created_at": record.created_at.isoformat()}


@router.get("/history", response_model=list[ResumeHistoryItemSchema])
def list_analyses(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)):
    rows = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == current_user.id)
        .order_by(ResumeAnalysis.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "resume_filename": r.resume_filename,
            "ats_score": r.ats_score,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/report/{analysis_id}")
def download_report(
    analysis_id: int, db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)
):
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = json.loads(record.result_json)
    pdf_bytes = build_report_pdf(record, result)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=resume-report-{analysis_id}.pdf"},
    )


@router.get("/file/{analysis_id}")
def download_original_resume(
    analysis_id: int, db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)
):
    """The candidate's own uploaded file, byte-for-byte.

    Distinct from /report, which is a generated feedback PDF. This is what
    they gave us, so it must come back unaltered — the whole point of "view my
    resume" is confirming what was actually scanned.
    """
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if not record.resume_file_bytes:
        # Scans from before resume_file_bytes existed have no original to
        # return. 404 with a reason beats an empty download.
        raise HTTPException(
            status_code=404,
            detail="The original file wasn't kept for this scan. Re-upload it to view it here.",
        )

    filename = record.resume_filename or f"resume-{analysis_id}"
    media_type = (
        "application/pdf"
        if filename.lower().endswith(".pdf")
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return StreamingResponse(
        iter([record.resume_file_bytes]),
        media_type=media_type,
        # inline so a PDF opens in the browser's viewer rather than forcing a
        # download the user then has to find on disk.
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/{analysis_id}", status_code=204)
def delete_analysis(
    analysis_id: int, db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)
):
    """Delete one scan and everything that pointed at it.

    profiles.primary_resume_analysis_id is a plain integer with no foreign
    key, so nothing at the database level stops it referencing a row that no
    longer exists. Left dangling, the dashboard would keep showing a score for
    a deleted resume and the onboarding reminder would never reappear. Both
    the id and the cached filename are cleared here.
    """
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == analysis_id, ResumeAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        # Ownership is part of the lookup, so another user's scan is
        # indistinguishable from one that never existed.
        raise HTTPException(status_code=404, detail="Analysis not found")

    profile = (
        db.query(Profile)
        .filter(
            Profile.user_id == current_user.id,
            Profile.primary_resume_analysis_id == analysis_id,
        )
        .first()
    )
    if profile:
        profile.primary_resume_analysis_id = None
        profile.primary_resume_filename = None

    db.delete(record)
    db.commit()


@router.post("/generate/{analysis_id}")
def generate_updated_resume(
    analysis_id: int,
    payload: GenerateResumeRequestSchema,
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

    result = json.loads(record.result_json)
    missing = set(result.get("missing_skills") or [])
    skills_to_add = [s for s in payload.skills_to_add if s in missing]

    pdf_bytes = build_updated_resume_pdf(record, payload.full_name.strip() or "Candidate", skills_to_add)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=updated-resume-{analysis_id}.pdf"},
    )


@router.get("/breakdown/{analysis_id}", response_model=ScoreBreakdownSchema)
def score_breakdown(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Deterministic sub-scores and parse checks for a stored scan.

    Free — no LLM call and no model retraining; the model score is read from
    the row rather than recomputed. Writes nothing.

    Returns two numbers deliberately. model_score is the trained model's
    prediction and stays authoritative across the product; rubric_total is a
    weighted sum of measurable properties that can be inspected line by line.
    Presenting the breakdown as though it decomposed the model's score would
    be false — the model is not a weighted sum of these seven things, and
    bars that silently failed to add up to the headline would be worse than
    two clearly labelled figures.
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

    stored = json.loads(record.result_json) if record.result_json else {}
    breakdown = rubric.build_breakdown(
        record.resume_text,
        record.job_description or "",
        # No job title is stored on a scan, so title alignment is skipped
        # rather than guessed out of the description — a title scavenged from
        # a responsibilities paragraph would be scored against as if it were
        # the role.
        jd_title=None,
        pdf_bytes=record.resume_file_bytes,
    )

    return {
        "analysis_id": record.id,
        "resume_filename": record.resume_filename,
        "model_score": round(float(record.ats_score or 0), 1),
        "score_integrity": integrity.assess(record.resume_text, record.job_description or ""),
        **breakdown,
        "parse_checks": parse_checks.build_checks(record.resume_text, record.resume_file_bytes),
        "missing_keywords": stored.get("missing_skills", []),
        "matched_keywords": stored.get("matched_skills", []),
    }


@router.get("/review/{analysis_id}", response_model=ResumeReviewSchema)
def resume_review_job_specific(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Job-specific Resume Review (Mode B) for an existing scan.

    Deliberately parallel to /breakdown: free, no LLM call, no write — every
    number comes from the stored row and the same deterministic analysers
    /breakdown already calls. job_match is the model's own stored ats_score,
    never recomputed, so it can never drift from the score the user was
    originally shown for this scan.
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

    stored = json.loads(record.result_json) if record.result_json else {}
    return review.build_review(
        record.resume_text,
        record.job_description or "",
        pdf_bytes=record.resume_file_bytes,
        stored_result=stored,
        model_score=record.ats_score,
        resume_filename=record.resume_filename,
        analysis_id=record.id,
    )


@router.post("/review/general", response_model=ResumeReviewSchema)
async def resume_review_general(
    resume: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """General Resume Review (Mode A) — a resume with no job description.

    Not persisted: resume_analyses.job_description and .ats_score are both
    NOT NULL, so a JD-less scan has no row shape to fit without a migration,
    and Phase 1 makes none. This is a stateless compute-and-return, same as
    /breakdown's read path but with nothing stored to read from — everything
    comes from the upload in this one request.
    """
    content = await resume.read()
    try:
        resume_text = extract_text(resume.filename or "resume", content)
    except ValueError as exc:
        # Same conversion /analyze applies around analyze_resume_against_job
        # (which calls extract_text internally) — an unsupported file type is
        # a 400, not a 500.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not resume_text.strip():
        raise HTTPException(
            status_code=400,
            detail="Couldn't read any text from that file. Try exporting it again as a text-based PDF.",
        )
    if not looks_like_resume(resume_text):
        raise HTTPException(status_code=400, detail=NOT_A_RESUME_MESSAGE)

    return review.build_review(
        resume_text,
        "",
        pdf_bytes=content,
        resume_filename=resume.filename,
    )
