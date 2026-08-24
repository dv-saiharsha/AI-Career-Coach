from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.user_profile import services
from app.schemas.profile import (
    ActivityResponseSchema,
    OnboardingRequestSchema,
    ProfileSchema,
    ProfileUpdateSchema,
    UserStatsSchema,
)

router = APIRouter()

# Every endpoint takes its user id from get_current_user, which verifies the
# Supabase JWT signature. None of them accept a user id from the request —
# a client-supplied identifier (header, query param, or body field) is not an
# identity, and trusting one here would let any caller read any user's data by
# changing a string.


@router.get("/profile", response_model=ProfileSchema)
def read_profile(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Onboarding state for the signed-in user, creating the row on first read."""
    profile = services.get_or_create_profile(db, current_user.id)
    return services.profile_payload(profile)


@router.post("/onboarding", response_model=ProfileSchema)
def complete_onboarding(
    req: OnboardingRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Persist target roles and mark onboarding complete.

    The 3-5 role bound is enforced by OnboardingRequestSchema, so a client
    that skips the UI's disabled button still gets a 422 rather than a profile
    with one role in it.
    """
    profile = services.complete_onboarding(
        db,
        user_id=current_user.id,
        target_roles=req.target_roles,
        resume_analysis_id=req.primary_resume_analysis_id,
        resume_filename=req.primary_resume_filename,
    )
    return services.profile_payload(profile)


@router.patch("/profile", response_model=ProfileSchema)
def update_profile(
    req: ProfileUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Partially update career details and the avatar reference.

    PATCH, not PUT: the avatar handlers and the career-details form write
    disjoint field sets, and a full-document PUT would make each one
    responsible for round-tripping the other's values — so a stale form would
    silently revert an avatar change made seconds earlier.

    exclude_unset is what preserves that: only keys the client actually sent
    reach the service, so omitted fields are untouched rather than nulled.
    """
    profile = services.update_profile(
        db, current_user.id, req.model_dump(exclude_unset=True)
    )
    return services.profile_payload(profile)


@router.get("/stats", response_model=UserStatsSchema)
def read_stats(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return services.dashboard_stats(db, current_user.id)


@router.get("/activity", response_model=ActivityResponseSchema)
def read_activity(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    items = services.recent_activity(db, current_user.id)
    return {
        "items": [
            {
                "id": item["id"],
                "kind": item["kind"],
                "title": item["title"],
                "score": item["score"],
                "created_at": item["created_at"].isoformat() if item["created_at"] else "",
            }
            for item in items
        ]
    }
