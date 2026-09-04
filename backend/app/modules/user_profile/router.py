import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.modules.user_profile import services, privacy
from app.modules.user_profile.auth_admin import delete_auth_user
from app.schemas.profile import (
    ActivityResponseSchema,
    OnboardingRequestSchema,
    ProfileSchema,
    ProfileUpdateSchema,
    UserStatsSchema,
)

logger = logging.getLogger(__name__)

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


@router.post("/onboarding/skip", response_model=ProfileSchema)
def skip_onboarding(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Mark onboarding done without choosing roles.

    A separate endpoint rather than relaxing OnboardingRequestSchema: the 3-5
    role bound is a real constraint on the normal path, and loosening it to
    allow an empty list would also let a half-filled form through.

    Nothing here is required to use the product — target roles only re-rank the
    job feed, which falls back to the warm roles when the list is empty. Leaving
    someone stuck in a modal they cannot dismiss is the worse failure.
    """
    profile = services.complete_onboarding(
        db, user_id=current_user.id, target_roles=[],
        resume_analysis_id=None, resume_filename=None,
    )
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


@router.get("/export")
def export_my_data(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Everything held about the caller, as JSON.

    Scoped to current_user.id like every other route here — a user id is never
    accepted as a parameter, so there is no shape of request that exports
    somebody else's data.
    """
    return privacy.export_user_data(db, current_user.id)


@router.delete("/account", status_code=200)
def delete_my_account(
    confirm: str = Query(..., description="Must be the literal string DELETE"),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Erase every row this product holds about the caller.

    Irreversible, so it requires an explicit confirm=DELETE rather than being
    reachable by a stray DELETE to a URL. That guard is deliberately in the
    query string and not a body: a client library that drops bodies from
    DELETE requests would otherwise turn a safety check into a no-op.

    Returns per-table counts rather than a bare success. "Deleted" is a claim
    a person should be able to check against their export.

    THE IDENTITY GOES TOO, AND IT GOES SECOND

    Erasing the rows while leaving the login intact is a half-deletion, and
    the person has been told their account is gone. So the Supabase identity
    is removed as well — but after the data, never before. See auth_admin for
    why that order is not arbitrary: the reverse leaves someone unable to
    authenticate and therefore unable to retry, with data still held.

    A failure in that second half is reported, not raised. The rows really
    are gone by then, and a 500 would tell the caller nothing had happened.
    """
    if confirm != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Pass confirm=DELETE to erase your data. This cannot be undone.",
        )

    deleted = privacy.delete_user_data(db, current_user.id)
    identity_removed = delete_auth_user(current_user.id)

    if not identity_removed:
        logger.error(
            "data erased for user %s but the auth identity remains; needs manual removal",
            current_user.id,
        )

    return {
        "deleted": deleted,
        # Named for what the user experiences rather than for the system it
        # touches: what they need to know is whether signing in still works.
        "sign_in_disabled": identity_removed,
    }
