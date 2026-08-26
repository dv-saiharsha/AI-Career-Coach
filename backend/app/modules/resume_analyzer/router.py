import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.modules.resume_analyzer.report import build_report_pdf, build_updated_resume_pdf
from app.modules.resume_analyzer.services import analyze_resume_against_job
from app.schemas.resume import AnalysisResultSchema, GenerateResumeRequestSchema, ResumeHistoryItemSchema

router = APIRouter()

_MODEL_METADATA_PATH = Path(__file__).resolve().parents[3] / "app" / "ml" / "models" / "ats_model_metadata.json"


@router.get("/model-info")
def model_info():
    """Public-ish diagnostic: when the live scoring model was last trained, on
    how much data, and its measured accuracy — so this isn't a black box."""
    if not _MODEL_METADATA_PATH.exists():
        raise HTTPException(status_code=404, detail="No trained model yet — scores are using the fallback scorer.")
    return json.loads(_MODEL_METADATA_PATH.read_text(encoding="utf-8"))


@router.post("/analyze", response_model=AnalysisResultSchema)
async def analyze_resume(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    content = await resume.read()
    try:
        result = analyze_resume_against_job(resume.filename or "resume", content, job_description)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
    db.commit()
    db.refresh(record)

    return {**result, "id": record.id, "created_at": record.created_at.isoformat()}


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
