"""The companies-table-driven crawl orchestrator.

WHY THIS IS A SEPARATE PIPELINE FROM INGESTION.PY'S EXISTING BOARD SWEEP

ingestion.py's board sweep (_collect_boards, run through scheduler.py) is
tested and still runs locally, doing exactly what it was built to do: free
Greenhouse/Lever/Ashby reads off boards_registry.py's curated list. (It used
to also run a budgeted JSearch aggregator pass; that half was removed along
with JSearch/RapidAPI entirely — see this repo's history for that change.)
It has no concept of a companies table, three more ATS adapters, or a job
lifecycle, and it does not need to be rewritten to gain them.

This module is that capability instead, as its own pipeline: it reads the
`companies` table (not boards_registry.py's hardcoded tuples), so it covers
all six ATS adapters plus the JSON-LD fallback, and it is what carries the
concurrency, per-domain rate limiting, retries, best-effort conditional
requests, and the close-after-2-misses lifecycle. It is what
backend/scripts/run_crawl.py and the worker process (app/worker.py) call.
Retiring the older sweep, or migrating it to read from `companies` too, is a
natural later step — deliberately not a rider on this change.

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

ENRICHMENT, AND WHY THE COST CAP IS ENFORCED HERE RATHER THAN TRUSTED

Every currently-open row with no enriched_at is a candidate, each run — not
just rows this run's companies touched, so a row a previous run's cap left
behind is picked up later rather than left behind forever. Reuses
ingestion.py's own Batch API code (_enrich), which needs no changes to work
here: it takes a plain {id: {title, company, description}} dict and returns
facts keyed the same way, regardless of what pipeline collected the rows.

The cap is real, unlike ingestion.MAX_SWEEP_COST_USD, which that module's
own sweep never actually checks anywhere in code — it only appears in a
dry-run message. Real cost isn't knowable before the Batch API responds, so
this is enforced by bounding *request count* going in, from a deliberately
pessimistic per-request cost (see _enrichment_request_cap) rather than a
post-hoc check that would only ever notice an overspend after it happened.
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

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.company import Company
from app.models.crawl_run import CrawlRun
from app.models.job import JobListing
from app.modules.job_market import ats_boards, enrichment, geo, ingestion, jsonld_crawler

logger = logging.getLogger(__name__)

# A row closes once its company has successfully crawled it as missing this
# many times in a row, and it has gone unseen for JOB_CLOSE_MIN_UNSEEN_HOURS.
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


# IDs per set-based UPDATE: well under any driver or planner limit.
_BULK_CHUNK = 5000


def _bulk_update(db: Session, ids: list[int], values: dict) -> None:
    """The same values on many rows, one UPDATE per chunk of ids.

    Why not per-row ORM attributes: the ORM batches only consecutive rows
    that changed exactly the same columns, and bookkeeping like missed_streak
    = 0 is a change on some rows and not others, so a crawl's updates went
    out a few at a time. Over a remote database (~80 ms a round trip through
    the Cloud SQL proxy) that was tens of minutes per crawl.

    synchronize_session="evaluate" applies the same values to the objects
    already loaded, so the rest of the run sees what was written.
    """
    for start in range(0, len(ids), _BULK_CHUNK):
        db.query(JobListing).filter(JobListing.id.in_(ids[start:start + _BULK_CHUNK])).update(
            values, synchronize_session="evaluate"
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

    The existing-row lookup below also matches rows with no company_id yet
    by (source, ats_slug) — via external_id's own embedded prefix, e.g.
    "greenhouse:mongodb:" — not just company_id == company.id. Without
    that, a company whose board the older ingestion.py sweep already wrote
    rows for (company_id NULL there — that sweep never links one) crashes
    the whole run: this crawl builds the exact same (source, company,
    external_id) key, sees no match by company_id, and tries to INSERT a
    second row into ix_job_listings_ats_identity's unique index, which
    rejects it.

    Matching by *name* here was tried first and is wrong: it crashed on its
    own first live run too, against a company this same fix was meant to
    protect. ats_boards.normalise_greenhouse() (and _lever) take a row's
    `company` value from the board's own API response (job.company_name, or
    the slug title-cased), never from this table's `name` column, so the
    two can disagree in real data — the legacy row and this table both say
    "mongodb" is the same board, but one spells it "Mongodb" and Greenhouse
    itself spells it "MongoDB". ats_slug has no such ambiguity: every
    adapter embeds it verbatim in external_id, so matching on that prefix
    finds the legacy row regardless of what either side calls the company.
    """
    now = datetime.now(timezone.utc)
    existing_filter = JobListing.company_id == company.id
    if company.ats_slug:
        existing_filter = or_(
            existing_filter,
            and_(
                JobListing.company_id.is_(None),
                JobListing.source == company.ats_type,
                JobListing.external_id.like(f"{company.ats_type}:{company.ats_slug}:%"),
            ),
        )
    existing = {
        (row.source, row.company, row.external_id): row
        for row in db.query(JobListing).filter(existing_filter).all()
    }

    if not_modified:
        # Nothing changed on the board, by the server's own word — every
        # currently-open row is re-confirmed rather than silently aging
        # toward closure while this company's content sits still.
        #
        # One set-based UPDATE per chunk, not a dirty attribute per row: the
        # ORM batches only consecutive rows that changed the same columns, and
        # missed_streak = 0 is a change on some rows and not others, so per-row
        # writes went out a few at a time. Over a remote database that was
        # minutes per crawl; most boards answer 304, so this is the hot path.
        open_ids = [row.id for row in existing.values() if row.status == "open" and row.id is not None]
        _bulk_update(db, open_ids, {JobListing.last_seen_at: now, JobListing.missed_streak: 0})
        return 0, 0, 0

    new_count = updated_count = closed_count = 0
    seen_keys: set[tuple[str | None, str, str | None]] = set()
    seen_ids: list[int] = []

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
                status="open",
                closed_at=None,
                missed_streak=0,
                last_seen_at=now,
                fetched_at=now,
            )
            db.add(row)
            existing[key] = row
            new_count += 1
        elif row.content_hash != digest:
            updated_count += 1

        # Content goes through the ORM, so only columns whose values really
        # changed are written.
        for column in (
            "query_key", "title", "location", "work_mode", "salary_range", "description",
            "skills", "apply_url", "posted_at", "department", "salary_min", "salary_max", "salary_currency",
        ):
            if item.get(column) is not None:
                setattr(row, column, item[column])
        row.content_hash = digest

        # The bookkeeping every seen row gets (seen now, open, no misses) is
        # identical, so it is one set-based UPDATE after the loop instead of a
        # dirty attribute per row: see _bulk_update.
        if row.id is not None:
            seen_ids.append(row.id)

    _bulk_update(db, seen_ids, {
        JobListing.company_id: company.id,
        JobListing.status: "open",
        JobListing.closed_at: None,
        JobListing.missed_streak: 0,
        JobListing.last_seen_at: now,
        JobListing.fetched_at: now,
    })

    # Open rows the board no longer lists: one more miss each, closed at the
    # threshold. Grouped by the current streak so each group is one UPDATE
    # with literal values, for the same reason as _bulk_update.
    unseen_cutoff = now - timedelta(hours=settings.JOB_CLOSE_MIN_UNSEEN_HOURS)
    groups: dict[tuple[int, bool], list[int]] = {}
    for key, row in existing.items():
        if key in seen_keys or row.status != "open" or row.id is None:
            continue
        streak = row.missed_streak or 0
        last_seen = row.last_seen_at
        if last_seen is not None and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)  # SQLite returns naive
        closes = streak + 1 >= CLOSE_AFTER_MISSED_CRAWLS and (last_seen is None or last_seen <= unseen_cutoff)
        groups.setdefault((streak, closes), []).append(row.id)
    for (streak, closes), ids in groups.items():
        values = {JobListing.missed_streak: streak + 1}
        if closes:
            values.update({JobListing.status: "closed", JobListing.closed_at: now})
            closed_count += len(ids)
        _bulk_update(db, ids, values)

    return new_count, updated_count, closed_count


def _cleanup_retention(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.JOB_CLOSED_RETENTION_DAYS)
    return (
        db.query(JobListing)
        .filter(JobListing.status == "closed", JobListing.closed_at < cutoff)
        .delete(synchronize_session=False)
    )


# Chars-per-token is a coarse approximation (English averages ~4), used only
# to size a *pessimistic* per-request cost estimate for the cap below — never
# for anything billed, which always comes from the API's own measured token
# usage (report.claude_cost_usd()).
_CHARS_PER_TOKEN_ESTIMATE = 4

# Tool schema + title/company aren't captured by the chars-per-token estimate
# below (they're a structured tool definition and two short fields, not
# description prose) — a flat token allowance stands in for them instead.
_ENRICHMENT_FIXED_OVERHEAD_TOKENS = 200


def _worst_case_cost_per_request_usd() -> float:
    """The most a single enrichment request could plausibly cost — the
    longest input this ever sends (MAX_DESCRIPTION_CHARS, the system
    prompt) and the hardest output ceiling the API call itself sets
    (MAX_TOKENS). Real per-request cost is normally lower; this estimate is
    deliberately pessimistic because _enrichment_request_cap divides a
    dollar budget by it — underestimating here is what would let a run
    actually overspend its cap.
    """
    input_tokens = (
        len(enrichment.ENRICHMENT_SYSTEM_PROMPT) + enrichment.MAX_DESCRIPTION_CHARS
    ) / _CHARS_PER_TOKEN_ESTIMATE + _ENRICHMENT_FIXED_OVERHEAD_TOKENS
    output_tokens = enrichment.MAX_TOKENS
    # Haiku 4.5 batch pricing — the same rate SweepReport.claude_cost_usd() uses.
    return (input_tokens / 1e6 * 0.50) + (output_tokens / 1e6 * 2.50)


def _enrichment_request_cap() -> int:
    """How many postings this run may enrich, derived from
    JOB_ENRICH_MAX_COST_PER_RUN_USD and the pessimistic per-request cost
    above — a real, checked-before-spending cap, not an aspirational one."""
    if not getattr(ingestion.llm_client, "supports_batch", False):
        # No batch API (Ollama): nothing bills, but each posting is its own
        # sequential request, so the bound is a request count, not dollars.
        # 0 turns enrichment off.
        return max(0, settings.OLLAMA_ENRICH_MAX_PER_RUN)
    return max(1, int(settings.JOB_ENRICH_MAX_COST_PER_RUN_USD / _worst_case_cost_per_request_usd()))


def _enrich_pending(db: Session, run: CrawlRun, errors: list[str]) -> dict:
    """Batch-enrich currently-open rows with no enriched_at, oldest-fetched
    first, up to _enrichment_request_cap() of them. A backlog bigger than
    the cap is not lost — enriched_at stays null on whatever wasn't reached,
    so the next run's own query picks those rows up again.
    """
    cap = _enrichment_request_cap()
    pending_rows = (
        db.query(JobListing)
        .filter(JobListing.status == "open", JobListing.enriched_at.is_(None))
        .order_by(JobListing.fetched_at.asc())
        .limit(cap)
        .all()
    )
    if not pending_rows:
        return {"pending": 0, "cap": cap, "enriched": 0, "failed": 0}

    pending = {
        str(row.id): {"title": row.title, "company": row.company, "description": row.description or ""}
        for row in pending_rows
    }

    report = ingestion.SweepReport(dry_run=False)
    facts = ingestion._enrich(pending, report)

    now = datetime.now(timezone.utc)
    by_id = {row.id: row for row in pending_rows}
    for key, item in facts.items():
        row = by_id.get(int(key))
        if row is None:
            continue
        row.h1b_sponsorship = item["h1b_sponsorship"]
        row.h1b_evidence = item["h1b_evidence"] or None
        # Claude only fills what the source left blank; a value the source
        # itself stated always wins over an inferred one.
        if row.experience_level is None:
            row.experience_level = item["experience_level"]
        if row.employment_type is None:
            row.employment_type = item["employment_type"]
        row.enriched_at = now
        if item["core_skills"]:
            row.skills = json.dumps(item["core_skills"])

    run.cost_usd = (run.cost_usd or 0.0) + report.claude_cost_usd()
    errors.extend(report.errors)

    logger.info(
        "crawl enrichment: %d pending (cap %d), %d enriched, %d failed, $%.4f",
        len(pending_rows), cap, report.newly_enriched, report.enrichment_failures, report.claude_cost_usd(),
    )
    return {
        "pending": len(pending_rows), "cap": cap,
        "enriched": report.newly_enriched, "failed": report.enrichment_failures,
    }


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
    # Per crawler (ATS type): what it fetched and what that became.
    by_crawler: dict[str, dict] = {}
    for company in companies:
        result = results[company.id]
        run.companies_attempted += 1
        company.last_crawled_at = datetime.now(timezone.utc)
        tally = by_crawler.setdefault(company.ats_type, {
            "companies": 0, "failed": 0, "fetched": 0, "new": 0, "updated": 0, "duplicates": 0, "errors": [],
        })
        tally["companies"] += 1

        if result.error:
            company.consecutive_failures += 1
            company.crawl_status = "failing"
            company.last_error = result.error[:2000]
            run.companies_failed += 1
            errors.append(f"{company.name}: {result.error}")
            tally["failed"] += 1
            if len(tally["errors"]) < 5:
                tally["errors"].append(f"{company.name}: {result.error[:200]}")
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
        fetched = 0 if result.not_modified else len(result.rows)
        tally["fetched"] += fetched
        tally["new"] += new_count
        tally["updated"] += updated_count
        # Fetched again and already stored unchanged.
        tally["duplicates"] += max(0, fetched - new_count - updated_count)

    # Committed here, before enrichment — not just at the very end. Every
    # company's crawl result is the actual product of this run; enrichment
    # is a nice-to-have on top of it. Without this checkpoint, an enrichment
    # failure (a real one: this exact bug shipped once, and an Anthropic API
    # error crashed the whole run before its one and only db.commit(),
    # silently discarding every company crawled and every row reconciled)
    # would lose the entire run's real work along with it.
    db.commit()

    enrichment = {"pending": 0, "cap": 0, "enriched": 0, "failed": 0}
    try:
        enrichment = _enrich_pending(db, run, errors)
    except Exception as exc:  # noqa: BLE001 - enrichment failing must not lose the crawl above
        db.rollback()
        logger.exception("crawl enrichment failed, crawl results already committed")
        errors.append(f"enrichment failed: {exc}")

    run.jobs_closed += _cleanup_retention(db)
    run.errors = json.dumps(errors[:50])
    run.stats = json.dumps({
        "fetched": sum(t["fetched"] for t in by_crawler.values()),
        "duplicates": sum(t["duplicates"] for t in by_crawler.values()),
        "enrichment": enrichment,
        "by_crawler": by_crawler,
    })
    run.ended_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(
        "crawl run %s: %d/%d companies ok, %d new, %d updated, %d closed, %d enriched",
        run.id, run.companies_succeeded, run.companies_attempted,
        run.jobs_new, run.jobs_updated, run.jobs_closed, enrichment["enriched"],
    )
    for crawler, tally in sorted(by_crawler.items()):
        logger.info(
            "crawl run %s [%s]: %d companies (%d failed), %d fetched, %d new, %d updated, %d duplicates%s",
            run.id, crawler, tally["companies"], tally["failed"], tally["fetched"], tally["new"],
            tally["updated"], tally["duplicates"], f", errors: {tally['errors']}" if tally["errors"] else "",
        )
    return run
