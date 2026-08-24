"""Cache-first job feed.

The hybrid strategy: a small set of core roles is kept warm so the grid paints
instantly, and any other role a user searches is fetched on demand and cached
under the same TTL. That combination is what lets /jobs cover every role the
interview coach accepts (it takes free-text roles) without paying to
pre-scrape a catalog nobody searches.

Cost model, since every miss is a billed actor run:
    spend per window = JOB_RESULTS_PER_QUERY
                       x (warm roles + distinct on-demand queries)
A hit costs nothing. So normalising queries aggressively is not tidiness —
"Senior ML Engineer" and "ml engineer " collapsing to one key is the
difference between one charge and two for identical listings.
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.job import JobListing
from app.modules.job_market import apify, jsearch

logger = logging.getLogger(__name__)


class SourceUnavailable(RuntimeError):
    """The configured job source could not serve a query.

    Wraps whichever provider-specific error was raised so callers don't have
    to know which backend is active.
    """


def _fetch(query_key: str, limit: int) -> tuple[list[dict], float]:
    """Fetch and normalise from whichever source is configured.

    Returns normalised rows and the run's cost in USD. JSearch is
    quota-metered rather than dollar-billed, so its cost is always 0.0 — the
    figure that matters there is the quota counter, which jsearch.search logs.
    """
    source = (settings.JOB_SOURCE or "jsearch").lower()

    if source == "jsearch":
        if not jsearch.is_configured():
            raise SourceUnavailable("RAPIDAPI_KEY is not configured")
        try:
            result = jsearch.search(query_key)
        except jsearch.JSearchUnavailable as exc:
            raise SourceUnavailable(str(exc)) from exc
        return jsearch.normalise_items(result.items, query_key), 0.0

    if source == "apify":
        if not apify.is_configured():
            raise SourceUnavailable("APIFY_API_TOKEN is not configured")
        try:
            run = apify.run_actor(query_key, limit)
        except apify.ApifyUnavailable as exc:
            raise SourceUnavailable(str(exc)) from exc
        return apify.normalise_items(run.items, query_key), (run.cost_usd or 0.0)

    raise SourceUnavailable(f"unknown JOB_SOURCE {source!r} (expected 'jsearch' or 'apify')")


def source_configured() -> bool:
    """Whether the active source has credentials. Gates every outbound call."""
    source = (settings.JOB_SOURCE or "jsearch").lower()
    if source == "jsearch":
        return jsearch.is_configured()
    if source == "apify":
        return apify.is_configured()
    return False

# Roles kept warm by the nightly refresh. Deliberately the union of the roles
# Zenith already knows about — data/seed_questions/ (interview coach) plus
# backend/data/raw/resumes/ (ATS training set) — so the job feed covers the
# same ground as the rest of the product rather than a list invented here.
# Adding a role here adds a recurring charge every refresh; prefer letting
# on-demand caching handle the long tail.
# Entries are normalise_query() keys, not display names: they are compared
# directly against JobListing.query_key, and "DevOps Engineer" would never
# match the stored "devops engineer".
WARM_ROLES = (
    "ai engineer",
    "backend engineer",
    "data scientist",
    "devops engineer",
    "frontend engineer",
    "ml engineer",
    "product manager",
    "security engineer",
    "software engineer",
)

# Seniority words and punctuation are stripped from the cache key: Google Jobs
# returns broadly the same posting set for "senior x" and "x", so keying on
# them separately would double the spend for near-identical results.
_SENIORITY_WORDS = {
    "junior", "jr", "senior", "sr", "staff", "principal", "lead", "entry",
    "level", "mid", "associate", "head", "of", "chief",
}


def normalise_query(raw: str) -> str:
    """Collapse a user's search text into a stable, billable cache key."""
    lowered = re.sub(r"[^a-z0-9\s]", " ", raw.lower())
    words = [w for w in lowered.split() if w and w not in _SENIORITY_WORDS]
    return " ".join(words).strip()


def _cutoff() -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=settings.JOB_CACHE_TTL_HOURS)


def _as_utc(value: datetime) -> datetime:
    """Force a stored timestamp to be timezone-aware.

    Postgres returns aware datetimes for TIMESTAMPTZ; SQLite — the local dev
    default in app/core/config.py — has no timezone type and hands back naive
    ones. Comparing the two raises TypeError, so any comparison done in Python
    rather than in SQL has to normalise first. Stored values are UTC either
    way, so attaching the timezone is a relabel, not a conversion.
    """
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _fresh_rows(db: Session, query_key: str) -> list[JobListing]:
    return (
        db.query(JobListing)
        .filter(JobListing.query_key == query_key, JobListing.fetched_at >= _cutoff())
        .order_by(JobListing.fetched_at.desc())
        .all()
    )


def _any_rows(db: Session, query_key: str) -> list[JobListing]:
    """Stale rows for a query. Used when the actor is unavailable."""
    return (
        db.query(JobListing)
        .filter(JobListing.query_key == query_key)
        .order_by(JobListing.fetched_at.desc())
        .all()
    )


def _replace_cache(db: Session, query_key: str, rows: list[dict]) -> list[JobListing]:
    """Swap a query's cached rows for a fresh set, atomically.

    Delete-then-insert rather than upsert: a listing that disappeared from
    Google Jobs is a filled or withdrawn role, and continuing to show it is
    worse than showing fewer jobs. The whole thing runs in one transaction so
    a failed insert can't leave the cache empty after the delete.
    """
    db.query(JobListing).filter(JobListing.query_key == query_key).delete(
        synchronize_session=False
    )
    saved = [JobListing(**row) for row in rows]
    db.add_all(saved)
    db.commit()
    return saved


def refresh_query(
    db: Session, query_key: str, max_results: int | None = None
) -> tuple[list[JobListing], float]:
    """Force a billed actor run for one query and replace its cache entry.

    Returns the cached rows and what the run actually cost, so callers report
    real spend rather than a projection.
    """
    limit = max_results or settings.JOB_RESULTS_PER_QUERY
    rows, cost = _fetch(query_key, limit)
    if not rows:
        # Cache is deliberately left intact: the request is already spent, and
        # replacing good rows with nothing would turn one bad response into an
        # empty grid until the next refresh.
        logger.warning("job feed: source returned no usable rows for %r", query_key)
        return [], cost
    return _replace_cache(db, query_key, rows), cost


def get_jobs(
    db: Session, query: str | None = None, target_roles: list[str] | None = None
) -> tuple[list[JobListing], datetime | None]:
    """Return listings for a query, fetching only on a cache miss.

    Falls back through three tiers so the page always renders something:
      1. fresh cache  -> free
      2. actor run    -> billed, only when configured and the cache is cold
      3. stale cache  -> free, better than an empty grid when Apify is down
    """
    query_key = normalise_query(query) if query else ""

    if not query_key:
        return _warm_feed(db, target_roles)

    fresh = _fresh_rows(db, query_key)
    if fresh:
        return fresh, max(row.fetched_at for row in fresh)

    if source_configured():
        try:
            rows, _cost = refresh_query(db, query_key)
            if rows:
                return rows, max(r.fetched_at for r in rows)
        except Exception as exc:
            # Broad on purpose: a scraper outage, a transport error, or a bug
            # in our own parser should all degrade this request to stale
            # results rather than 500 a page load.
            logger.warning("job feed: falling back to stale cache for %r (%s)", query_key, exc)

    stale = _any_rows(db, query_key)
    return stale, (max(r.fetched_at for r in stale) if stale else None)


def _warm_feed(
    db: Session, target_roles: list[str] | None = None
) -> tuple[list[JobListing], datetime | None]:
    """Default grid: cached listings, preferring the user's own target roles.

    Never triggers an actor run. An unqualified page load must not be able to
    spend money — that is what refresh_warm_roles (scheduled) is for.

    Two behaviours worth stating, both fixing a grid that rendered empty while
    usable rows sat in the table:

    1. Staleness demotes, it does not exclude. The query path has always had a
       "stale cache beats an empty grid" tier; this one did not, so once the
       nightly refresh lapsed past JOB_CACHE_TTL_HOURS every row was filtered
       out and the page showed "no matching openings" on top of a full cache.
       Age is already reported to the client as lastUpdated, so the UI can say
       the feed is old — which is far more useful than showing nothing.

    2. The user's target roles come first. Those roles are matched against
       every cached query_key, not just WARM_ROLES, so a role someone searched
       for once ("devops engineer") feeds their default grid even though the
       nightly refresh doesn't cover it. Warm roles then backfill, so a narrow
       or unmatched profile still gets a full page rather than a thin one.
    """
    wanted = [normalise_query(role) for role in (target_roles or [])]
    wanted = [role for role in wanted if role]

    keys = list(dict.fromkeys([*wanted, *WARM_ROLES]))
    rows = (
        db.query(JobListing)
        .filter(JobListing.query_key.in_(keys))
        .order_by(JobListing.fetched_at.desc())
        .all()
    )
    if not rows:
        return [], None

    cutoff = _cutoff()
    wanted_set = set(wanted)

    def rank(row: JobListing) -> tuple[int, int, float]:
        # Fresh before stale, then the user's roles before the generic warm
        # set, then newest first. Sorting rather than filtering is the whole
        # point: nothing usable gets discarded.
        fetched = _as_utc(row.fetched_at)
        return (
            0 if fetched >= cutoff else 1,
            0 if row.query_key in wanted_set else 1,
            -fetched.timestamp(),
        )

    rows.sort(key=rank)
    return _interleave_by_role(rows), max(_as_utc(row.fetched_at) for row in rows)


def _interleave_by_role(rows: list[JobListing]) -> list[JobListing]:
    """Round-robin the sorted rows across their query_key.

    Straight sorting groups every listing for one role together, so the first
    screenful of a three-role profile is ten "AI Engineer" cards and nothing
    else — which reads as a feed that ignored the other two roles. Taking one
    row per role in turn preserves the priority order established above while
    making the first page show the actual spread.
    """
    by_role: dict[str, list[JobListing]] = {}
    for row in rows:
        by_role.setdefault(row.query_key, []).append(row)

    # dict preserves insertion order, so roles appear in the order the sort
    # already ranked them.
    queues = list(by_role.values())
    interleaved: list[JobListing] = []
    index = 0
    while len(interleaved) < len(rows):
        for queue in queues:
            if index < len(queue):
                interleaved.append(queue[index])
        index += 1
    return interleaved


def refresh_warm_roles(db: Session) -> tuple[dict[str, int], float]:
    """Re-scrape every warm role. Intended for a scheduled nightly job.

    Returns per-role row counts and the total actually billed.

    The except clause is deliberately broad. It used to catch only
    ApifyUnavailable, which meant an unexpected error — a parser bug, a
    changed SDK return type — propagated and abandoned the remaining roles
    *after* their predecessors had already been paid for. Money is spent
    before the parsing happens, so the loop must survive anything the parse
    step can throw; a role that fails is recorded as zero and the rest
    continue.
    """
    results: dict[str, int] = {}
    total_cost = 0.0
    for role in WARM_ROLES:
        try:
            rows, cost = refresh_query(db, role)
            total_cost += cost
            results[role] = len(rows)
        except SourceUnavailable as exc:
            logger.error("job feed: warm refresh failed for %r: %s", role, exc)
            results[role] = 0
        except Exception:
            # Already billed at this point — log the traceback so the cause is
            # recoverable, and keep going rather than stranding the rest.
            logger.exception("job feed: unexpected error refreshing %r", role)
            results[role] = 0
    return results, total_cost


def to_payload(row: JobListing) -> dict:
    """Shape a row into the JobListing contract the Next.js grid already expects."""
    try:
        skills = json.loads(row.skills) if row.skills else []
    except json.JSONDecodeError:
        skills = []

    posted_days_ago = 0
    if row.posted_at:
        delta = datetime.now(timezone.utc) - row.posted_at
        posted_days_ago = max(0, delta.days)

    return {
        "id": str(row.id),
        "title": row.title,
        "company": row.company,
        "location": row.location,
        "workMode": row.work_mode,
        "salaryRange": row.salary_range or "Not disclosed",
        "description": row.description,
        "skills": skills,
        "postedDaysAgo": posted_days_ago,
        "applyUrl": row.apply_url,
    }
