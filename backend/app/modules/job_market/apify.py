"""Apify actor invocation and result normalisation for the job feed.

Everything that knows the actor's wire format lives here. services.py deals in
normalised dicts only, so swapping actors (or adding a second source) means
rewriting this file and nothing else.

Actor: khadinakbar/google-jobs-scraper, billed per result. `run_actor` is the
only function in the codebase that spends money — it is deliberately the one
place with a hard result ceiling and an explicit "no token, no call" guard.

The actor documents exactly five fields as always-present:
    job_title, is_remote, search_query, source_url, scraped_at
Everything else is nullable "depending on data availability from Google Jobs",
including company_name, location, and apply_link. normalise_item therefore
treats absence as the expected case, not an error — a null company must not
drop an otherwise usable listing, because we already paid for that row.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from apify_client import ApifyClient

from app.core.config import settings
from app.core.keywords import keyword_candidates

logger = logging.getLogger(__name__)

# Actor runs are slow (page fetch + per-listing detail expansion). This bounds
# how long a cache-miss request can hang before we give up and serve stale.
ACTOR_TIMEOUT_SECS = 120

# Skills shown per card. The frontend grid truncates visually anyway, and
# keyword_candidates returns up to 25 — most of which are long-tail noise.
MAX_SKILLS = 6


@dataclass
class ActorRun:
    """Result of one billed actor run.

    `cost_usd` comes from the run record rather than our own per-result
    arithmetic, so reported spend is what Apify actually charged even if the
    actor's pricing changes underneath us. None when the platform doesn't
    report it.
    """

    items: list[dict[str, Any]] = field(default_factory=list)
    cost_usd: float | None = None
    status: str = "UNKNOWN"


class ApifyUnavailable(RuntimeError):
    """No token configured, or the actor run failed.

    Callers are expected to fall back to cached rows rather than surface a
    5xx: a missing job feed should degrade the page, not break it.
    """


def is_configured() -> bool:
    return bool(settings.APIFY_API_TOKEN)


def run_actor(query: str, max_results: int) -> ActorRun:
    """Run the scraper for one search query and return its dataset and cost.

    This call is billed per returned result. `max_results` is clamped to
    JOB_MAX_RESULTS_PER_RUN before the call, so a bad caller can't turn a
    typo into a large charge.
    """
    if not is_configured():
        raise ApifyUnavailable("APIFY_API_TOKEN is not configured")

    capped = max(1, min(max_results, settings.JOB_MAX_RESULTS_PER_RUN))
    if capped < max_results:
        logger.warning(
            "job feed: clamped max_results %s -> %s for query %r", max_results, capped, query
        )

    client = ApifyClient(settings.APIFY_API_TOKEN)
    logger.info("job feed: running actor %s for %r (max %s)", settings.APIFY_ACTOR_ID, query, capped)
    try:
        run = client.actor(settings.APIFY_ACTOR_ID).call(
            run_input={"searchQueries": [query], "maxResults": capped},
            # Three independent brakes, deliberately redundant. maxResults
            # above is the actor's own input and it is free to ignore it;
            # max_items and max_total_charge_usd are enforced by Apify, so a
            # misbehaving actor still cannot bill past them.
            max_items=capped,
            max_total_charge_usd=Decimal(str(settings.JOB_MAX_SPEND_PER_RUN_USD)),
            run_timeout=timedelta(seconds=ACTOR_TIMEOUT_SECS),
            wait_duration=timedelta(seconds=ACTOR_TIMEOUT_SECS),
            # Default pipes the actor's own stdout into our logs, which buries
            # application logging under scraper chatter.
            logger=None,
        )
    except Exception as exc:  # apify-client raises a range of transport errors
        raise ApifyUnavailable(f"actor run failed: {exc}") from exc

    # call() returns None if the run did not finish inside wait_duration. The
    # actor may still be running and billing on Apify's side; we just stop
    # waiting for it.
    if run is None:
        raise ApifyUnavailable(f"actor run did not finish within {ACTOR_TIMEOUT_SECS}s")

    # `run` is a pydantic model, not a dict — attribute access, snake_case.
    cost = run.usage_total_usd
    if run.status != "SUCCEEDED":
        # ABORTED is what hitting max_total_charge_usd looks like, so surface
        # the status rather than reporting an empty-but-successful run.
        raise ApifyUnavailable(f"actor run ended {run.status} (billed ~${cost or 0:.4f})")
    if not run.default_dataset_id:
        raise ApifyUnavailable(f"actor run returned no dataset (billed ~${cost or 0:.4f})")

    items = client.dataset(run.default_dataset_id).list_items().items
    if not items:
        # A SUCCEEDED run with an empty dataset is almost never a genuinely
        # empty search — it is Google serving its bot-detection page, which
        # this actor reports as "no matching listings" and still bills for.
        # Say so, because the actor's own message actively misleads.
        logger.error(
            "job feed: %r returned 0 items but billed ~$%.4f. Usually means Google "
            "served a bot check (google.com/sorry) rather than an empty result set — "
            "check the run log at https://console.apify.com/actors/runs/%s",
            query,
            cost or 0,
            run.id,
        )
    else:
        logger.info(
            "job feed: actor returned %s items for %r (billed ~$%.4f)", len(items), query, cost or 0
        )
    return ActorRun(items=list(items), cost_usd=cost, status=run.status)


def infer_work_mode(raw: dict[str, Any]) -> str:
    """Map a listing onto the frontend's Remote | Hybrid | On-site union.

    Google Jobs has no work-mode field. `is_remote` is the one signal the
    actor guarantees, so it decides Remote; Hybrid only ever appears as prose
    in the location or description, hence the text sniff. Anything unproven
    falls through to On-site rather than guessing generously — a mislabelled
    Remote job is a worse user experience than a mislabelled On-site one.
    """
    if raw.get("is_remote"):
        return "Remote"
    haystack = " ".join(
        str(raw.get(field) or "") for field in ("location", "job_description", "employment_type")
    ).lower()
    if "hybrid" in haystack:
        return "Hybrid"
    return "On-site"


def derive_salary(raw: dict[str, Any]) -> str | None:
    """Prefer the actor's pre-formatted range; otherwise rebuild from parts."""
    if raw.get("salary_range"):
        return str(raw["salary_range"])

    low, high = raw.get("salary_min"), raw.get("salary_max")
    if low is None and high is None:
        return None

    period = f"/{raw['salary_period']}" if raw.get("salary_period") else ""
    if low is not None and high is not None:
        return f"${low:,.0f} - ${high:,.0f}{period}"
    single = low if low is not None else high
    return f"${single:,.0f}{period}"


def derive_skills(raw: dict[str, Any]) -> list[str]:
    """Extract skill-ish terms from the description.

    Reuses the resume analyzer's extractor rather than a second implementation
    so a term counts as a "skill" identically on both sides of the product —
    a job card and an ATS report should not disagree about what Kubernetes is.
    """
    text_parts = [str(raw.get("job_description") or "")]
    highlights = raw.get("highlights")
    if isinstance(highlights, dict):
        for value in highlights.values():
            if isinstance(value, list):
                text_parts.extend(str(v) for v in value)
            else:
                text_parts.append(str(value))
    elif isinstance(highlights, list):
        text_parts.extend(str(h) for h in highlights)

    combined = "\n".join(p for p in text_parts if p).strip()
    if not combined:
        return []
    return keyword_candidates(combined)[:MAX_SKILLS]


def parse_posted_at(raw: dict[str, Any]) -> datetime | None:
    """Best-effort parse of `date_posted`, which is free-form and often absent.

    Google Jobs frequently returns relative strings ("3 days ago") that are not
    parseable as timestamps. Those become None rather than a fabricated date —
    the frontend renders a missing posted date, which is honest, instead of
    claiming the listing appeared the moment we scraped it.
    """
    value = raw.get("date_posted")
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def normalise_item(raw: dict[str, Any], query_key: str) -> dict[str, Any] | None:
    """Convert one raw dataset item into JobListing column values.

    Returns None only when the listing is unusable — no title, or nowhere to
    apply. Every other missing field gets a defensible fallback, because the
    row is already paid for.
    """
    title = (raw.get("job_title") or "").strip()
    # apply_link is nullable; source_url is one of the five guaranteed fields,
    # so it is the correct fallback rather than dropping the row.
    apply_url = (raw.get("apply_link") or raw.get("source_url") or "").strip()
    if not title or not apply_url:
        return None

    return {
        "query_key": query_key,
        "external_id": str(raw.get("source_url") or "") or None,
        "title": title,
        "company": (raw.get("company_name") or "").strip() or "Company not listed",
        "location": (raw.get("location") or "").strip() or "Location not specified",
        "work_mode": infer_work_mode(raw),
        "salary_range": derive_salary(raw),
        # Same column as the JSearch path fills, so the drawer renders
        # identically whichever source JOB_SOURCE points at.
        "description": (raw.get("job_description") or "").strip()[:20_000] or None,
        "skills": json.dumps(derive_skills(raw)),
        "apply_url": apply_url,
        "posted_at": parse_posted_at(raw),
    }


def normalise_items(items: list[dict[str, Any]], query_key: str) -> list[dict[str, Any]]:
    """Normalise a dataset, dropping unusable rows and de-duplicating.

    Overlapping queries ("ml engineer" / "machine learning engineer") return
    the same posting more than once; dedupe on the apply URL so the grid never
    shows a visible duplicate.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for raw in items:
        row = normalise_item(raw, query_key)
        if row is None:
            continue
        if row["apply_url"] in seen:
            continue
        seen.add(row["apply_url"])
        out.append(row)
    return out
