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
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, defer

from app.core.config import settings
from app.models.job import JobListing
from app.modules.job_market import apify_jobs

logger = logging.getLogger(__name__)


class SourceUnavailable(RuntimeError):
    """The configured job source could not serve a query.

    Wraps whichever provider-specific error was raised so callers don't have
    to know which backend is active.
    """


def _fetch(query_key: str, limit: int) -> tuple[list[dict], float]:
    """Fetch and normalise from the configured source.

    The JOB_SOURCE switch is kept with a single branch on purpose: adding or
    swapping a provider should be one more elif here, not re-plumbing every
    caller. Returns rows plus the run's real billed cost in USD.
    """
    source = (settings.JOB_SOURCE or "apify").lower()

    if source == "apify":
        if not apify_jobs.is_configured():
            raise SourceUnavailable("APIFY_API_TOKEN is not configured")
        try:
            result = apify_jobs.search(query_key, max_items=limit)
        except apify_jobs.ApifyUnavailable as exc:
            raise SourceUnavailable(str(exc)) from exc
        return apify_jobs.normalise_items(result.items, query_key), result.cost_usd

    raise SourceUnavailable(f"unknown JOB_SOURCE {source!r} (expected 'apify')")


def source_configured() -> bool:
    """Whether the active source has credentials. Gates every outbound call."""
    return apify_jobs.is_configured() if (settings.JOB_SOURCE or "apify").lower() == "apify" else False


# Grouped by domain so a sweep covers the whole product rather than the
# software corner of it. Every entry is a normalise_query() key — compared
# directly against JobListing.query_key, so "Electrical Engineer" would never
# match the stored "electrical engineer".
#
# Each role added here is a recurring cost on every sweep (one Apify run plus
# its results), so this list is the sweep's price tag. Prefer letting on-demand
# caching handle the long tail over growing it.
JOB_DOMAINS: dict[str, tuple[str, ...]] = {
    "Software & AI": (
        "software engineer",
        "backend engineer",
        "frontend engineer",
        "ai engineer",
        "ml engineer",
        "devops engineer",
        "data scientist",
        "security engineer",
        "product manager",
    ),
    "Electrical & Hardware": (
        "electrical engineer",
        "power systems engineer",
        "hardware engineer",
    ),
    "Construction & Infrastructure": (
        "construction manager",
        "structural engineer",
        "site engineer",
    ),
    "Core Engineering": (
        "mechanical engineer",
        "civil engineer",
        "industrial engineer",
    ),
}

WARM_ROLES = tuple(role for roles in JOB_DOMAINS.values() for role in roles)


def domain_for(query_key: str) -> str | None:
    """Which domain a cached role belongs to, for grouping in the UI."""
    for domain, roles in JOB_DOMAINS.items():
        if query_key in roles:
            return domain
    return None


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


def _max_age_floor() -> datetime:
    """Hard boundary: nothing older is shown, however stale the cache is.

    Separate from _cutoff, which only decides freshness for ranking and
    re-scraping. A listing past this is suppressed rather than demoted —
    surfacing a three-week-old posting costs the candidate an application,
    which is worse than showing a thinner grid.
    """
    return datetime.now(timezone.utc) - timedelta(days=settings.JOB_MAX_AGE_DAYS)


def _as_utc(value: datetime | None) -> datetime | None:
    """Force a stored timestamp to be timezone-aware.

    Postgres returns aware datetimes for TIMESTAMPTZ; SQLite — the local dev
    default in app/core/config.py — has no timezone type and hands back naive
    ones. Comparing the two raises TypeError, so any comparison done in Python
    rather than in SQL has to normalise first. Stored values are UTC either
    way, so attaching the timezone is a relabel, not a conversion.
    """
    if value is None:
        # posted_at is nullable — rows whose source omitted a date are kept
        # (unknown age, not old age), so every caller must tolerate None.
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _age_filter():
    """Suppress postings older than JOB_MAX_AGE_DAYS.

    Applied to every read path. It previously lived only in _warm_feed, so a
    search returned listings of unbounded age while the default grid was
    bounded — the same feed contradicting itself depending on how you got
    there.

    Rows with no posted_at are kept: a missing date is unknown age, and
    dropping them would silently hide every posting whose source omitted one.
    """
    floor = _max_age_floor()
    return or_(JobListing.posted_at.is_(None), JobListing.posted_at >= floor)


def _fresh_rows(db: Session, query_key: str) -> list[JobListing]:
    return (
        db.query(JobListing)
        .options(defer(JobListing.description))
        .filter(
            JobListing.query_key == query_key,
            JobListing.fetched_at >= _cutoff(),
            _age_filter(),
        )
        .order_by(JobListing.posted_at.desc().nullslast())
        .all()
    )


def _any_rows(db: Session, query_key: str) -> list[JobListing]:
    """Rows for a query regardless of cache freshness.

    "Stale cache" means the row was scraped a while ago, which is fine to
    show. It does NOT mean the posting itself may be ancient — the age filter
    still applies, because an expired listing wastes an application however
    recently we indexed it.
    """
    return (
        db.query(JobListing)
        .options(defer(JobListing.description))
        .filter(JobListing.query_key == query_key, _age_filter())
        .order_by(JobListing.posted_at.desc().nullslast())
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
    # New rows make the cached feed wrong, and a stale feed after a paid
    # refresh is the one case where the cache actively costs money.
    clear_feed_cache()
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
) -> tuple[list[JobListing], datetime | None, bool]:
    """Listings for a query. Reads cache only — never runs the scraper.

    Returns (rows, last_updated, refresh_needed).

    This used to trigger a live provider fetch on a cache miss, which was
    tolerable when the source was a ~1s HTTP call. It is not tolerable now:
    an Apify actor run takes minutes and bills per run, so a synchronous
    refresh meant a user typing an uncached role waited several minutes on a
    blocked request *and* was charged for it. Every keystroke that survived
    the debounce was a paid, multi-minute page load.

    So the read path is now pure cache. `refresh_needed` tells the caller a
    scrape would help; the router queues that in the background and answers
    immediately with whatever is already stored.
    """
    query_key = normalise_query(query) if query else ""

    if not query_key:
        rows, updated = _warm_feed(db, target_roles)
        return rows, updated, False

    fresh = _fresh_rows(db, query_key)
    if fresh:
        return fresh, max(_as_utc(row.fetched_at) for row in fresh), False

    # Stale beats empty, and stale-plus-a-queued-refresh beats a spinner.
    stale = _any_rows(db, query_key)
    if stale:
        return stale, max(_as_utc(row.fetched_at) for row in stale), True

    # Nothing at all for this query. Fall back to the warm feed so the grid
    # still paints something relevant while the scrape runs.
    rows, updated = _warm_feed(db, target_roles)
    return rows, updated, True


# Process-local cache for the default feed, keyed by the caller's role set.
#
# The default grid is identical for everyone sharing a target-role list and
# changes only when a sweep runs, so re-querying it per request is pure waste:
# under load this is the difference between one query and one per reader.
_FEED_CACHE: dict[str, tuple[float, list[JobListing], datetime | None]] = {}


def clear_feed_cache() -> None:
    """Drop the cached feed. Called after a sweep writes new rows, and by
    tests that would otherwise see a previous test's feed."""
    _FEED_CACHE.clear()


def _interleave_by_role(rows: list[JobListing]) -> list[JobListing]:
    """Round-robin the sorted rows across their query_key.

    Straight sorting groups every listing for one role together, so the first
    screenful of a three-role profile is ten "AI Engineer" cards and nothing
    else — which reads as a feed that ignored the other two roles.
    """
    by_role: dict[str, list[JobListing]] = {}
    for row in rows:
        by_role.setdefault(row.query_key, []).append(row)

    queues = list(by_role.values())
    interleaved: list[JobListing] = []
    index = 0
    while len(interleaved) < len(rows):
        for queue in queues:
            if index < len(queue):
                interleaved.append(queue[index])
        index += 1
    return interleaved


def _warm_feed(
    db: Session, target_roles: list[str] | None = None
) -> tuple[list[JobListing], datetime | None]:
    """Default grid: cached listings, preferring the user's own target roles.

    Never triggers a scrape. Staleness demotes rather than excludes, so an
    overdue sweep shows an old feed instead of an empty one — but the age
    filter still applies, so nothing expired is shown at all.
    """
    wanted = [normalise_query(role) for role in (target_roles or [])]
    wanted = [role for role in wanted if role]

    cache_key = "|".join(wanted)
    cached = _FEED_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < settings.JOB_FEED_CACHE_SECONDS:
        return cached[1], cached[2]

    keys = list(dict.fromkeys([*wanted, *WARM_ROLES]))
    rows = (
        db.query(JobListing)
        .options(defer(JobListing.description))
        .filter(JobListing.query_key.in_(keys), _age_filter())
        .order_by(JobListing.posted_at.desc().nullslast())
        .all()
    )
    if not rows:
        _FEED_CACHE[cache_key] = (time.monotonic(), [], None)
        return [], None

    wanted_set = set(wanted)

    def rank(row: JobListing) -> tuple[int, float]:
        """Newest posting first, with the user's own roles ahead of backfill.

        Ordered on posted_at — when the employer listed the role — not
        fetched_at, which only records when we scraped. Sorting on the latter
        makes ordering an artefact of sweep timing: every row from one sweep
        shares a fetched_at, so the grid ends up in arbitrary order while
        appearing sorted.

        Role priority stays as the outer key so a target role still leads, but
        recency decides everything within that. Interleaving is gone: it
        deliberately broke time order to mix roles, which is the opposite of
        what "show them by time posted" asks for.
        """
        posted = _as_utc(row.posted_at)
        return (
            0 if row.query_key in wanted_set else 1,
            -posted.timestamp() if posted else 0.0,
        )

    rows.sort(key=rank)
    newest = max(_as_utc(row.fetched_at) for row in rows)
    _FEED_CACHE[cache_key] = (time.monotonic(), rows, newest)
    return rows, newest



# Employers whose brand name does not slugify to their real domain. A guessed
# "amazonwebservices.com" resolves to nothing, so the common ones are mapped
# explicitly and everything else falls back to the slug.
_KNOWN_DOMAINS = {
    "amazon web services": "aws.amazon.com",
    "amazon web services (aws)": "aws.amazon.com",
    "alphabet": "google.com",
    "meta": "meta.com",
    "x (twitter)": "x.com",
    "jpmorgan chase": "jpmorganchase.com",
    "jpmorganchase": "jpmorganchase.com",
    "booz allen hamilton": "bah.com",
    "collins aerospace": "collinsaerospace.com",
    "northrop grumman": "northropgrumman.com",
    "general dynamics": "gd.com",
    "lockheed martin": "lockheedmartin.com",
}

_CORPORATE_SUFFIXES = (
    " inc", " inc.", " llc", " ltd", " ltd.", " corp", " corp.", " corporation",
    " company", " co.", " plc", " gmbh", " limited", " technologies", " technology",
    " group", " holdings", " solutions",
)


def company_logo_url(company: str) -> str | None:
    """Best-effort brand icon.

    Google's favicon service, not Clearbit: Clearbit's free logo endpoint was
    retired, so it now fails for everyone.

    Returns a URL that may 404. The domain is guessed from the company name,
    and plenty of employers do not own the slug of their display name, so the
    card must render a fallback on error rather than a broken image. Returning
    None for an unusable name is better than a URL that certainly fails.
    """
    name = (company or "").strip().lower()
    if not name or name == "company not listed":
        return None

    domain = _KNOWN_DOMAINS.get(name)
    if not domain:
        for suffix in _CORPORATE_SUFFIXES:
            if name.endswith(suffix):
                name = name[: -len(suffix)].strip()
                break
        slug = re.sub(r"[^a-z0-9]", "", name)
        if len(slug) < 2:
            return None
        domain = f"{slug}.com"

    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"


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
        "companyLogo": company_logo_url(row.company),
        "domain": domain_for(row.query_key),
        "h1bSponsorship": row.h1b_sponsorship,
        "h1bEvidence": row.h1b_evidence,
        "experienceLevel": row.experience_level,
        "employmentType": row.employment_type,
    }


# Filter values the API accepts. Kept here rather than in the router so the
# vocabulary lives beside the rows it filters.
H1B_FILTERS = ("explicitly_sponsored", "no_sponsorship", "unmentioned")
EXPERIENCE_FILTERS = ("entry", "mid", "senior", "lead")
EMPLOYMENT_FILTERS = ("full_time", "part_time", "contract", "internship")


def apply_filters(
    rows: list[JobListing],
    h1b: str | None = None,
    experience: str | None = None,
    employment: str | None = None,
) -> list[JobListing]:
    """Narrow a feed by enrichment attributes.

    Filtered in Python rather than SQL because the rows are already loaded and
    ranked by _warm_feed — re-querying would discard that ordering and the
    interleave that makes the first screen show a spread of roles.

    An unenriched row (attribute is None) is excluded by any filter on that
    attribute. It is not evidence of absence: "we have not checked this
    posting" and "this posting says no sponsorship" are different, and
    silently folding the first into the second would tell a candidate a job
    doesn't sponsor when nobody ever read it.
    """
    filtered = rows
    if h1b in H1B_FILTERS:
        filtered = [r for r in filtered if r.h1b_sponsorship == h1b]
    if experience in EXPERIENCE_FILTERS:
        filtered = [r for r in filtered if r.experience_level == experience]
    if employment in EMPLOYMENT_FILTERS:
        filtered = [r for r in filtered if r.employment_type == employment]
    return filtered


def filter_counts(rows: list[JobListing]) -> dict[str, dict[str, int]]:
    """How many rows each filter value would yield, for the pill labels.

    Sent with the feed so a pill can show its count and disable itself at
    zero, rather than letting someone click into an empty grid.
    """
    def tally(attr: str, allowed: tuple[str, ...]) -> dict[str, int]:
        counts = dict.fromkeys(allowed, 0)
        for row in rows:
            value = getattr(row, attr, None)
            if value in counts:
                counts[value] += 1
        return counts

    return {
        "h1b": tally("h1b_sponsorship", H1B_FILTERS),
        "experience": tally("experience_level", EXPERIENCE_FILTERS),
        "employment": tally("employment_type", EMPLOYMENT_FILTERS),
        # Explicitly surfaced so the UI can say how much of the feed has not
        # been classified, instead of implying the filters cover everything.
        "unenriched": sum(1 for r in rows if r.h1b_sponsorship is None),
    }


# Queries already queued for a background scrape, so a user retrying a search
# a few times cannot fan out into several paid actor runs for the same term.
_QUEUED: dict[str, float] = {}

# One paid run per query per window, matching the cache TTL: re-scraping
# sooner would replace rows that are still being served as fresh.
QUEUE_COOLDOWN_SECONDS = 60 * 60


def should_queue_refresh(query_key: str) -> bool:
    """Whether a background scrape for this query is worth starting.

    Guards the one path where a user action can spend money. Without the
    cooldown, three people searching the same uncached role inside a minute
    would start three actor runs for identical results.
    """
    if not query_key or not source_configured():
        return False
    last = _QUEUED.get(query_key)
    if last is not None and (time.monotonic() - last) < QUEUE_COOLDOWN_SECONDS:
        return False
    _QUEUED[query_key] = time.monotonic()
    return True


# One scrape at a time across the process. An actor run takes minutes and
# costs money; letting several overlap would multiply both for no gain.
_SCRAPE_SLOT = threading.Semaphore(1)


def _scrape(query_key: str) -> None:
    """Run one scrape. Opens its own session — the request-scoped one is closed
    the moment the response is sent."""
    from app.core.database import SessionLocal

    if not _SCRAPE_SLOT.acquire(blocking=False):
        logger.info("background refresh: another scrape is running, skipping %r", query_key)
        _QUEUED.pop(query_key, None)  # let it be retried once the slot frees
        return

    db = SessionLocal()
    try:
        rows, cost = refresh_query(db, query_key)
        logger.info("background refresh: %r -> %d rows, $%.4f", query_key, len(rows), cost)
        clear_feed_cache()
    except Exception:
        # Nothing is waiting on this. Logged and dropped rather than raised
        # into a worker with no error channel.
        logger.warning("background refresh failed for %r", query_key, exc_info=True)
    finally:
        db.close()
        _SCRAPE_SLOT.release()


def refresh_in_background(query_key: str) -> None:
    """Start a scrape on a detached daemon thread.

    Not FastAPI's BackgroundTasks: those run inside the request's worker
    before it is released, so a nine-minute actor run would hold that worker
    for nine minutes even though the response had already been written. A
    daemon thread frees the worker immediately and dies with the process.
    """
    thread = threading.Thread(
        target=_scrape, args=(query_key,), name=f"scrape:{query_key}", daemon=True
    )
    thread.start()


def clear_queue() -> None:
    _QUEUED.clear()
