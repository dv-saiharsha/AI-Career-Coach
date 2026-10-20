import json
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.profile import Profile
from app.modules.job_market import ats_boards, crawl_status, matching, services
from app.schemas.job import JobDetailSchema, JobFeedSchema

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
        # The crawl worker's next scheduled run, from crawl_runs; absent when
        # it has never run or is not keeping its schedule, rather than
        # advertising a time nothing will keep.
        "next_sync_at": _next_sync(db),
    }


def _next_sync(db: Session) -> str | None:
    status = crawl_status.scheduler_status(db)
    return None if status["overdue"] else status["next_run_at"]


@router.get("/scheduler-status")
def scheduler_status(
    db: Session = Depends(get_db),
    _user: AuthenticatedUser = Depends(get_current_user),
):
    """The hourly crawl: last run time and counts (per crawler), whether one
    is running now, and when the next one is due. A database read; the worker
    itself runs in its own process (app/worker.py)."""
    return crawl_status.scheduler_status(db)


@router.get("/{job_id}", response_model=JobDetailSchema)
def get_job_details(
    job_id: int,
    db: Session = Depends(get_db),
    _user: AuthenticatedUser = Depends(get_current_user),
):
    """Return one stored posting, including closed listings opened by URL."""
    from app.models.job import JobListing

    row = db.query(JobListing).filter(JobListing.id == job_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if row.source == "workday" and not row.description:
        board = row.query_key.split(":", 1)[1] if ":" in row.query_key else ""
        description, apply_url = ats_boards.fetch_workday_detail(board, row.apply_url)
        changed = False
        if description:
            row.description = description
            changed = True
        if apply_url and apply_url != row.apply_url:
            row.apply_url = apply_url
            changed = True
        if changed:
            db.commit()
            db.refresh(row)
    elif row.source == "microsoft_jobs" and not row.description:
        description = ats_boards.fetch_microsoft_detail(row.apply_url, row.title)
        if description:
            row.description = description
            db.commit()
            db.refresh(row)

    try:
        parsed_url = urlsplit((row.apply_url or "").strip())
        safe_apply_url = (
            row.apply_url
            if parsed_url.scheme.lower() in {"http", "https"}
            and parsed_url.hostname
            and parsed_url.username is None
            and parsed_url.password is None
            else None
        )
    except ValueError:
        safe_apply_url = None

    return {
        **services.to_payload(row),
        "applyUrl": safe_apply_url,
        "source": row.source,
        "externalId": row.external_id,
        "status": row.status,
        "postedAt": row.posted_at.isoformat() if row.posted_at else None,
        "closedAt": row.closed_at.isoformat() if row.closed_at else None,
    }
