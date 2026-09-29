"""Older board sweep: fetch Greenhouse/Lever/Ashby postings, enrich the new
ones, upsert, archive.

STILL HERE, NO LONGER THE PRIMARY PIPELINE

job_market/crawler.py — reading the `companies` table, covering all six ATS
adapters plus the JSON-LD fallback, with the close-after-2-misses lifecycle —
is what backend/scripts/run_crawl.py and the worker process
(app/worker.py) actually run in production. This module is what
job_market/scheduler.py's older in-process sweep still calls locally
(JOB_SWEEP_ENABLED, default on for a single dev process); production disables
it (docker-compose.prod.yml) since `worker` now covers the same ground and
more. It is kept working rather than deleted because retiring it outright is
a separate, later decision — not a rider on removing JSearch.

Cost shape. Only one half spends money:

    Boards   — free. Employers' own Greenhouse and Lever boards, no key and
               no per-call charge.
    Claude   — one batch request per *new* posting. Postings already enriched
               are skipped entirely (see `_unenriched`), so a re-run costs
               nothing for jobs already held.

    Experience level and employment type are NOT sent to Claude when a board
    states them: paying a model to infer what the source already says is
    slower and less accurate than reading it.

Nothing here runs on a web request. `dry_run` defaults to True so importing or
invoking this by mistake cannot spend anything.
"""

import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.llm import llm_client
from app.models.job import JobListing
from app.modules.job_market import ats_boards, boards_registry, enrichment, geo

logger = logging.getLogger(__name__)

# How long a batch may take before we stop waiting. The API's own ceiling is
# 24h; most finish inside an hour. A sweep that outlives this leaves the jobs
# stored unenriched rather than blocking a worker indefinitely.
BATCH_POLL_TIMEOUT_SECS = 3600
BATCH_POLL_INTERVAL_SECS = 15

# Postings older than this are dropped on the next sweep.
ARCHIVE_AFTER_HOURS = 72

# Ceiling for the Claude enrichment half, which is the only part that still
# bills per unit. The scraper this once bounded is gone.
MAX_SWEEP_COST_USD = 3.00

# _upsert commits every this many candidates rather than once for the whole
# sweep. At the board count boards_registry.py holds now, most of a sweep's
# candidates are already-known rows, so one UPDATE touching every row's
# fetched_at was 1,000+ parameter sets in a single executemany — comfortably
# past Supabase's pooled-connection statement timeout, which cancels the
# whole statement and rolls the entire sweep back to zero rows upserted
# rather than partially succeeding. A chunk this size finishes well inside
# that limit, and content_hash makes every row idempotent, so committing
# partial progress before a later failure is strictly better than an
# all-or-nothing sweep losing all of it.
CHUNK_SIZE = 250


def content_hash(company: str, title: str, location: str) -> str:
    """Stable identity for a posting across sweeps.

    Identity, not content: the same req re-listed with an edited description
    must hash the same, or every sweep would re-enrich it. Normalised so
    whitespace and casing differences between actor runs don't split one
    posting into two rows.
    """
    parts = [(company or "").strip().lower(), (title or "").strip().lower(), (location or "").strip().lower()]
    return hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()  # noqa: S324 - identity key, not a security digest


@dataclass
class SweepReport:
    """What a sweep actually did. Every figure is measured, not projected."""

    board_postings: int = 0
    boards_swept: int = 0
    # Rows a board returned that geo.is_non_us_location flagged — this app is
    # US-focused, and a multinational's Greenhouse/Lever board lists every
    # office's openings with no country filter of its own.
    postings_excluded_non_us: int = 0
    already_known: int = 0
    newly_enriched: int = 0
    enrichment_failures: int = 0
    rows_upserted: int = 0
    rows_archived: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    dry_run: bool = True
    errors: list[str] = field(default_factory=list)

    def claude_cost_usd(self) -> float:
        """Batch pricing for the enrichment model, from tokens actually used.

        Haiku 4.5 is $1/$5 per MTok; the Batch API halves both. Returns 0.0
        for any other model rather than guessing at a rate table that would go
        stale silently.
        """
        if enrichment.enrichment_model() != enrichment.DEFAULT_ENRICHMENT_MODEL:
            return 0.0
        return round(self.input_tokens / 1e6 * 0.50 + self.output_tokens / 1e6 * 2.50, 4)

    def total_cost_usd(self) -> float:
        """Computed Claude spend — the only part of this sweep that still
        bills per unit."""
        return round(self.claude_cost_usd(), 4)


def _unenriched(db: Session, candidates: dict[str, dict]) -> dict[str, dict]:
    """Drop candidates whose hash is already enriched in the database.

    This is the single largest cost lever in the pipeline. Enriching first and
    deduplicating at upsert — the obvious ordering — pays Claude again for
    every posting already held, which on a daily sweep is most of them.
    """
    if not candidates:
        return {}
    known = {
        row.content_hash
        for row in db.query(JobListing.content_hash)
        .filter(JobListing.content_hash.in_(list(candidates)), JobListing.enriched_at.isnot(None))
        .all()
    }
    return {h: item for h, item in candidates.items() if h not in known}


def _collect_boards(report: SweepReport) -> dict[str, dict]:
    """Employers' own Greenhouse and Lever boards. Free.

    Errors are already swallowed per board inside ats_boards.fetch_board — a
    404 there means "this company is not on this ATS", which is ordinary
    rather than a failure worth surfacing. What is recorded here is the count,
    so a sweep that quietly returned nothing is visible in the report.
    """
    candidates: dict[str, dict] = {}
    boards = boards_registry.all_boards()

    for provider, token in boards:
        rows = ats_boards.fetch_board(provider, token, query_key=f"{provider}:{token}")
        for row in rows:
            if geo.is_non_us_location(row["location"]):
                report.postings_excluded_non_us += 1
                continue
            key = content_hash(row["company"], row["title"], row["location"])
            candidates.setdefault(key, row)

    report.boards_swept = len(boards)
    report.board_postings = len(candidates)
    logger.info(
        "sweep: %d boards -> %d distinct postings (free), %d excluded as non-US",
        len(boards), len(candidates), report.postings_excluded_non_us,
    )
    return candidates


def _enrich(pending: dict[str, dict], report: SweepReport) -> dict[str, dict]:
    """Batch-enrich pending postings. Returns {content_hash: facts}."""
    if not pending or not llm_client.available:
        if pending and not llm_client.available:
            report.errors.append("ANTHROPIC_API_KEY not configured — postings stored unenriched")
        return {}

    # Beta namespace, not client.messages.batches: the pinned SDK (0.39.0)
    # exposes batches only under client.beta.messages. Importing the non-beta
    # path raises ModuleNotFoundError before a batch is ever created.
    from anthropic.types.beta.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.beta.messages.batch_create_params import Request

    requests = [
        Request(
            custom_id=digest,
            params=MessageCreateParamsNonStreaming(
                **enrichment.build_request_params(
                    item.get("title", ""), item.get("company", ""), item.get("description") or ""
                )
            ),
        )
        for digest, item in pending.items()
    ]

    client = llm_client._client
    batch = client.beta.messages.batches.create(requests=requests)
    logger.info("sweep: batch %s created for %d postings", batch.id, len(requests))

    deadline = time.monotonic() + BATCH_POLL_TIMEOUT_SECS
    while True:
        batch = client.beta.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        if time.monotonic() > deadline:
            report.errors.append(f"batch {batch.id} still running after {BATCH_POLL_TIMEOUT_SECS}s")
            return {}
        time.sleep(BATCH_POLL_INTERVAL_SECS)

    facts: dict[str, dict] = {}
    for result in client.beta.messages.batches.results(batch.id):
        # Keyed by custom_id, never by position — results come back in
        # arbitrary order.
        if result.result.type != "succeeded":
            report.enrichment_failures += 1
            continue
        message = result.result.message
        usage = getattr(message, "usage", None)
        if usage:
            report.input_tokens += getattr(usage, "input_tokens", 0) or 0
            report.output_tokens += getattr(usage, "output_tokens", 0) or 0
        facts[result.custom_id] = enrichment.parse_enrichment(message)

    report.newly_enriched = len(facts)
    return facts


def _upsert(db: Session, candidates: dict[str, dict], facts: dict[str, dict], report: SweepReport) -> None:
    now = datetime.now(timezone.utc)
    existing = {
        row.content_hash: row
        for row in db.query(JobListing).filter(JobListing.content_hash.in_(list(candidates))).all()
    }

    # Committed in chunks rather than as one transaction for the whole
    # sweep — see CHUNK_SIZE's own comment for why.
    since_commit = 0

    for digest, item in candidates.items():
        row = existing.get(digest)
        if row is None:
            row = JobListing(content_hash=digest)
            db.add(row)

        for column in ("query_key", "external_id", "title", "company", "location", "work_mode",
                       "salary_range", "description", "skills", "apply_url", "posted_at",
                       # Straight from the board — not inferred, not paid for.
                       "experience_level", "employment_type", "source"):
            if column in item:
                setattr(row, column, item[column])
        row.fetched_at = now

        enriched = facts.get(digest)
        if enriched:
            row.h1b_sponsorship = enriched["h1b_sponsorship"]
            row.h1b_evidence = enriched["h1b_evidence"] or None
            # Claude only fills what the actor left blank; a value stated by
            # the source always wins over an inferred one.
            if row.experience_level is None:
                row.experience_level = enriched["experience_level"]
            if row.employment_type is None:
                row.employment_type = enriched["employment_type"]
            row.enriched_at = now
            # Claude's skills replace the regex-extracted ones only when it
            # actually returned some; an empty list means it found nothing,
            # not that the cheaper extraction was wrong.
            if enriched["core_skills"]:
                row.skills = json.dumps(enriched["core_skills"])
        report.rows_upserted += 1
        since_commit += 1

        if since_commit >= CHUNK_SIZE:
            db.commit()
            since_commit = 0

    db.commit()


def _archive(db: Session, report: SweepReport) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=ARCHIVE_AFTER_HOURS)
    report.rows_archived = (
        db.query(JobListing).filter(JobListing.fetched_at < cutoff).delete(synchronize_session=False)
    )
    db.commit()


def refresh_global_jobs(db: Session, dry_run: bool = True) -> SweepReport:
    """Fetch, enrich, and upsert Greenhouse/Lever/Ashby board postings.

    dry_run defaults to True and is the only thing standing between an
    accidental call and real spend: it reports what a sweep *would* cost
    without issuing a single Anthropic request.
    """
    report = SweepReport(dry_run=dry_run)

    if dry_run:
        report.boards_swept = boards_registry.board_count()
        report.errors.append(
            f"DRY RUN — no requests issued. A live sweep would read "
            f"{boards_registry.board_count()} employer ATS boards at no cost, plus Claude "
            f"enrichment for postings not already stored — capped at ${MAX_SWEEP_COST_USD:.2f}."
        )
        return report

    candidates = _collect_boards(report)
    pending = _unenriched(db, candidates)
    report.already_known = len(candidates) - len(pending)

    # Persisted BEFORE enrichment, not after. Enrichment is a Claude batch
    # that can legitimately poll for an hour; holding the scraped rows in
    # memory across that window would mean a process restart loses the sweep
    # entirely. Rows land unenriched (enriched_at NULL) and the second pass
    # fills them in — which is also exactly the state a later sweep knows how
    # to resume from.
    _upsert(db, candidates, {}, report)

    facts = _enrich(pending, report) if pending else {}
    if facts:
        _upsert(db, candidates, facts, report)
    _archive(db, report)

    logger.info(
        "sweep: %d boards, %d postings (%d known), %d enriched — claude $%.4f",
        report.boards_swept, report.board_postings, report.already_known,
        report.newly_enriched, report.claude_cost_usd(),
    )
    return report
