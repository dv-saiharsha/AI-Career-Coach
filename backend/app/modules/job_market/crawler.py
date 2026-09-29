"""The companies-table-driven crawl orchestrator.

WHY THIS IS A SEPARATE PIPELINE FROM INGESTION.PY'S EXISTING BOARD SWEEP

ingestion.py's board sweep (_collect_boards, run through scheduler.py) is
large, tested, and already running in production doing exactly what it was
built to do: free Greenhouse/Lever/Ashby reads off boards_registry.py's
curated list, plus a budgeted JSearch aggregator pass. It has no concept of
a companies table, three more ATS adapters, or a job lifecycle, and it does
not need to be rewritten to gain them.

This module is that capability instead, as its own pipeline: it reads the
`companies` table (not boards_registry.py's hardcoded tuples), so it covers
all six ATS adapters plus the JSON-LD fallback, and it is what carries the
concurrency, per-domain rate limiting, retries, best-effort conditional
requests, and the close-after-2-misses lifecycle. It is what
backend/scripts/run_crawl.py and the worker process (job_market/worker_main.py)
call. Retiring the older sweep, or migrating it to read from `companies` too,
is a natural later step — deliberately not a rider on this change.

CLOSE-AFTER-2-MISSES, PRECISELY

A row's `missed_streak` increments only when its company's crawl this run
*succeeded* (a real 200/404 answer, or a 304 meaning nothing changed) and
did not include that row. A company crawl that itself failed — timeout,
5xx, unreachable — never touches missed_streak: a network hiccup must not
be read as "this posting was taken down." At missed_streak == 2 the row
closes; JOB_CLOSED_RETENTION_DAYS after that, this module's cleanup pass
hard-deletes it.

CONDITIONAL REQUESTS, HONESTLY

Best-effort. A company's stored etag/last_modified are sent as
If-None-Match/If-Modified-Since; a 304 skips reconciliation entirely rather
than being read as "zero jobs." Any provider that ignores these headers (not
all six do) simply always returns 200, and the crawl proceeds exactly as if
this feature did not exist for that company — never a wrong answer, only a
missed optimization.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.models.job import JobListing
from app.modules.job_market import ats_boards, geo, ingestion, jsonld_crawler

logger = logging.getLogger(__name__)

# A row closes once its company has successfully crawled it as missing this
# many times in a row.
CLOSE_AFTER_MISSED_CRAWLS = 2

DEFAULT_TIMEOUT_SECONDS = 20
RETRY_ATTEMPTS = 3
RETRY_BACKOFF_BASE_SECONDS = 1.0

# ATS types this module knows how to crawl. "manual_review" companies are
# skipped outright — there is nothing to fetch until a human resolves one.
_ATS_DISPATCH = ("greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee", "jsonld")


class _Retryable(Exception):
    """A transient failure (timeout, connection error, 5xx) worth retrying —
    distinct from a 404, which means "not on this ATS" and is never retried,
    unchanged from ats_boards.fetch_board's own existing behavior."""


def _raw_fetch(
    url: str, etag: str | None, last_modified: str | None, timeout: int
) -> tuple[int, str, str | None, str | None]:
    """One HTTP GET. Returns (status, body, response_etag, response_last_modified).

    Raises _Retryable on a timeout, connection error, or 5xx — anything else
    (200, 304, 404, ...) is returned, not raised, exactly like
    ats_boards._default_fetch's own contract.
    """
    contact = settings.CRAWLER_CONTACT_EMAIL or "crawler-contact-not-configured@example.com"
    headers = {
        "User-Agent": f"HireLoomBot/1.0 (job crawler; +mailto:{contact})",
        "Accept": "application/json, text/html;q=0.9",
    }
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified

    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            body = response.read().decode("utf-8", errors="replace")
            return response.status, body, response.headers.get("ETag"), response.headers.get("Last-Modified")
    except urllib.error.HTTPError as exc:
        response_headers = exc.headers
        if exc.code == 304:
            etag = response_headers.get("ETag") if response_headers else None
            modified = response_headers.get("Last-Modified") if response_headers else None
            return 304, "", etag, modified
        if exc.code >= 500:
            raise _Retryable(f"HTTP {exc.code}") from exc
        return exc.code, "", None, None
    except (TimeoutError, OSError) as exc:
        raise _Retryable(str(exc)) from exc


def _fetch_with_retry(
    url: str, etag: str | None, last_modified: str | None, timeout: int = DEFAULT_TIMEOUT_SECONDS
) -> tuple[int, str, str | None, str | None]:
    last_exc: _Retryable | None = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            return _raw_fetch(url, etag, last_modified, timeout)
        except _Retryable as exc:
            last_exc = exc
            if attempt < RETRY_ATTEMPTS - 1:
                time.sleep(RETRY_BACKOFF_BASE_SECONDS * (2**attempt))
    assert last_exc is not None  # RETRY_ATTEMPTS >= 1, so the loop always returns or sets this
    raise last_exc


# Per-domain rate limiting, shared across every thread in the pool — several
# companies on the same ATS (every Greenhouse board, say) share one host, and
# CRAWLER_CONCURRENCY alone only bounds work per company, not per host.
_domain_lock = threading.Lock()
_last_request_at: dict[str, float] = {}


def _throttle(domain: str, min_interval_ms: int) -> None:
    with _domain_lock:
        now = time.monotonic()
        last = _last_request_at.get(domain, 0.0)
        wait = (min_interval_ms / 1000) - (now - last)
        _last_request_at[domain] = (last + min_interval_ms / 1000) if wait > 0 else now
    if wait > 0:
        time.sleep(wait)


def _make_fetch(company: Company, min_interval_ms: int):
    """A `fetch(url) -> (status, body)` closure matching ats_boards.fetch_board
    and jsonld_crawler.fetch_jsonld_postings's injectable seam exactly, so
    this module needs no changes to either — it supplies production fetch
    behavior (throttling, retries, conditional headers) through the same
    hook their tests use to supply a fake one.

    Never raises: a retry-exhausted failure comes back as a fake non-200
    status (599) rather than an exception, because fetch_board/
    fetch_jsonld_postings already swallow any exception their fetch callable
    raises and turn it into "no rows" with no way for this module to tell
    that apart from a real, boring 404 afterward. Routing it through the
    return value instead, captured in `captured["error"]`, keeps that
    distinction alive for the caller.
    """
    captured = {"etag": None, "last_modified": None, "not_modified": False, "error": None}

    def fetch(url: str) -> tuple[int, str]:
        domain = urlsplit(url).netloc
        _throttle(domain, min_interval_ms)
        try:
            status, body, etag, last_modified = _fetch_with_retry(url, company.etag, company.last_modified)
        except _Retryable as exc:
            captured["error"] = str(exc)
            return 599, ""
        captured["not_modified"] = captured["not_modified"] or status == 304
        captured["etag"] = etag or captured["etag"]
        captured["last_modified"] = last_modified or captured["last_modified"]
        return status, body

    return fetch, captured


@dataclass
class CompanyResult:
    rows: list[dict] = field(default_factory=list)
    not_modified: bool = False
    error: str | None = None
    etag: str | None = None
    last_modified: str | None = None


def _crawl_one(company: Company, min_interval_ms: int) -> CompanyResult:
    """One company, end to end. Never raises — a crash here must not lose
    the rest of the run, matching every adapter's own swallow-and-report
    contract."""
    fetch, captured = _make_fetch(company, min_interval_ms)
    query_key = f"{company.ats_type}:{company.ats_slug or company.id}"

    try:
        if company.ats_type == "jsonld":
            rows = jsonld_crawler.fetch_jsonld_postings(
                company.careers_url, query_key=query_key, company_name=company.name, fetch=fetch
            )
        else:
            rows = ats_boards.fetch_board(
                company.ats_type, company.ats_slug, query_key=query_key, fetch=fetch, display_name=company.name
            )
    except Exception as exc:  # noqa: BLE001 - one company's crash must not stop the run
        return CompanyResult(error=str(exc))

    # This app is US-focused (see geo.py) and these boards list every
    # office's openings with no country filter of their own — a
    # multinational's Greenhouse/Lever/Ashby board hands back its Tokyo,
    # Bengaluru and Singapore reqs alongside its US ones. services.py's read
    # path already drops these before a user ever sees them, but storing —
    # and re-crawling — postings nobody can be shown is pure waste; this is
    # the same filter ingestion.py's older board sweep already applies at
    # collection time.
    rows = [row for row in rows if not geo.is_non_us_location(row.get("location", ""))]

    # A row's own signal (real postings, or a confirmed-unchanged 304) always
    # wins over a captured error from an earlier, incidental call in the same
    # crawl (e.g. a transient robots.txt fetch failure that jsonld_crawler's
    # own _robots_allow already treated as "allowed" and moved past).
    error = None if (rows or captured["not_modified"]) else captured["error"]
    return CompanyResult(
        rows=rows,
        not_modified=captured["not_modified"],
        error=error,
        etag=captured["etag"],
        last_modified=captured["last_modified"],
    )


def _reconcile_company_rows(
    db: Session, company: Company, rows: list[dict], not_modified: bool
) -> tuple[int, int, int]:
    """Upsert this crawl's rows for one company and apply the close-after-
    2-misses lifecycle. Returns (new, updated, closed).

    Identity is (source, company, external_id) — see app/models/job.py's
    ix_job_listings_ats_identity for why content_hash alone was wrong for
    this. A row with no external_id (a JSON-LD posting with no @id) cannot
    be reconciled this way and is silently skipped — the same accepted,
    disclosed gap that index's own comment already names.
    """
    now = datetime.now(timezone.utc)
    existing = {
        (row.source, row.company, row.external_id): row
        for row in db.query(JobListing).filter(JobListing.company_id == company.id).all()
    }

    if not_modified:
        # Nothing changed on the board, by the server's own word — every
        # currently-open row is re-confirmed rather than silently aging
        # toward closure while this company's content sits still.
        for row in existing.values():
            if row.status == "open":
                row.last_seen_at = now
                row.missed_streak = 0
        return 0, 0, 0

    new_count = updated_count = closed_count = 0
    seen_keys: set[tuple[str | None, str, str | None]] = set()

    for item in rows:
        external_id = item.get("external_id")
        if not external_id:
            continue
        key = (item.get("source"), item.get("company"), external_id)
        seen_keys.add(key)
        digest = ingestion.content_hash(
            item.get("company", ""), item.get("title", ""), item.get("location", "")
        )

        row = existing.get(key)
        if row is None:
            row = JobListing(
                source=item.get("source"),
                company=item.get("company", ""),
                external_id=external_id,
                company_id=company.id,
                first_seen_at=now,
            )
            db.add(row)
            existing[key] = row
            new_count += 1
        elif row.content_hash != digest:
            updated_count += 1

        for column in (
            "query_key", "title", "location", "work_mode", "salary_range", "description",
            "skills", "apply_url", "posted_at", "department", "salary_min", "salary_max", "salary_currency",
        ):
            if item.get(column) is not None:
                setattr(row, column, item[column])

        row.content_hash = digest
        row.company_id = company.id
        row.status = "open"
        row.closed_at = None
        row.missed_streak = 0
        row.last_seen_at = now
        row.fetched_at = now

    for key, row in existing.items():
        if key in seen_keys or row.status != "open":
            continue
        row.missed_streak += 1
        if row.missed_streak >= CLOSE_AFTER_MISSED_CRAWLS:
            row.status = "closed"
            row.closed_at = now
            closed_count += 1

    return new_count, updated_count, closed_count


def _cleanup_retention(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.JOB_CLOSED_RETENTION_DAYS)
    return (
        db.query(JobListing)
        .filter(JobListing.status == "closed", JobListing.closed_at < cutoff)
        .delete(synchronize_session=False)
    )


def run_crawl(
    db: Session,
    trigger: str = "scheduled",
    triggered_by: str | None = None,
    company_ids: list[int] | None = None,
) -> CrawlRun:
    """One full crawl over every active, resolved company — or, with
    company_ids, just those (the admin API's per-company manual trigger).
    Always returns a persisted CrawlRun, even when nothing is configured to
    crawl yet."""
    run = CrawlRun(trigger=trigger, triggered_by=triggered_by)
    db.add(run)
    db.flush()

    query = db.query(Company).filter(Company.active.is_(True), Company.ats_type.in_(_ATS_DISPATCH))
    if company_ids is not None:
        query = query.filter(Company.id.in_(company_ids))
    companies = query.all()

    min_interval_ms = settings.CRAWLER_PER_DOMAIN_MIN_INTERVAL_MS
    results: dict[int, CompanyResult] = {}
    with ThreadPoolExecutor(max_workers=max(1, settings.CRAWLER_CONCURRENCY)) as pool:
        futures = {pool.submit(_crawl_one, company, min_interval_ms): company for company in companies}
        for future, company in futures.items():
            try:
                results[company.id] = future.result()
            except Exception as exc:  # noqa: BLE001 - a crashed future must not lose the rest
                results[company.id] = CompanyResult(error=str(exc))

    errors: list[str] = []
    for company in companies:
        result = results[company.id]
        run.companies_attempted += 1
        company.last_crawled_at = datetime.now(timezone.utc)

        if result.error:
            company.consecutive_failures += 1
            company.crawl_status = "failing"
            company.last_error = result.error[:2000]
            run.companies_failed += 1
            errors.append(f"{company.name}: {result.error}")
            continue

        company.consecutive_failures = 0
        company.crawl_status = "ok"
        company.last_error = None
        if result.etag:
            company.etag = result.etag
        if result.last_modified:
            company.last_modified = result.last_modified
        run.companies_succeeded += 1

        new_count, updated_count, closed_count = _reconcile_company_rows(
            db, company, result.rows, result.not_modified
        )
        run.jobs_new += new_count
        run.jobs_updated += updated_count
        run.jobs_closed += closed_count

    run.jobs_closed += _cleanup_retention(db)
    run.errors = json.dumps(errors[:50])
    run.ended_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(
        "crawl run %s: %d/%d companies ok, %d new, %d updated, %d closed",
        run.id, run.companies_succeeded, run.companies_attempted,
        run.jobs_new, run.jobs_updated, run.jobs_closed,
    )
    return run
