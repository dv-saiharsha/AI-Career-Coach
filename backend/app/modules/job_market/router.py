import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.profile import Profile
from app.modules.job_market import matching, scheduler, services
from app.schemas.job import JobFeedSchema

router = APIRouter()


@router.get("", response_model=JobFeedSchema)
def list_jobs(
    q: str | None = Query(default=None, max_length=120),
    h1b: str | None = Query(default=None, description="explicitly_sponsored | no_sponsorship | unmentioned"),
    experience: str | None = Query(default=None, description="entry | mid | senior | lead"),
    employment: str | None = Query(default=None, description="full_time | part_time | contract | internship"),
    company: str | None = Query(default=None, description="Employer quick-filter chip, e.g. AWS | Google | Stripe"),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Job feed. Pure database read, full-text search when `q` is given —
    see job_market/services.py's own module docstring for why there is no
    longer an on-demand external fetch or a per-query cache behind this."""
    query = q.strip() if q else None

    # Fetched unconditionally: target-role personalisation only applies to
    # the default grid, but resume matching below applies to every load,
    # searched or not.
    profile = db.query(Profile).filter(Profile.user_id == current_user.id).first()

    # The default grid is personalised to the caller's own target roles.
    # Read from the profile rather than accepted as a parameter: a role list
    # in the query string would let one user shape another's feed, and it is
    # already stored server-side.
    target_roles: list[str] = []
    if not query and profile and profile.target_roles:
        try:
            target_roles = json.loads(profile.target_roles) or []
        except (ValueError, TypeError):
            target_roles = []

    rows, last_updated, refreshing = services.get_jobs(db, query, target_roles)

    # Counts come from the unfiltered feed so a pill still shows how many it
    # would match after another pill has already narrowed the grid.
    counts = services.filter_counts(rows)
    rows = services.apply_filters(rows, h1b=h1b, experience=experience, employment=employment, company=company)
    jobs_payload = [services.to_payload(row) for row in rows]

    # Resume matching, only when there's a primary resume to match against.
    # No attempt is made otherwise — a user with no resume on file sees the
    # feed exactly as before, not a feed of nulls computed for nothing.
    resume_text = services.resolve_primary_resume_text(db, current_user.id)
    if resume_text:
        jobs_payload = matching.attach_matches(jobs_payload, resume_text)

    return {
        "lastUpdated": last_updated.isoformat() if last_updated else None,
        "jobs": jobs_payload,
        "filterCounts": counts,
        # Always False now — kept in the response shape for frontend
        # compatibility. There is nothing left to queue a refresh for; the
        # crawler keeps the table current on its own schedule.
        "refreshing": refreshing,
        # Real, or absent. next_run_at() is None until job_market/scheduler.py's
        # older in-process sweep has completed a pass — a process with it
        # disabled (JOB_SWEEP_ENABLED=false, the production default once the
        # worker service is running) says nothing rather than advertising a
        # schedule it is not keeping.
        "next_sync_at": (
            scheduler.next_run_at().isoformat() if scheduler.next_run_at() else None
        ),
    }
