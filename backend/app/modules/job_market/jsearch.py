"""JSearch (RapidAPI) — aggregated postings, on a hard request budget.

WHY THIS EXISTS

The free ATS boards cover employers who publish a Greenhouse or Lever board,
which is most well-known tech companies and almost nobody else. JSearch
aggregates LinkedIn, Indeed and company career sites, so it reaches the
smaller employers, the agencies and the non-tech verticals the boards miss.

WHY IT IS BUDGETED RATHER THAN POLLED

The plan on this key allows 200 requests a month. Measured from the live
response headers:

    X-RateLimit-Requests-Limit:     200
    X-RateLimit-Requests-Remaining: 197

At ten jobs a request that is a ceiling of roughly 2,000 postings a month —
real, but a quarter of what one free board sweep returns in 35 seconds. It is
a breadth supplement, not a primary source, and treating it as one would
exhaust the month in under two hours of hourly sweeps.

So the budget is enforced from the API's own remaining-request header rather
than a counter this process keeps. A local counter resets when the process
restarts and knows nothing about other workers or a developer running a script
by hand; the header is the truth, reported by the party doing the counting.
RESERVE_REQUESTS is held back so an automated sweep can never consume the last
of the quota and leave a human unable to run a query.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Callable

from app.core.config import settings

logger = logging.getLogger(__name__)

SEARCH_URL = "https://{host}/search?query={query}&page=1&num_pages=1&country=us&date_posted=week"
TIMEOUT_SECONDS = 25

# Never spend below this many remaining requests. An automated sweep must not
# be able to take the last of a month's quota — a person debugging a query at
# the end of the month should still find the key working.
RESERVE_REQUESTS = 40

# Per sweep, regardless of remaining quota. 200 a month is about 6 a day, so a
# sweep taking more than a couple would burn the month in days even while the
# reserve check kept saying yes.
MAX_QUERIES_PER_SWEEP = 2

# Read from the last response. None until a request has been made.
_remaining: int | None = None


def remaining_requests() -> int | None:
    return _remaining


def is_configured() -> bool:
    return bool(settings.RAPIDAPI_KEY and settings.RAPIDAPI_HOST)


def _default_fetch(url: str, headers: dict[str, str]) -> tuple[int, str, dict[str, str]]:
    import urllib.request

    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status, response.read().decode("utf-8", errors="replace"), dict(response.headers)


def _work_mode(job: dict) -> str:
    """Remote only when the payload says so outright.

    is_remote is a real boolean in this schema, so unlike the board sources
    there is nothing to infer from a location string. Anything else is
    On-site: a posting wrongly labelled Remote wastes an application.
    """
    return "Remote" if job.get("job_is_remote") else "On-site"


def _posted_at(job: dict) -> datetime | None:
    raw = job.get("job_posted_at_datetime_utc")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _salary(job: dict) -> str | None:
    """Only when the posting stated one. Never derived from a title.

    Same rule the rest of the feed follows: a guessed salary is the number a
    candidate would most regret trusting.
    """
    low, high = job.get("job_min_salary"), job.get("job_max_salary")
    if not low and not high:
        return None
    period = (job.get("job_salary_period") or "").lower() or "year"
    if low and high:
        return f"${int(low):,} - ${int(high):,} a {period}"
    value = int(low or high)
    return f"${value:,} a {period}"


def normalise(payload: dict, query: str) -> list[dict]:
    """JSearch response -> the row shape ingestion already upserts."""
    rows = []
    for job in payload.get("data") or []:
        apply_url = (job.get("job_apply_link") or "").strip()
        title = (job.get("job_title") or "").strip()
        company = (job.get("employer_name") or "").strip()
        if not apply_url or not title or not company:
            continue

        location = ", ".join(
            part for part in (job.get("job_city"), job.get("job_state")) if part
        ) or (job.get("job_country") or "Not specified")

        rows.append(
            {
                "query_key": f"jsearch:{query}",
                "external_id": f"jsearch:{job.get('job_id')}",
                "title": title,
                "company": company,
                "location": location,
                "work_mode": _work_mode(job),
                "salary_range": _salary(job),
                "description": (job.get("job_description") or "").strip() or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _posted_at(job),
                # Deliberately the aggregator, not the publisher underneath it.
                # job_publisher says "LinkedIn" or "Indeed", but we did not
                # read LinkedIn — we read JSearch's view of it, and the row
                # should say where the bytes actually came from.
                "source": "jsearch",
            }
        )
    return rows


def search(query: str, fetch: Callable | None = None) -> list[dict]:
    """One query. Returns [] rather than raising, and respects the budget."""
    global _remaining

    if not is_configured():
        return []

    if _remaining is not None and _remaining <= RESERVE_REQUESTS:
        logger.info(
            "jsearch skipped: %d requests left, reserve is %d", _remaining, RESERVE_REQUESTS
        )
        return []

    fetch = fetch or _default_fetch
    from urllib.parse import quote

    url = SEARCH_URL.format(host=settings.RAPIDAPI_HOST, query=quote(query))
    headers = {
        "x-rapidapi-key": settings.RAPIDAPI_KEY,
        "x-rapidapi-host": settings.RAPIDAPI_HOST,
        "Accept": "application/json",
    }

    try:
        status, body, response_headers = fetch(url, headers)
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same non-event
        logger.info("jsearch unreachable: %s", exc)
        return []

    # The quota, straight from the party counting it. Recorded even on a
    # non-200, because a rejected request may still have been charged.
    raw_remaining = response_headers.get("X-RateLimit-Requests-Remaining")
    if raw_remaining is not None:
        try:
            _remaining = int(raw_remaining)
        except (TypeError, ValueError):
            pass

    if status != 200:
        logger.info("jsearch returned %s", status)
        return []

    try:
        payload = json.loads(body)
    except ValueError:
        logger.info("jsearch returned non-JSON")
        return []

    rows = normalise(payload, query)
    logger.info("jsearch '%s' -> %d roles (%s requests left)", query, len(rows), _remaining)
    return rows


def search_many(queries: list[str], fetch: Callable | None = None) -> list[dict]:
    """Up to MAX_QUERIES_PER_SWEEP queries, stopping early on the reserve."""
    rows: list[dict] = []
    for query in queries[:MAX_QUERIES_PER_SWEEP]:
        found = search(query, fetch=fetch)
        if not found and _remaining is not None and _remaining <= RESERVE_REQUESTS:
            break
        rows.extend(found)
    return rows
