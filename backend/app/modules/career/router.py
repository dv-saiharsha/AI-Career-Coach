import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.resume import ResumeAnalysis
from app.modules.career import services
from app.modules.user_profile import services as profile_services
from app.schemas.career import (
    CounterOfferRequestSchema,
    CounterOfferSchema,
    RoadmapRequestSchema,
    RoadmapSchema,
    SalaryBenchmarkSchema,
)

router = APIRouter()


def _latest_skills(db: Session, user_id: str) -> tuple[list[str], list[str]]:
    """Matched and missing skills from the user's most recent scan.

    This is what lets the roadmap mark a capability as already-held instead of
    guessing. Returns empty lists when there's no scan yet, in which case the
    generator is told nothing rather than told something wrong.
    """
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )
    if not record or not record.result_json:
        return [], []
    try:
        result = json.loads(record.result_json)
    except (ValueError, TypeError):
        return [], []
    return result.get("matched_skills") or [], result.get("missing_skills") or []


@router.post("/roadmap", response_model=RoadmapSchema)
def roadmap(
    req: RoadmapRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    profile = profile_services.get_or_create_profile(db, current_user.id)
    target_roles = profile_services.read_target_roles(profile)

    # Explicit request values win; otherwise fall back to the stored profile so
    # the page works with no input on first visit.
    current_role = (req.current_role or profile.current_title or "").strip()
    target_role = (
        req.target_role or profile.primary_target_role or (target_roles[0] if target_roles else "")
    ).strip()
    seniority = (req.seniority or profile.seniority or "").strip() or None

    known, gaps = _latest_skills(db, current_user.id)
    return services.career_roadmap(current_role, target_role, seniority, known, gaps)


@router.get("/salary-benchmark", response_model=SalaryBenchmarkSchema)
def salary_benchmark(
    role: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return services.salary_benchmark(db, role)


@router.post("/counter-offer", response_model=CounterOfferSchema)
def counter_offer(
    req: CounterOfferRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    benchmark = services.salary_benchmark(db, req.role)
    email = services.counter_offer_email(
        req.role, req.company, req.current_offer, req.target_offer, benchmark
    )
    return {"email": email, "benchmark": benchmark}
