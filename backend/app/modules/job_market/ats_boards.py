"""Jobs straight from employers' own ATS boards. Free, keyed to no account.

WHY THIS SOURCE EXISTS ALONGSIDE APIFY

The Apify LinkedIn scraper is billed per run and bounded by two cost ceilings
in ingestion.py, which is why the feed is as small as it is. Greenhouse and
Lever both publish the job board of every company that uses them as public
JSON, with no key, no account and no per-call charge. One request to
Greenhouse returned 611 Stripe roles with full descriptions; one to Lever
returned 310 from Palantir.

It is also better data. These are the employer's own postings rather than a
scrape of an aggregator's rendering of them, so the title, location and apply
URL are first-hand, and the apply URL goes to the real application form
instead of a LinkedIn interstitial.

THE PART THAT MATTERS MOST

Every row carries `source`. A posting fetched from boards-api.greenhouse.io IS
a Greenhouse posting — that is not inferred, it is where the bytes came from.

That closes a gap this codebase could not otherwise fill. The job cards wanted
a "Via Workday" style label and could not have one: 2,536 of ~2,570 existing
apply URLs are linkedin.com, so the ATS was unknowable and guessing it would
have been fabrication. Here it is known by construction.

It also connects to resume_analyzer/ats_vendors.py, which already computes
which ATS parsers a given resume loses content in. Knowing a posting routes
through Greenhouse, and that this candidate's resume fails a Greenhouse-
sensitive check, is a specific and actionable warning rather than a general
one.

POLITENESS

These are free endpoints run as a courtesy, and nothing here is entitled to
them. One request per board, a short timeout, no retries, and failures are
swallowed per board so one unreachable company cannot stop a sweep. Callers
schedule the sweep; this module never loops on its own.
"""

from __future__ import annotations

import html
import json
import logging
import re
from datetime import datetime, timezone
from typing import Callable, Iterable
from app.modules.job_market import boards_registry

logger = logging.getLogger(__name__)

GREENHOUSE_URL = "https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
LEVER_URL = "https://api.lever.co/v0/postings/{board}?mode=json"
# Ashby publishes the same public board API. includeCompensation is opt-in
# and free, and it is the only one of the three providers that returns pay
# as structured numbers rather than prose buried in the description.
ASHBY_URL = (
    "https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true"
)

# Long enough for a large board, short enough that a hung host cannot stall a
# sweep. Stripe's 611-job payload is ~380KB and returns well inside this.
TIMEOUT_SECONDS = 20

# Descriptions are stored for matching and for the detail drawer. Past this
# they are all boilerplate — benefits, EEO statements, office photos — and the
# column is Text but the matcher only reads the first few thousand characters.
MAX_DESCRIPTION_CHARS = 12_000

_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")


def strip_html(raw: str | None) -> str:
    """Greenhouse returns HTML-escaped HTML. Both layers have to come off.

    The content field arrives double-encoded — `&lt;p&gt;` rather than `<p>` —
    so unescaping first turns it into real tags, and only then can they be
    removed. Doing it in the other order leaves the markup visible in the
    stored description, which is what the matcher would then read.
    """
    if not raw:
        return ""
    text = html.unescape(raw)
    # Block-level tags become newlines so paragraph structure survives; the
    # rest simply go. A resume matcher does not care about <em>, but it does
    # care that two paragraphs are not run into one sentence.
    text = re.sub(r"<(?:br|/p|/div|/li|/h[1-6])\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = _TAG.sub("", text)
    text = html.unescape(text)

    # Line by line, because a regex over the whole blob does not catch this.
    #
    # Every </p>, </li> and <br> above became a newline, so a posting with
    # twenty bullets arrives with dozens of blank lines between them — and a
    # "blank" line is usually "\n \n", holding the single space left behind by
    # the tag that used to be there. Collapsing runs of newlines misses those
    # entirely, because the space breaks the run.
    #
    # Measured on the stored feed before this: 33 blank-line runs per
    # description on average, as many as 50. The detail drawer renders
    # descriptions with whitespace-pre-line, so every one became a visible
    # paragraph break and a job description ended in a screen and a half of
    # nothing before the Apply button.
    lines = [_WHITESPACE.sub(" ", line).strip() for line in text.split("\n")]

    cleaned: list[str] = []
    for line in lines:
        # At most one blank line between paragraphs. Two in a row carry no
        # more meaning than one and cost a screenful.
        if not line and (not cleaned or not cleaned[-1]):
            continue
        cleaned.append(line)

    return "\n".join(cleaned).strip()[:MAX_DESCRIPTION_CHARS]



def _ashby_salary(compensation: dict | None) -> str | None:
    """Ashby's structured pay -> the one-line string the rest of the app uses.

    Returns None rather than a partial range: "USD 180000 -" is worse than
    saying nothing, because the UI renders whatever it is given.
    """
    if not compensation:
        return None
    for tier in compensation.get("compensationTiers") or []:
        for component in tier.get("components") or []:
            if (component.get("compensationType") or "").lower() != "salary":
                continue
            low, high = component.get("minValue"), component.get("maxValue")
            currency = component.get("currencyCode") or "USD"
            if low and high:
                return f"{currency} {int(low):,} - {int(high):,}"
            if low:
                return f"{currency} {int(low):,}+"
    return None


def normalise_ashby(
    payload: dict, board: str, query_key: str, display_name: str | None = None
) -> list[dict]:
    """Ashby board JSON -> the same row shape as the other two providers.

    Ashby gives descriptionPlain as real text, so the HTML fallback is only
    for boards that omit it.

    display_name exists because Ashby's board API returns no company name at
    all — not on the posting and not on the payload. Falling back to the
    token would put "openai" and "mistral.ai" in front of users as employer
    names, so the registry carries the real name and the discovery script
    reads it from the directory feed that already knows it.

    isListed is honoured: a posting can exist in the API while the company
    has unpublished it, and importing those would show applicants roles the
    employer has deliberately taken down.
    """
    rows = []
    for job in payload.get("jobs") or []:
        title = (job.get("title") or "").strip()
        apply_url = (job.get("applyUrl") or job.get("jobUrl") or "").strip()
        if not title or not apply_url:
            continue
        if job.get("isListed") is False:
            continue

        location = (job.get("location") or "").strip() or "Not specified"
        description = job.get("descriptionPlain") or strip_html(job.get("descriptionHtml"))
        rows.append(
            {
                "query_key": query_key,
                "external_id": f"ashby:{board}:{job.get('id')}",
                "title": title,
                "company": display_name or board,
                "location": location,
                # Ashby states remoteness outright, so it is used in
                # preference to inferring it from the location string.
                "work_mode": "Remote" if job.get("isRemote") else _work_mode(location),
                "salary_range": _ashby_salary(job.get("compensation")),
                "description": (description or "").strip()[:MAX_DESCRIPTION_CHARS] or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _parse_iso(job.get("publishedAt")),
                "source": "ashby",
            }
        )
    return rows


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _from_epoch_ms(value) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _work_mode(location: str) -> str:
    """Remote / Hybrid / On-site from the location string.

    These boards have no structured remote flag, so the location text is all
    there is. Anything unrecognised is On-site rather than a guess: a posting
    wrongly labelled Remote wastes an application, which is a worse error than
    one wrongly labelled On-site that a candidate opens anyway.
    """
    lowered = (location or "").lower()
    if "hybrid" in lowered:
        return "Hybrid"
    if "remote" in lowered or "anywhere" in lowered or "distributed" in lowered:
        return "Remote"
    return "On-site"


def normalise_greenhouse(payload: dict, board: str, query_key: str) -> list[dict]:
    """Greenhouse board JSON -> the same row shape apify_jobs produces."""
    rows = []
    for job in payload.get("jobs") or []:
        apply_url = (job.get("absolute_url") or "").strip()
        title = (job.get("title") or "").strip()
        if not apply_url or not title:
            continue

        location = ((job.get("location") or {}).get("name") or "").strip() or "Not specified"
        rows.append(
            {
                "query_key": query_key,
                "external_id": f"greenhouse:{board}:{job.get('id')}",
                "title": title,
                "company": (job.get("company_name") or board).strip(),
                "location": location,
                "work_mode": _work_mode(location),
                "salary_range": None,
                "description": strip_html(job.get("content")) or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _parse_iso(job.get("first_published") or job.get("updated_at")),
                "source": "greenhouse",
            }
        )
    return rows


def normalise_lever(payload: list, board: str, query_key: str) -> list[dict]:
    """Lever postings JSON -> the same row shape.

    Lever gives descriptionPlain already as text, so no HTML stripping is
    needed — using it rather than re-deriving from the HTML avoids introducing
    a second, subtly different cleaner for the same field.
    """
    rows = []
    for job in payload or []:
        apply_url = (job.get("hostedUrl") or job.get("applyUrl") or "").strip()
        title = (job.get("text") or "").strip()
        if not apply_url or not title:
            continue

        categories = job.get("categories") or {}
        location = (categories.get("location") or "").strip() or "Not specified"
        workplace = (categories.get("workplaceType") or "").strip().lower()

        description = (job.get("descriptionPlain") or "").strip()
        extra = (job.get("additionalPlain") or "").strip()
        if extra:
            description = f"{description}\n\n{extra}".strip()

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"lever:{board}:{job.get('id')}",
                "title": title,
                "company": board.replace("-", " ").title(),
                "location": location,
                # Lever does carry a structured workplaceType, so it is used in
                # preference to reading the location string.
                "work_mode": (
                    "Remote"
                    if workplace == "remote"
                    else "Hybrid"
                    if workplace == "hybrid"
                    else _work_mode(location)
                ),
                "salary_range": None,
                "description": description[:MAX_DESCRIPTION_CHARS] or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _from_epoch_ms(job.get("createdAt")),
                "source": "lever",
            }
        )
    return rows


def _default_fetch(url: str) -> tuple[int, str]:
    import urllib.request

    request = urllib.request.Request(
        url,
        headers={
            # Identifying rather than anonymous. These endpoints are a
            # courtesy and an operator who wants to block us should be able to
            # tell who we are.
            "User-Agent": "ApplyCenter/1.0 (job board reader; +https://applycenter.org)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status, response.read().decode("utf-8", errors="replace")


def fetch_board(
    provider: str,
    board: str,
    query_key: str = "ats-board",
    fetch: Callable[[str], tuple[int, str]] | None = None,
    display_name: str | None = None,
) -> list[dict]:
    """One board from one provider. Returns [] on any failure.

    Swallows rather than raises so a sweep over dozens of boards is not ended
    by one company that has closed its board, renamed it, or is briefly down —
    a 404 here means "this company does not use this ATS", which is ordinary
    and not an error worth propagating.
    """
    fetch = fetch or _default_fetch
    urls = {"greenhouse": GREENHOUSE_URL, "lever": LEVER_URL, "ashby": ASHBY_URL}
    if provider not in urls:
        logger.warning("unknown ATS provider %r for board %s", provider, board)
        return []
    url = urls[provider].format(board=board)

    try:
        status, body = fetch(url)
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same non-event
        logger.info("ats board %s/%s unreachable: %s", provider, board, exc)
        return []

    if status != 200:
        logger.info("ats board %s/%s returned %s", provider, board, status)
        return []

    try:
        payload = json.loads(body)
    except ValueError:
        logger.info("ats board %s/%s returned non-JSON", provider, board)
        return []

    if provider == "greenhouse":
        return normalise_greenhouse(payload, board, query_key)
    if provider == "ashby":
        return normalise_ashby(payload, board, query_key, display_name)
    return normalise_lever(payload, board, query_key)


def fetch_boards(
    boards: Iterable[tuple[str, str]],
    query_key: str = "ats-board",
    fetch: Callable[[str], tuple[int, str]] | None = None,
) -> list[dict]:
    """Several boards, as (provider, board) pairs. Order is preserved."""
    rows: list[dict] = []
    for provider, board in boards:
        found = fetch_board(
            provider,
            board,
            query_key=query_key,
            fetch=fetch,
            display_name=boards_registry.display_name(provider, board),
        )
        logger.info("ats board %s/%s -> %d roles", provider, board, len(found))
        rows.extend(found)
    return rows
