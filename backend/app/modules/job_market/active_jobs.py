"""LinkedIn Job Search API (RapidAPI, "Fantastic Jobs") — an on-demand
search source, on its own small request budget.

WHY THIS EXISTS

jsearch.py's /search endpoint returns 404 "Endpoint '/search' does not
exist" on this account's current RapidAPI subscription — /estimated-salary
and /job-details on the *same* key still return 200 with real quota headers,
so the key and the JSearch subscription are both fine; the plan this key is
on simply doesn't include JSearch's search endpoint. Confirmed live, not
guessed.

This is a different RapidAPI product entirely (same account, same
x-rapidapi-key — a RapidAPI key is account-wide, not per-API — a different
x-rapidapi-host) that does expose a working search endpoint on this account.
Its name says what it returns: /active-jb, not a generic /search that might
include postings the employer has already closed.

WHY IT IS BUDGETED EVEN HARDER THAN JSEARCH

Measured from this account's own live response headers:

    X-RateLimit-Requests-Limit:     25
    X-RateLimit-Requests-Remaining: 22
    X-RateLimit-Jobs-Limit:         250
    X-RateLimit-Jobs-Remaining:     237

25 requests for the whole reset window — an order of magnitude tighter than
JSearch's 200/month — and a 250-job ceiling that divides evenly into it at
10 jobs per call, which is exactly the per-request limit used below; asking
for more per call would exhaust the job ceiling in far fewer than 25 calls
and leave request quota that can no longer return anything.

Spending this on a scheduled sweep would exhaust it in hours and leave
nothing for the on-demand searches it exists to serve. Unlike jsearch.py —
which ingestion.py's hourly sweep also calls directly — this module is wired
only into services.py's on-demand path.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlencode

from app.core.config import settings
from app.modules.job_market import geo

logger = logging.getLogger(__name__)

HOST = "linkedin-job-search-api.p.rapidapi.com"
SEARCH_URL = f"https://{HOST}/active-jb"
TIMEOUT_SECONDS = 20

# Never spend below this many remaining requests, out of a pool of 25 for
# the whole window — the same ~20% reserve ratio jsearch.py holds back
# (RESERVE_REQUESTS=40 there is 20% of its 200-request pool).
RESERVE_REQUESTS = 5

# Matches the 250-job ceiling / 25-request ceiling exactly (see module
# docstring) — the point past which one more job per call starts trading
# request quota for nothing, since the job ceiling would run out first.
RESULTS_PER_QUERY = 10

# Read from the last response. None until a request has been made.
_remaining: int | None = None


def remaining_requests() -> int | None:
    return _remaining


def is_configured() -> bool:
    # Same account-wide key jsearch.py uses — a RapidAPI key isn't scoped to
    # one API, only the host header selects which product a request hits.
    return bool(settings.RAPIDAPI_KEY)


def _default_fetch(url: str, headers: dict[str, str]) -> tuple[int, str, dict[str, str]]:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, response.read().decode("utf-8", errors="replace"), dict(response.headers)
    except urllib.error.HTTPError as exc:
        # A 4xx/5xx still carries the rate-limit headers this module reads
        # its budget from — letting it propagate as an exception would throw
        # that reading away along with the response.
        return exc.code, exc.read().decode("utf-8", errors="replace"), dict(exc.headers)


def _work_mode(arrangement: str | None, location: str) -> str:
    """Remote / Hybrid / On-site. The AI-derived arrangement field is
    checked first since it reads the posting's own text rather than
    guessing from a location string — the same preference ats_boards.py
    gives Ashby's and Lever's own structured remote flags over inferring
    one from free text."""
    lowered = (arrangement or "").lower()
    if "hybrid" in lowered:
        return "Hybrid"
    if "remote" in lowered:
        return "Remote"
    if "remote" in (location or "").lower():
        return "Remote"
    return "On-site"


def _location(job: dict) -> str:
    derived = job.get("locations_derived") or []
    cleaned = [str(p) for p in derived if p]
    if cleaned:
        return ", ".join(cleaned)
    return "Not specified"


def _salary(job: dict) -> str | None:
    """Verbatim only, from the structured `salary` object the posting
    itself carries — the ai_salary_* fields are a model's inference from the
    description text, not a number the employer stated, and every other
    source in this package follows the same rule: a guessed salary is the
    number a candidate would most regret trusting, so it is never surfaced
    as a stated one."""
    raw = job.get("salary")
    if not isinstance(raw, dict):
        return None
    low, high = raw.get("min_amount"), raw.get("max_amount")
    currency = raw.get("currency") or "USD"
    if low and high:
        return f"{currency} {int(low):,} - {int(high):,}"
    if low or high:
        return f"{currency} {int(low or high):,}+"
    return None


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_expired(job: dict) -> bool:
    """Belt-and-braces: /active-jb's own name says it filters to open
    postings, but a stated expiry in the past is checked directly here
    rather than trusted blindly — cheap, and the one case where trusting the
    endpoint name instead would show a closed role."""
    valid_through = _parse_iso(job.get("date_valid_through"))
    return valid_through is not None and valid_through < datetime.now(timezone.utc)


def normalise(payload: list[dict], query: str) -> list[dict]:
    """This API's response -> the row shape ingestion already upserts."""
    rows = []
    for job in payload or []:
        title = (job.get("title") or "").strip()
        apply_url = (job.get("url") or "").strip()
        company = (job.get("organization") or "").strip()
        if not title or not apply_url or not company:
            continue
        if _is_expired(job):
            continue

        location = _location(job)
        if geo.is_non_us_location(location):
            continue

        skills = job.get("ai_key_skills")
        rows.append(
            {
                "query_key": query,
                "external_id": f"active_jobs:{job.get('id')}",
                "title": title,
                "company": company,
                "location": location,
                "work_mode": _work_mode(job.get("ai_work_arrangement"), location),
                "salary_range": _salary(job),
                "description": (job.get("description_text") or "").strip() or None,
                "skills": json.dumps(skills if isinstance(skills, list) else []),
                "apply_url": apply_url,
                "posted_at": _parse_iso(job.get("date_posted")),
                # Our vendor for this row, not the publisher it names in its
                # own "source" field (typically "linkedin") — the same rule
                # jsearch.py follows: record where WE read the bytes from.
                "source": "active_jobs",
            }
        )
    return rows


def search(query: str, fetch: Callable | None = None) -> list[dict]:
    """One query against the 25-request pool. Returns [] rather than
    raising, and respects the budget."""
    global _remaining

    if not is_configured():
        return []

    if _remaining is not None and _remaining <= RESERVE_REQUESTS:
        logger.info(
            "active_jobs skipped: %d requests left, reserve is %d", _remaining, RESERVE_REQUESTS
        )
        return []

    fetch = fetch or _default_fetch
    params = {
        "description_format": "text",
        "title": query,
        # US-only at the source, matching geo.py's rule for every other
        # source in this package rather than filtering it out after paying
        # for a job that never counted toward a US result anyway.
        "location": "United States",
        "time_frame": "7d",
        "offset": "0",
        "limit": str(RESULTS_PER_QUERY),
    }
    url = f"{SEARCH_URL}?{urlencode(params)}"
    headers = {
        "x-rapidapi-key": settings.RAPIDAPI_KEY,
        "x-rapidapi-host": HOST,
        "Accept": "application/json",
    }

    try:
        status, body, response_headers = fetch(url, headers)
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same non-event
        logger.info("active_jobs unreachable: %s", exc)
        return []

    # The quota, straight from the party counting it. Recorded even on a
    # non-200 (see _default_fetch's HTTPError handling), because a rejected
    # request may still have been charged.
    raw_remaining = response_headers.get("X-RateLimit-Requests-Remaining")
    if raw_remaining is not None:
        try:
            _remaining = int(raw_remaining)
        except (TypeError, ValueError):
            pass

    if status != 200:
        logger.info("active_jobs returned %s", status)
        return []

    try:
        payload = json.loads(body)
    except ValueError:
        logger.info("active_jobs returned non-JSON")
        return []

    rows = normalise(payload, query)
    logger.info("active_jobs '%s' -> %d roles (%s requests left)", query, len(rows), _remaining)
    return rows
