"""RapidAPI JSearch client and result normalisation.

Everything that knows JSearch's wire format lives here; services.py deals in
normalised dicts only. Same contract as apify.py, so the two are
interchangeable behind settings.JOB_SOURCE.

The scarce resource here is *requests*, not dollars. The free tier allows 200
searches per month and one search returns ~10 jobs, so a quota unit is spent
whether the query matches 1 job or 50. Every design choice below follows from
that: no retries, no pagination fan-out, and the caller is expected to hit
cache far more often than this module.

Field names are taken from a live response, not the published docs — the docs
disagree with themselves on the salary keys, and several fields documented as
populated (job_city, job_state, job_country) come back null for remote roles
while job_location carries the real value.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.core.keywords import keyword_candidates

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECS = 30.0
MAX_SKILLS = 6
# Ceiling on stored description length. Real postings run 2-8KB; this exists
# to stop a pathological outlier bloating the row, not to truncate normal
# content. The drawer scrolls, so there is no display reason to cut it short.
MAX_DESCRIPTION_CHARS = 20_000
# Characters of description fed to the keyword extractor. The full text can run
# several KB; the skill-bearing part is the opening summary and requirements.
DESCRIPTION_SCAN_CHARS = 4000


@dataclass
class SearchResult:
    """One JSearch call: the items plus what the quota headers reported."""

    items: list[dict[str, Any]] = field(default_factory=list)
    quota_remaining: int | None = None
    quota_limit: int | None = None


class JSearchUnavailable(RuntimeError):
    """No key configured, quota exhausted, or the request failed.

    Raised rather than returning an empty list so callers can tell "the API is
    down" from "this search genuinely has no matches". Those need opposite
    handling: the first should serve stale cache, the second should not
    overwrite good cache with nothing.
    """


def is_configured() -> bool:
    return bool(settings.RAPIDAPI_KEY)


def search(query: str, page: int = 1) -> SearchResult:
    """Run one JSearch query. Costs exactly one quota unit.

    Deliberately synchronous: every route and DB session in this backend is
    sync, and an async client here would either block the event loop on the
    surrounding SQLAlchemy calls or force the whole request path async for no
    benefit — the caller makes one outbound request and waits for it.
    """
    if not is_configured():
        raise JSearchUnavailable("RAPIDAPI_KEY is not configured")

    logger.info("job feed: JSearch query %r (page %s) - spending 1 quota unit", query, page)
    try:
        response = httpx.get(
            f"https://{settings.RAPIDAPI_HOST}/search",
            headers={
                "X-RapidAPI-Key": settings.RAPIDAPI_KEY,
                "X-RapidAPI-Host": settings.RAPIDAPI_HOST,
            },
            # num_pages is pinned to 1: on the free tier each extra page is a
            # separate quota unit, so paging is the most expensive way to get
            # more results.
            params={"query": query, "page": str(page), "num_pages": "1"},
            timeout=REQUEST_TIMEOUT_SECS,
        )
    except httpx.HTTPError as exc:
        raise JSearchUnavailable(f"request failed: {exc}") from exc

    remaining = _header_int(response, "x-ratelimit-requests-remaining")
    limit = _header_int(response, "x-ratelimit-requests-limit")

    if response.status_code == 429:
        raise JSearchUnavailable(f"quota exhausted ({remaining}/{limit} remaining)")
    if response.status_code != 200:
        # Body is truncated: JSearch returns HTML error pages on some failures
        # and dumping those into the log buries everything else.
        raise JSearchUnavailable(f"HTTP {response.status_code}: {response.text[:200]}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise JSearchUnavailable(f"non-JSON response: {exc}") from exc

    items = payload.get("data") or []
    if remaining is not None and remaining <= 10:
        logger.warning("job feed: JSearch quota nearly exhausted - %s of %s left", remaining, limit)
    logger.info(
        "job feed: JSearch returned %s items for %r (quota %s/%s)",
        len(items),
        query,
        remaining,
        limit,
    )
    return SearchResult(items=items, quota_remaining=remaining, quota_limit=limit)


def _header_int(response: httpx.Response, name: str) -> int | None:
    raw = response.headers.get(name)
    try:
        return int(raw) if raw is not None else None
    except ValueError:
        return None


def derive_location(raw: dict[str, Any]) -> str:
    """Build a display location.

    job_location is checked first and city/state/country only as a fallback:
    in live responses the granular fields are frequently null while
    job_location holds the usable value ("Anywhere", "New York, NY"). Building
    from city+country alone yields an empty string for most remote roles.
    """
    direct = (raw.get("job_location") or "").strip()
    if direct:
        return direct
    parts = [
        (raw.get("job_city") or "").strip(),
        (raw.get("job_state") or "").strip(),
        (raw.get("job_country") or "").strip(),
    ]
    joined = ", ".join(p for p in parts if p)
    # Never fall back to job_employment_type here — "Full-time" is not a place,
    # and rendering it in the location slot looks like real data.
    return joined or "Location not specified"


def infer_work_mode(raw: dict[str, Any]) -> str:
    """Map onto the frontend's Remote | Hybrid | On-site union."""
    if raw.get("job_is_remote"):
        return "Remote"
    haystack = " ".join(
        str(raw.get(f) or "") for f in ("job_location", "job_title", "job_description")
    ).lower()
    if "hybrid" in haystack:
        return "Hybrid"
    return "On-site"


def derive_salary(raw: dict[str, Any]) -> str | None:
    """Prefer JSearch's own formatted string, else rebuild from the numbers."""
    formatted = (raw.get("job_salary_string") or raw.get("job_salary") or "").strip()
    if formatted:
        return formatted

    low, high = raw.get("job_min_salary"), raw.get("job_max_salary")
    if low is None and high is None:
        return None
    period = raw.get("job_salary_period")
    suffix = f"/{str(period).lower()}" if period else ""
    if low is not None and high is not None:
        return f"${low:,.0f} - ${high:,.0f}{suffix}"
    single = low if low is not None else high
    return f"${single:,.0f}{suffix}"


# Words that read as proper nouns inside a job posting but are not skills.
# keyword_candidates is shared with the ATS scorer, where these are harmless
# (it compares a resume against a JD, so shared boilerplate cancels out). On a
# job card they surface as fake skill chips, so they are filtered here rather
# than in app/core/keywords.py — widening the shared stopword list would
# change ATS scores for every existing resume analysis.
_POSTING_NOISE = {
    "top", "secret", "clearance", "minimum", "preferred", "required", "global",
    "platform", "infrastructure", "operations", "model", "team", "role", "job",
    "opportunity", "benefits", "salary", "equal", "employer", "veteran",
    "disability", "eeo", "compensation", "bonus", "equity", "onsite", "hybrid",
    "remote", "fulltime", "us", "usa", "united", "states", "inc", "llc", "ltd",
    "corporation", "company", "group", "solutions", "services", "technologies",
    "qualifications", "responsibilities", "description", "summary", "overview",
}


def _entity_tokens(*values: str) -> set[str]:
    """Lowercased word tokens from employer/title, used to filter them out."""
    tokens: set[str] = set()
    for value in values:
        for word in str(value or "").replace("/", " ").replace("-", " ").split():
            cleaned = word.strip(".,()&").lower()
            if cleaned:
                tokens.add(cleaned)
    return tokens


def derive_skills(raw: dict[str, Any]) -> list[str]:
    """Extract skill-ish terms, reusing the resume analyzer's extractor.

    Pulls from job_highlights when present (it is a dict of
    Qualifications/Responsibilities/Benefits lists and is much denser in real
    skill terms than prose) and falls back to the description.

    The raw extractor output is then filtered: on real postings it returns the
    employer's own name ("Booz", "Allen"), words from the job title, and
    posting boilerplate ("Top", "Secret", "Minimum"), all of which look like
    nonsense on a job card.
    """
    parts: list[str] = []
    highlights = raw.get("job_highlights")
    if isinstance(highlights, dict):
        for key, value in highlights.items():
            # Benefits are dental plans and PTO, not skills.
            if str(key).lower().startswith("benefit"):
                continue
            if isinstance(value, list):
                parts.extend(str(v) for v in value)
            elif value:
                parts.append(str(value))

    description = (raw.get("job_description") or "")[:DESCRIPTION_SCAN_CHARS]
    if description:
        parts.append(description)

    combined = "\n".join(p for p in parts if p).strip()
    if not combined:
        return []

    # Filter after extraction rather than before: keyword_candidates relies on
    # sentence position to decide what is a proper noun, so removing words
    # from the input text would change how it reads the rest.
    excluded = _entity_tokens(raw.get("employer_name"), raw.get("job_title")) | _POSTING_NOISE
    skills: list[str] = []
    for term in keyword_candidates(combined):
        if term.lower() in excluded:
            continue
        skills.append(term)
        if len(skills) == MAX_SKILLS:
            break
    return skills


def parse_posted_at(raw: dict[str, Any]) -> datetime | None:
    """Parse the ISO timestamp, ignoring the human-readable sibling field.

    job_posted_at is a relative string ("6 days ago") and
    job_posted_at_datetime_utc is the machine-readable one. Only the latter is
    used — mixing them produces a column that is sometimes a date and
    sometimes prose.
    """
    value = raw.get("job_posted_at_datetime_utc")
    if not value:
        timestamp = raw.get("job_posted_at_timestamp")
        if isinstance(timestamp, (int, float)):
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def derive_apply_url(raw: dict[str, Any]) -> str | None:
    """First usable apply destination, or None if there is nowhere to send the user.

    Never falls back to "#": a card whose Apply button goes nowhere is worse
    than one fewer card, and the model requires a real URL.
    """
    direct = (raw.get("job_apply_link") or "").strip()
    if direct:
        return direct

    options = raw.get("apply_options")
    if isinstance(options, list):
        for option in options:
            if isinstance(option, dict):
                link = (option.get("apply_link") or "").strip()
                if link:
                    return link

    return (raw.get("job_google_link") or "").strip() or None


def normalise_item(raw: dict[str, Any], query_key: str) -> dict[str, Any] | None:
    """Convert one JSearch item into JobListing column values."""
    title = (raw.get("job_title") or "").strip()
    apply_url = derive_apply_url(raw)
    if not title or not apply_url:
        return None

    return {
        "query_key": query_key,
        "external_id": str(raw.get("job_id") or "") or None,
        "title": title,
        "company": (raw.get("employer_name") or "").strip() or "Company not listed",
        "location": derive_location(raw),
        "work_mode": infer_work_mode(raw),
        "salary_range": derive_salary(raw),
        "description": (raw.get("job_description") or "").strip()[:MAX_DESCRIPTION_CHARS] or None,
        "skills": json.dumps(derive_skills(raw)),
        "apply_url": apply_url,
        "posted_at": parse_posted_at(raw),
    }


def normalise_items(items: list[dict[str, Any]], query_key: str) -> list[dict[str, Any]]:
    """Normalise a response, dropping unusable rows and de-duplicating.

    Dedupes on job_id where present and apply URL otherwise: JSearch
    aggregates publishers, so the same role can appear via LinkedIn and via a
    company careers page with different links.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for raw in items:
        row = normalise_item(raw, query_key)
        if row is None:
            continue
        key = row["external_id"] or row["apply_url"]
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out
