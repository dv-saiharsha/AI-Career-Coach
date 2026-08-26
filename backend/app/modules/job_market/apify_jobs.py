"""LinkedIn job ingestion via Apify's cheap_scraper/linkedin-job-scraper.

Field names below are taken from a real dataset item, not documentation. Two
things that cost money to discover and would otherwise fail silently:

  * `keyword` alone returns nothing. The actor needs `keyword` AND `locations`
    — with only a keyword it exits SUCCEEDED, writes an empty dataset, and
    still bills the start fee. A caller trusting the status would scrape
    nothing forever at $0.02 a run.
  * `maxItems` has a hard floor of 150 (`must be >= 150`), so there is no such
    thing as a cheap probe run. Minimum realistic cost per role is the start
    fee plus 150 results.

The SDK returns pydantic models, not dicts: `run.default_dataset_id`, never
`run["defaultDatasetId"]`.

Billing is pay-per-event — $0.005 per GB of memory at start (4 GB default, so
$0.02) plus $0.0007 per dataset item. Every call here passes
max_total_charge_usd so a runaway scrape is capped by Apify itself rather than
by our own bookkeeping.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from apify_client import ApifyClient

from app.core.config import settings

logger = logging.getLogger(__name__)

ACTOR_ID = "cheap_scraper/linkedin-job-scraper"

# The actor rejects anything lower with "Field input.maxItems must be >= 150".
MIN_ITEMS = 150

# Hard ceiling per run, enforced by Apify. Independent of the sweep-level
# ceiling in ingestion.py: this one bounds a single runaway actor, that one
# bounds the total across roles.
MAX_CHARGE_PER_RUN_USD = 1.00

# Keyword search is inert without a location (see module docstring).
DEFAULT_LOCATIONS = ["United States"]

POLL_INTERVAL_SECS = 6
POLL_TIMEOUT_SECS = 570


class ApifyUnavailable(RuntimeError):
    """The actor could not be run, or ran and produced nothing usable."""


@dataclass
class ApifyRunResult:
    items: list[dict]
    cost_usd: float
    run_id: str
    status: str


def is_configured() -> bool:
    return bool(settings.APIFY_API_TOKEN)


def _client() -> ApifyClient:
    if not is_configured():
        raise ApifyUnavailable("APIFY_API_TOKEN is not configured")
    return ApifyClient(settings.APIFY_API_TOKEN)


def build_run_input(keyword: str, locations: list[str] | None = None, max_items: int = MIN_ITEMS) -> dict:
    """Actor input. `keyword` and `locations` are both required in practice."""
    return {
        "keyword": [keyword],
        "locations": list(locations or DEFAULT_LOCATIONS),
        # Clamped rather than trusted: a caller passing 50 would have the run
        # rejected outright, wasting a round trip to learn a fixed rule.
        "maxItems": max(MIN_ITEMS, int(max_items)),
        # Apify-side dedup, so we aren't billed per result for rows we would
        # discard ourselves.
        "saveOnlyUniqueItems": True,
    }


def search(keyword: str, locations: list[str] | None = None, max_items: int = MIN_ITEMS) -> ApifyRunResult:
    """Run the actor for one keyword and return its dataset items.

    Started and polled explicitly rather than via `.call()`: that helper's
    `wait_duration` takes a timedelta, and passing an int raises *after* the
    run has already started — leaving a billed run orphaned with no handle on
    the results.
    """
    client = _client()
    try:
        run = client.actor(ACTOR_ID).start(
            run_input=build_run_input(keyword, locations, max_items),
            max_total_charge_usd=MAX_CHARGE_PER_RUN_USD,
        )
    except Exception as exc:
        raise ApifyUnavailable(f"could not start actor: {exc}") from exc

    run_client = client.run(run.id)
    deadline = time.monotonic() + POLL_TIMEOUT_SECS
    while True:
        current = run_client.get()
        if current.status not in ("RUNNING", "READY"):
            break
        if time.monotonic() > deadline:
            raise ApifyUnavailable(f"run {run.id} still running after {POLL_TIMEOUT_SECS}s")
        time.sleep(POLL_INTERVAL_SECS)

    cost = float(getattr(current, "usage_total_usd", 0.0) or 0.0)
    if current.status != "SUCCEEDED":
        raise ApifyUnavailable(f"run {run.id} finished {current.status} (billed ${cost:.4f})")

    items = list(client.dataset(current.default_dataset_id).iterate_items())
    if not items:
        # SUCCEEDED with an empty dataset is the actor's failure mode for bad
        # input, and the start fee is already spent. Loud, because silently
        # returning [] would look like "no jobs matched".
        logger.warning("apify: run %s succeeded but returned 0 items (billed $%.4f)", run.id, cost)
    return ApifyRunResult(items=items, cost_usd=cost, run_id=run.id, status=current.status)


# ── Field mapping ────────────────────────────────────────────────────────

_REMOTE = re.compile(r"\bremote\b", re.I)
_HYBRID = re.compile(r"\bhybrid\b", re.I)

# The actor's own experienceLevel strings, mapped to our vocabulary. Taken
# from real output ("Mid-Senior level"), not guessed.
_EXPERIENCE_MAP = {
    "internship": "entry",
    "entry level": "entry",
    "associate": "mid",
    "mid-senior level": "senior",
    "director": "lead",
    "executive": "lead",
}

_CONTRACT_MAP = {
    "full-time": "full_time",
    "part-time": "part_time",
    "contract": "contract",
    "temporary": "contract",
    "internship": "internship",
    "volunteer": "full_time",
}


def infer_work_mode(item: dict) -> str:
    haystack = f"{item.get('location', '')} {item.get('jobTitle', '')} {item.get('workType', '')}"
    if _REMOTE.search(haystack):
        return "Remote"
    if _HYBRID.search(haystack):
        return "Hybrid"
    return "On-site"


def derive_salary(item: dict) -> str | None:
    """salaryInfo comes back as a list of strings, e.g. ['$89200', '$209500']."""
    info = item.get("salaryInfo")
    if not isinstance(info, list):
        return None
    parts = [str(p).strip() for p in info if str(p).strip()]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} - {parts[1]}"


def map_experience_level(raw: str | None) -> str | None:
    """None when the actor gave nothing — never a default.

    A guessed level is indistinguishable from a stated one downstream, and
    "mid" is the wrong answer for both an internship and a staff role.
    """
    if not raw:
        return None
    return _EXPERIENCE_MAP.get(raw.strip().lower())


def map_employment_type(raw: str | None) -> str | None:
    if not raw:
        return None
    return _CONTRACT_MAP.get(raw.strip().lower())


def parse_published_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def normalise_item(item: dict, query_key: str) -> dict[str, Any] | None:
    """One dataset item to a JobListing row payload.

    Returns None when there's no usable apply link — a job card the user
    cannot act on is worse than one fewer result, and a "#" placeholder would
    look like a working link.
    """
    apply_url = (item.get("applyUrl") or item.get("jobUrl") or "").strip()
    if not apply_url.startswith(("http://", "https://")):
        return None

    title = (item.get("jobTitle") or "").strip()
    company = (item.get("companyName") or "").strip()
    if not title or not company:
        return None

    return {
        "query_key": query_key,
        "external_id": str(item.get("jobId") or apply_url),
        "title": title,
        "company": company,
        "location": (item.get("location") or "").strip() or "Not specified",
        "work_mode": infer_work_mode(item),
        "salary_range": derive_salary(item),
        # jobDescription, not description — the field the actor actually emits.
        "description": (item.get("jobDescription") or "").strip() or None,
        "skills": json.dumps([]),
        "apply_url": apply_url,
        "posted_at": parse_published_at(item.get("publishedAt")),
        # Straight from the source. Claude is not asked to infer either of
        # these: paying a model to guess what the posting already states would
        # be both slower and less accurate.
        "experience_level": map_experience_level(item.get("experienceLevel")),
        "employment_type": map_employment_type(item.get("contractType")),
    }


def normalise_items(items: list[dict], query_key: str) -> list[dict[str, Any]]:
    rows = [normalise_item(item, query_key) for item in items]
    return [row for row in rows if row is not None]
