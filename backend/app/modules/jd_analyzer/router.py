"""POST /api/jd/analyze and GET /api/jd/analyze/{job_listing_id}.

Both can run the model, so both carry a rate limit (tests/test_llm_rate_limits.py
requires it of every route that reaches the LLM client). The analysis itself is
cached by the hash of the cleaned text, so a repeat costs a database read.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.ratelimit import RateLimit
from app.models.job import JobListing
from app.modules.jd_analyzer import service
from app.modules.jd_analyzer.schemas import AnalyzeJDRequest, AnalyzeJDResponse

router = APIRouter()

MAX_ANALYSES_PER_WINDOW = 30
WINDOW_SECONDS = 3600


def _limit() -> RateLimit:
    return RateLimit(
        "jd_analyze", MAX_ANALYSES_PER_WINDOW, WINDOW_SECONDS, "Too many job-description analyses. Try again in a while."
    )


@router.post("/analyze", response_model=AnalyzeJDResponse)
def analyze_pasted(
    payload: AnalyzeJDRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit_dep: None = Depends(_limit()),
):
    """Analyse a pasted job description. Sync, so it runs in the threadpool and
    the model call does not block the event loop."""
    analysis, report = service.analyze_with_report(payload.job_description, db=db)
    return AnalyzeJDResponse(analysis=analysis, cached=report.cached is not None, model=service._model_name())


@router.get("/analyze/{job_listing_id}", response_model=AnalyzeJDResponse)
def analyze_listing(
    job_listing_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit_dep: None = Depends(_limit()),
):
    """Analyse a crawled listing's description and link the analysis to it."""
    listing = db.query(JobListing).filter(JobListing.id == job_listing_id).first()
    if listing is None:
        raise HTTPException(status_code=404, detail="Job listing not found")
    if not (listing.description or "").strip():
        raise HTTPException(status_code=422, detail="This listing has no description to analyse.")
    analysis, report = service.analyze_with_report(listing.description, db=db, job_listing_id=job_listing_id)
    return AnalyzeJDResponse(
        analysis=analysis, cached=report.cached is not None, model=service._model_name(), job_listing_id=job_listing_id
    )
