"""The Job Portal's read path — direct database reads only.

Every row in job_listings now comes from job_market/crawler.py's hourly
crawl (or, locally, ingestion.py's older board sweep) — there is no more
on-demand external fetch triggered by a user's search. A query the crawler
has never seen returns whatever the full-text search actually matches, not
a queued scrape: the table is kept fresh by the crawler's own schedule, not
by request traffic.

This replaces an earlier design built around JSearch/RapidAPI, where a
search miss triggered a billed, minutes-long actor run cached under a
query-specific key with its own TTL. That entire mechanism — the cache,
the background-thread scrape, the request quota, the on-demand enrichment
call — is gone along with the provider. See CRAWLER_PLAN.md and this
change's own PR description for why.
"""

import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.job import JobListing
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.modules.job_market import geo
from app.modules.job_market.matching import attach_matches

logger = logging.getLogger(__name__)


# Domain vocabulary for classifying a posting's *title* into a grouping the
# UI can label — "Software & AI", "Healthcare & Medical", and so on. This
# used to double as the warm-role list a paid aggregator was searched for on
# a schedule; that half is gone with the provider. What is left is exactly
# what the name says: a keyword taxonomy for domain_for() below.
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
    "Healthcare & Medical": (
        "registered nurse",
        "physician assistant",
        "medical assistant",
        "pharmacist",
        "physical therapist",
    ),
    "Finance & Accounting": (
        "financial analyst",
        "accountant",
        "auditor",
        "investment analyst",
    ),
    "Marketing & Communications": (
        "marketing manager",
        "digital marketing specialist",
        "content strategist",
        "social media manager",
    ),
    "Operations & Administration": (
        "operations manager",
        "project manager",
        "administrative assistant",
        "executive assistant",
    ),
    "Creative & Design": (
        "graphic designer",
        "ux designer",
        "content writer",
    ),
    "Hospitality & Food Service": (
        "hotel manager",
        "restaurant manager",
        "event coordinator",
    ),
    "Skilled Trades": (
        "electrician",
        "plumber",
        "hvac technician",
        "welder",
    ),
}


def domain_for(title: str) -> str | None:
    """Which domain a posting's title suggests, for grouping in the UI.

    Previously matched a row's query_key against this same vocabulary
    exactly — meaningful when query_key WAS the search term a paid aggregator
    was asked for. Every row is crawler-sourced now, and query_key is a board
    identifier ("greenhouse:stripe"), not a role, so this reads the title's
    own text against the vocabulary instead. Best-effort: an unusual title
    that names no listed role classifies as None, same as before.
    """
    lowered = (title or "").lower()
    for domain, roles in JOB_DOMAINS.items():
        if any(role in lowered for role in roles):
            return domain
    return None


# Seniority words and punctuation are stripped so two ways of writing the same
# role — "Senior ML Engineer" and "ml engineer" — compare equal. Still used by
# interview_coach/prep.py and applications/services.py to match a role name
# against a stored one; kept here as a shared text-normalisation utility
# rather than duplicated in both.
_SENIORITY_WORDS = {
    "junior", "jr", "senior", "sr", "staff", "principal", "lead", "entry",
    "level", "mid", "associate", "head", "of", "chief",
}


def normalise_query(raw: str) -> str:
    """Collapse role text into a stable comparison key."""
    lowered = re.sub(r"[^a-z0-9\s]", " ", raw.lower())
    words = [w for w in lowered.split() if w and w not in _SENIORITY_WORDS]
    return " ".join(words).strip()


def _max_age_floor() -> datetime:
    """Hard boundary: nothing older is shown, however fresh the crawl is.

    A listing past this is suppressed rather than demoted — surfacing a
    three-week-old posting costs the candidate an application, which is
    worse than showing a thinner grid.
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
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _age_filter():
    """Suppress postings older than JOB_MAX_AGE_DAYS. Applied to every read
    path — search and the default grid alike.

    Rows with no posted_at are kept: a missing date is unknown age, and
    dropping them would silently hide every posting whose source omitted one.
    """
    floor = _max_age_floor()
    return or_(JobListing.posted_at.is_(None), JobListing.posted_at >= floor)


def _us_only(rows: list[JobListing]) -> list[JobListing]:
    """Drop postings whose location names a country other than the US.

    Applied to every read path (see geo.py for what counts as a signal).
    job_market/crawler.py already filters this at collection time now, so
    this is a second, cheap backstop against anything that slipped through
    (or was written by the older ingestion.py board sweep, which filters the
    same way at its own collection point) rather than the primary defence.
    """
    return [row for row in rows if not geo.is_non_us_location(row.location)]


# How many rows a search or the default grid will ever load into Python and
# rank there. Not a page size — the UI's own limit/pagination is separate —
# but a floor under "don't pull every open row in the table into memory for
# one request," which stopped being a theoretical concern once a single
# crawl started producing tens of thousands of rows in one pass.
CANDIDATE_ROW_LIMIT = 1000


def search_jobs(db: Session, query: str) -> list[JobListing]:
    """Full-text search directly against crawled job_listings. No cache, no
    external call — a search this table has never seen for this term simply
    returns nothing until the crawler adds something that matches, which it
    does on its own hourly schedule rather than in response to a request.

    Postgres uses a real to_tsvector/plainto_tsquery match against title,
    company, skills and description, backed by ix_job_listings_fts (see the
    migration that adds it). SQLite — local dev and every test here — has no
    equivalent without a separate FTS5 virtual table, so it falls back to a
    case-insensitive substring match across the same columns: adequate for a
    small local dataset, and this branch never runs in production.
    """
    terms = (query or "").strip()
    if not terms:
        return []

    base = db.query(JobListing).filter(JobListing.status == "open", _age_filter())

    if db.bind.dialect.name == "postgresql":
        vector = func.to_tsvector(
            "english",
            func.concat_ws(
                " ", JobListing.title, JobListing.company, JobListing.skills, JobListing.description
            ),
        )
        rows = (
            base.filter(vector.op("@@")(func.plainto_tsquery("english", terms)))
            .order_by(JobListing.posted_at.desc().nullslast())
            .limit(CANDIDATE_ROW_LIMIT)
            .all()
        )
    else:
        pattern = f"%{terms.lower()}%"
        rows = (
            base.filter(
                or_(
                    func.lower(JobListing.title).like(pattern),
                    func.lower(JobListing.company).like(pattern),
                    func.lower(JobListing.skills).like(pattern),
                )
            )
            .order_by(JobListing.posted_at.desc().nullslast())
            .limit(CANDIDATE_ROW_LIMIT)
            .all()
        )
    return _us_only(rows)


def get_jobs(
    db: Session, query: str | None = None, target_roles: list[str] | None = None
) -> tuple[list[JobListing], datetime | None, bool]:
    """Listings for a query, or the personalised default grid with none.

    Returns (rows, last_updated, refreshing). refreshing is always False —
    kept in the return shape because the router and JobFeedSchema still
    expose it — since there is nothing left to queue a refresh for; the
    crawler keeps the table current on its own schedule, not in response to
    a request.
    """
    query = (query or "").strip()
    if not query:
        rows, updated = _warm_feed(db, target_roles)
        return rows, updated, False

    rows = search_jobs(db, query)
    updated = max((_as_utc(row.fetched_at) for row in rows), default=None)
    return rows, updated, False


# Process-local cache for the default feed, keyed by the caller's role set.
#
# The default grid is identical for everyone sharing a target-role list and
# changes only when the crawler writes new rows, so re-querying it per
# request is pure waste: under load this is the difference between one query
# and one per reader. Unrelated to the search cache the old on-demand
# provider needed — this is a plain performance cache, not a cost control.
_FEED_CACHE: dict[str, tuple[float, list[JobListing], datetime | None]] = {}


def clear_feed_cache() -> None:
    """Drop the cached feed. Called by the crawler after it writes new rows
    (so the grid doesn't serve a stale cache after a fresh crawl), and by
    tests that would otherwise see a previous test's feed."""
    _FEED_CACHE.clear()


# Below this many role-matching rows, filtering down to just them would leave
# the grid feeling broken rather than personalised — see the comment at its
# one call site in _warm_feed.
MIN_PERSONALIZED_MATCHES = 6


def _title_matches_any(title: str, roles: set[str]) -> bool:
    lowered = (title or "").lower()
    return any(role in lowered for role in roles)


def _warm_feed(
    db: Session, target_roles: list[str] | None = None
) -> tuple[list[JobListing], datetime | None]:
    """Default grid: the most recent open listings, preferring the user's
    own target roles.

    Role matching is against each row's own title text now, not query_key —
    every row is crawler-sourced, and query_key is a board identifier
    ("greenhouse:stripe"), not the role that was searched for, so it can no
    longer serve as the match key the way it did when a paid aggregator
    fetched rows per role.
    """
    wanted = [normalise_query(role) for role in (target_roles or [])]
    wanted = [role for role in wanted if role]
    wanted_set = set(wanted)

    cache_key = "|".join(wanted)
    cached = _FEED_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < settings.JOB_FEED_CACHE_SECONDS:
        return cached[1], cached[2]

    rows = (
        db.query(JobListing)
        # description is NOT deferred. to_payload reads it, so deferring it
        # turns one query into one lazy load per row.
        .filter(JobListing.status == "open", _age_filter())
        .order_by(JobListing.posted_at.desc().nullslast())
        .limit(CANDIDATE_ROW_LIMIT)
        .all()
    )
    rows = _us_only(rows)
    if not rows:
        _FEED_CACHE[cache_key] = (time.monotonic(), [], None)
        return [], None

    def rank(row: JobListing) -> tuple[int, float]:
        """Newest posting first, with the user's own roles ahead of backfill."""
        posted = _as_utc(row.posted_at)
        return (
            0 if _title_matches_any(row.title, wanted_set) else 1,
            -posted.timestamp() if posted else 0.0,
        )

    rows.sort(key=rank)

    # Interest-based filtering, not just a rank boost: when the caller has
    # target roles and enough of the bounded candidate set actually matches
    # them, backfill rows are dropped entirely rather than merely sorted
    # behind — "your feed" should mean your roles, not everyone's roles with
    # yours first.
    #
    # The floor exists because a narrow or unusual target-role set can match
    # very little of what happens to be in the candidate window right now,
    # and an almost-empty grid reads as broken, not as personalised. Below
    # it, the full ranked set (still role-first) is shown instead.
    if wanted_set:
        matched = [row for row in rows if _title_matches_any(row.title, wanted_set)]
        if len(matched) >= MIN_PERSONALIZED_MATCHES:
            rows = matched

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
    """Shape a row into the JobListing contract the frontend expects."""
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
        "domain": domain_for(row.title),
        "h1bSponsorship": row.h1b_sponsorship,
        "h1bEvidence": row.h1b_evidence,
        "experienceLevel": row.experience_level,
        "employmentType": row.employment_type,
    }


def resolve_primary_resume_text(db: Session, user_id: str) -> str | None:
    """The text of the resume the user has designated primary — shared by
    the router (matching every listing on a normal feed load) and the
    dashboard's top_matches below, so this lookup exists in exactly one
    place rather than twice."""
    profile = db.query(Profile).filter(Profile.user_id == user_id).first()
    if not profile or not profile.primary_resume_analysis_id:
        return None
    analysis = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == profile.primary_resume_analysis_id, ResumeAnalysis.user_id == user_id)
        .first()
    )
    return analysis.resume_text if analysis and analysis.resume_text else None


# top_matches only ever keeps the top `limit`, so scoring the full feed just
# to throw away everything past the top 5 would be duplicate, discarded work.
_TOP_MATCHES_CANDIDATE_CAP = 80


def top_matches(db: Session, user_id: str, limit: int = 5) -> list[dict]:
    """Top-N cached listings by resume match, for the dashboard's Jobs
    section.

    Scores only the `_TOP_MATCHES_CANDIDATE_CAP` most-recently-posted rows
    (get_jobs's own ranking already puts these first), not the whole warm
    feed — a disclosed, bounded tradeoff: a strong match sitting outside the
    cap among older postings won't surface here, in exchange for not paying
    an ML call for hundreds of rows that would be discarded anyway. The
    /jobs page itself is unaffected — this cap is local to top_matches.

    Returns [] rather than an error when there's no primary resume to match
    against — an unscored feed isn't a failure, it's simply not this user's
    situation yet.
    """
    resume_text = resolve_primary_resume_text(db, user_id)
    if not resume_text:
        return []

    profile = db.query(Profile).filter(Profile.user_id == user_id).first()
    target_roles: list[str] = []
    if profile and profile.target_roles:
        try:
            target_roles = json.loads(profile.target_roles) or []
        except (ValueError, TypeError):
            target_roles = []

    rows, _last_updated, _refresh_needed = get_jobs(db, None, target_roles)
    candidates = rows[:_TOP_MATCHES_CANDIDATE_CAP]
    jobs_payload = [to_payload(row) for row in candidates]
    jobs_payload = attach_matches(jobs_payload, resume_text)
    scored = [job for job in jobs_payload if job["match"]["overallMatch"] is not None]
    scored.sort(key=lambda job: job["match"]["overallMatch"], reverse=True)
    return scored[:limit]


# Filter values the API accepts. Kept here rather than in the router so the
# vocabulary lives beside the rows it filters.
H1B_FILTERS = ("explicitly_sponsored", "no_sponsorship", "unmentioned")
EXPERIENCE_FILTERS = ("entry", "mid", "senior", "lead")
EMPLOYMENT_FILTERS = ("full_time", "part_time", "contract", "internship")


# Top-employer quick-filter chips. Matching is alias-aware rather than a
# literal match on the chip label: a crawler row's `company` is whatever the
# source's own API returned verbatim ("Amazon.com Services LLC", "Microsoft
# Corporation", "Apple Inc."), so an exact-string match would show "no jobs"
# for nearly every chip nearly all the time.
#
# "amazon" alone (for AWS) is deliberately broad — there is no reliable way
# to separate an AWS posting from another Amazon org's from title/company
# text alone, and a false positive here is a far smaller harm than the chip
# matching nothing.
EMPLOYER_CHIPS: dict[str, tuple[str, ...]] = {
    "AWS": ("aws", "amazon web services", "amazon"),
    "Google": ("google", "alphabet"),
    "American Express": ("american express", "amex"),
    "NVIDIA": ("nvidia",),
    "Microsoft": ("microsoft",),
    "Stripe": ("stripe",),
    "Apple": ("apple",),
}


def _company_matches(company: str, chip: str) -> bool:
    aliases = EMPLOYER_CHIPS.get(chip, (chip,))
    lowered = company.lower()
    return any(alias in lowered for alias in aliases)


def apply_filters(
    rows: list[JobListing],
    h1b: str | None = None,
    experience: str | None = None,
    employment: str | None = None,
    company: str | None = None,
) -> list[JobListing]:
    """Narrow a feed by enrichment attributes.

    Filtered in Python rather than SQL because the rows are already loaded and
    ranked by _warm_feed/search_jobs — re-querying would discard that
    ordering.

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
    if company:
        filtered = [r for r in filtered if _company_matches(r.company, company)]
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
        "employer": {
            chip: sum(1 for r in rows if _company_matches(r.company, chip)) for chip in EMPLOYER_CHIPS
        },
        # Explicitly surfaced so the UI can say how much of the feed has not
        # been classified, instead of implying the filters cover everything.
        "unenriched": sum(1 for r in rows if r.h1b_sponsorship is None),
    }
