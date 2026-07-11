import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.resume import ResumeAnalysis
from app.models.user import User
from app.modules.resume_analyzer.report import build_report_pdf, build_updated_resume_pdf
from app.modules.resume_analyzer.services import analyze_resume_against_job
from app.schemas.resume import AnalysisResultSchema, GenerateResumeRequestSchema, ResumeHistoryItemSchema

router = APIRouter()


@router.post("/analyze", response_model=AnalysisResultSchema)
async def analyze_resume(
    resume: UploadFile = File(...),
    job_description: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {**result, "id": record.id, "created_at": record.created_at.isoformat()}


@router.get("/history", response_model=list[ResumeHistoryItemSchema])
def list_analyses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
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


@router.post("/generate/{analysis_id}")
def generate_updated_resume(
    analysis_id: int,
    payload: GenerateResumeRequestSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
