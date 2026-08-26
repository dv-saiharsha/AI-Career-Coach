"""Background sweep: fetch postings, enrich the new ones, upsert, archive.

Cost shape, since both halves of this spend real money:

    Apify    — ~$0.13 per role: $0.02 actor start plus 150 results at $0.0007.
               The 150-result floor is enforced by the actor, so there is no
               cheaper sweep. Two ceilings apply: max_total_charge_usd bounds
               each individual run server-side, and MAX_SWEEP_COST_USD below
               bounds the total across roles by checking accumulated spend
               between runs.
    Claude   — one batch request per *new* posting. Postings already enriched
               are skipped entirely (see `_unenriched`), so a re-run costs
               nothing for jobs already held. Without that filter a daily sweep
               re-pays for roughly everything inside the 72h TTL.

    Experience level and employment type are NOT sent to Claude: the actor
    already reports both, and paying a model to infer what the source states
    is slower and less accurate than reading it.

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

from app.core.config import settings
from app.core.llm import llm_client
from app.models.job import JobListing
from app.modules.job_market import apify_jobs, enrichment, services

logger = logging.getLogger(__name__)

# How long a batch may take before we stop waiting. The API's own ceiling is
# 24h; most finish inside an hour. A sweep that outlives this leaves the jobs
# stored unenriched rather than blocking a worker indefinitely.
BATCH_POLL_TIMEOUT_SECS = 3600
BATCH_POLL_INTERVAL_SECS = 15

# Postings older than this are dropped on the next sweep.
ARCHIVE_AFTER_HOURS = 72

# Ceiling for a whole sweep, checked against accumulated usage_total_usd
# between runs. Distinct from apify_jobs.MAX_CHARGE_PER_RUN_USD, which Apify
# enforces per run: nine runs each under a $1 per-run cap could still reach $9
# without this.
MAX_SWEEP_COST_USD = 3.00


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

    roles_searched: list[str] = field(default_factory=list)
    apify_cost_usd: float = 0.0
    runs_completed: int = 0
    stopped_on_budget: bool = False
    postings_seen: int = 0
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
        """Apify's own billed figure plus computed Claude spend. The Apify half
        is what the API reported, not a projection."""
        return round(self.apify_cost_usd + self.claude_cost_usd(), 4)


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


def _collect(db: Session, roles: list[str], report: SweepReport) -> dict[str, dict]:
    """One actor run per role, stopping if the sweep ceiling is reached.

    The budget check happens *between* runs using each run's real billed cost,
    so a sweep can overshoot by at most one role rather than by the whole
    remaining list.
    """
    locations = [loc.strip() for loc in (settings.JOB_LOCATIONS or "").split(",") if loc.strip()]
    candidates: dict[str, dict] = {}

    for role in roles:
        if report.apify_cost_usd >= MAX_SWEEP_COST_USD:
            report.stopped_on_budget = True
            report.errors.append(
                f"sweep ceiling ${MAX_SWEEP_COST_USD:.2f} reached after "
                f"{report.runs_completed} role(s) — remaining roles skipped"
            )
            break

        try:
            result = apify_jobs.search(role, locations=locations)
        except apify_jobs.ApifyUnavailable as exc:
            # A failed run may still have billed the start fee, so this is
            # recorded rather than retried — retrying would pay twice for the
            # same bad input.
            report.errors.append(f"{role}: {exc}")
            logger.warning("sweep: %s failed (%s)", role, exc)
            continue

        report.roles_searched.append(role)
        report.runs_completed += 1
        report.apify_cost_usd = round(report.apify_cost_usd + result.cost_usd, 4)

        for row in apify_jobs.normalise_items(result.items, role):
            report.postings_seen += 1
            digest = content_hash(row.get("company", ""), row.get("title", ""), row.get("location", ""))
            # First occurrence wins: the same posting surfacing under two roles
            # is one job, and enriching it twice would be paying twice.
            candidates.setdefault(digest, {**row, "content_hash": digest})
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

    for digest, item in candidates.items():
        row = existing.get(digest)
        if row is None:
            row = JobListing(content_hash=digest)
            db.add(row)

        for column in ("query_key", "external_id", "title", "company", "location", "work_mode",
                       "salary_range", "description", "skills", "apply_url", "posted_at",
                       # Straight from the actor — not inferred, not paid for.
                       "experience_level", "employment_type"):
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

    db.commit()


def _archive(db: Session, report: SweepReport) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=ARCHIVE_AFTER_HOURS)
    report.rows_archived = (
        db.query(JobListing).filter(JobListing.fetched_at < cutoff).delete(synchronize_session=False)
    )
    db.commit()


def refresh_global_jobs(
    db: Session, roles: list[str] | None = None, dry_run: bool = True
) -> SweepReport:
    """Fetch, enrich, and upsert postings for each warm role.

    dry_run defaults to True and is the only thing standing between an
    accidental call and real spend: it reports what a sweep *would* cost
    without issuing a single Apify or Anthropic request.
    """
    targets = list(roles or services.WARM_ROLES)
    report = SweepReport(dry_run=dry_run)

    if dry_run:
        report.roles_searched = targets
        # ~$0.13 a role: $0.02 actor start + 150 results at $0.0007.
        projected = round(len(targets) * 0.1270, 2)
        report.errors.append(
            f"DRY RUN — no requests issued. A live sweep would run {len(targets)} actor(s) at "
            f"roughly ${projected:.2f} on Apify, plus Claude enrichment for postings not "
            f"already stored, stopping at the ${MAX_SWEEP_COST_USD:.2f} ceiling."
        )
        return report

    if not apify_jobs.is_configured():
        report.errors.append("APIFY_API_TOKEN not configured — nothing fetched")
        return report

    candidates = _collect(db, targets, report)
    pending = _unenriched(db, candidates)
    report.already_known = len(candidates) - len(pending)

    facts = _enrich(pending, report) if pending else {}
    _upsert(db, candidates, facts, report)
    _archive(db, report)

    logger.info(
        "sweep: %d roles, %d postings (%d known), %d enriched — apify $%.4f + claude $%.4f",
        len(report.roles_searched), report.postings_seen, report.already_known,
        report.newly_enriched, report.apify_cost_usd, report.claude_cost_usd(),
    )
    return report
