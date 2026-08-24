import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.profile import Profile
from app.modules.job_market import services
from app.schemas.job import JobFeedSchema

router = APIRouter()

# Shortest query we will spend money on. Below this, Google Jobs returns
# near-random matches and the run is wasted — so a stray keystroke in the
# search box can't trigger a billed actor run.
MIN_BILLABLE_QUERY_LEN = 3


@router.get("", response_model=JobFeedSchema)
def list_jobs(
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Job feed, cache-first.

    No argument serves the warm-role cache and never calls Apify. A `q` that
    misses the cache triggers one billed actor run, then caches the result for
    JOB_CACHE_TTL_HOURS.

    ⚠ Cost surface: this is the only user-reachable path that can spend money.
    It is bounded by auth, the length floor below, JOB_MAX_RESULTS_PER_RUN, and
    the TTL (one run per query per window) — but a determined authenticated
    user enumerating distinct queries can still run up charges. If that becomes
    a concern, rate-limit per user here rather than lowering the cap, which
    would degrade results for everyone.
    """
    query = q.strip() if q else None
    if query and len(services.normalise_query(query)) < MIN_BILLABLE_QUERY_LEN:
        # Too short to be worth a run: serve the warm cache instead of nothing,
        # so typing in the search box still shows results as it narrows.
        query = None

    # The default grid is personalised to the caller's own target roles.
    # Read from the profile rather than accepted as a parameter: a role list
    # in the query string would let one user shape another's feed, and it is
    # already stored server-side.
    target_roles: list[str] = []
    if not query:
        profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()
        if profile and profile.target_roles:
            try:
                target_roles = json.loads(profile.target_roles) or []
            except (ValueError, TypeError):
                target_roles = []

    rows, last_updated = services.get_jobs(db, query, target_roles)
    return {
        "lastUpdated": last_updated.isoformat() if last_updated else None,
        "jobs": [services.to_payload(row) for row in rows],
    }
