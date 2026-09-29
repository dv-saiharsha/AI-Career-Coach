"""Fallback source: schema.org JobPosting JSON-LD on a company's own careers
page, for companies on none of the six ATS providers ats_boards.py reads.

WHY THIS EXISTS AND WHAT IT DELIBERATELY DOES NOT DO

Google's own job-search indexing guidance is why this markup exists on the
open web at all: a careers page that wants to appear in job search results
embeds a <script type="application/ld+json"> block describing the posting as
structured data. Reading it is not scraping a rendering meant for humans —
it is reading data the page already published for a machine to read.

Scope is deliberately narrow: this fetches exactly the one page at a
company's careers_url and looks for JobPosting objects on it. It does not
discover or follow links to individual job detail pages. A listing page that
embeds JobPosting JSON-LD directly (common, since it's what most SEO guides
recommend) is covered; a site that only marks up individual job pages,
linked from an unmarked listing page, is not — that company's registry row
stays "manual_review" rather than this silently returning nothing and
looking like an empty board.

POLITENESS

Every fetch (robots.txt and the page itself) carries a User-Agent naming a
real contact (CRAWLER_CONTACT_EMAIL), matching ats_boards.py's identifying-
rather-than-anonymous stance. robots.txt is checked before the page itself
and an explicit disallow is honored outright — this reads someone else's
website, not a public API built for this purpose, so there is less benefit
of the doubt to extend than ats_boards.py's six providers get.
LinkedIn/Indeed/Glassdoor and any other site whose terms forbid automated
access are out of scope entirely and this module has no allowance to fetch
them regardless of what their markup contains.
"""

from __future__ import annotations

import html
import json
import logging
import re
import urllib.robotparser
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlsplit, urlunsplit

from app.modules.job_market.ats_boards import strip_html

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 20
MAX_DESCRIPTION_CHARS = 12_000

# Fallback company label matching services.company_logo_url's own check for
# "no usable name" — one literal, not two spellings of the same absence.
_NO_COMPANY = "Company not listed"

_LDJSON_BLOCK = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _infer_work_mode(location: str) -> str:
    """Mirrors ats_boards._work_mode's heuristic and its reasoning: an
    unrecognised location stays On-site rather than a guessed Remote, since a
    wrongly-hidden real posting costs an application, which is worse than a
    wrongly-shown on-site one costing ten seconds of a candidate reading a
    card they skip. Kept as its own copy rather than importing a
    same-package private helper across modules."""
    lowered = (location or "").lower()
    if "hybrid" in lowered:
        return "Hybrid"
    if "remote" in lowered or "anywhere" in lowered or "distributed" in lowered:
        return "Remote"
    return "On-site"


def _default_fetch(url: str) -> tuple[int, str]:
    import urllib.request

    from app.core.config import settings

    contact = settings.CRAWLER_CONTACT_EMAIL or "crawler-contact-not-configured@example.com"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"HireLoomBot/1.0 (job crawler; +mailto:{contact})",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.status, response.read().decode("utf-8", errors="replace")


def _robots_allow(url: str, fetch: Callable[[str], tuple[int, str]]) -> bool:
    """Whether robots.txt permits fetching `url`. Defaults to allow when
    robots.txt is unreachable or absent — a 404 there is the ordinary,
    documented case (most sites have none), not a reason to refuse a page
    that itself never said not to be read."""
    parsed = urlsplit(url)
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    try:
        status, body = fetch(robots_url)
    except Exception as exc:  # noqa: BLE001 - unreachable robots.txt is not a block
        logger.info("jsonld robots.txt unreachable for %s, proceeding: %s", robots_url, exc)
        return True
    if status != 200:
        return True

    parser = urllib.robotparser.RobotFileParser()
    parser.parse(body.splitlines())
    return parser.can_fetch("HireLoomBot", url)


def _type_matches(value, wanted: str = "JobPosting") -> bool:
    if isinstance(value, str):
        return value == wanted
    if isinstance(value, list):
        return wanted in value
    return False


def _jobpostings_in(data) -> list[dict]:
    """Every JobPosting object in one parsed JSON-LD blob. Real sites embed
    it three ways: a single object, a bare list of objects, or an object
    with an @graph list — all three are handled the same afterward."""
    candidates: list = []
    if isinstance(data, dict):
        graph = data.get("@graph")
        candidates.extend(graph if isinstance(graph, list) else [data])
    elif isinstance(data, list):
        candidates.extend(data)
    return [item for item in candidates if isinstance(item, dict) and _type_matches(item.get("@type"))]


def _extract_jobpostings(page_html: str) -> list[dict]:
    postings: list[dict] = []
    for match in _LDJSON_BLOCK.finditer(page_html):
        raw = html.unescape(match.group(1)).strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        postings.extend(_jobpostings_in(data))
    return postings


def _location_from(posting: dict) -> tuple[str, bool]:
    """(location string, is_remote). schema.org's remote signal is
    jobLocationType == "TELECOMMUTE", stated outright rather than inferred —
    preferred over reading the address the same way every other adapter in
    this package prefers a structured flag over a location-string guess."""
    if (posting.get("jobLocationType") or "").upper() == "TELECOMMUTE":
        return "Remote", True

    job_location = posting.get("jobLocation")
    if isinstance(job_location, list):
        job_location = job_location[0] if job_location else None
    address = (job_location or {}).get("address") if isinstance(job_location, dict) else None
    if not isinstance(address, dict):
        return "Not specified", False

    parts = [address.get("addressLocality"), address.get("addressRegion"), address.get("addressCountry")]
    location = ", ".join(p for p in parts if p) or "Not specified"
    return location, False


def _salary_from(posting: dict) -> tuple[int | None, int | None, str | None, str | None]:
    """(min, max, currency, display string) from schema.org's baseSalary,
    which is one more level of nesting than any of the six ATS adapters
    need: MonetaryAmount -> QuantitativeValue -> min/maxValue."""
    base = posting.get("baseSalary")
    if not isinstance(base, dict):
        return None, None, None, None
    currency = base.get("currency")
    value = base.get("value")
    if not isinstance(value, dict):
        return None, None, currency, None

    salary_min, salary_max = value.get("minValue"), value.get("maxValue")
    if not isinstance(salary_min, (int, float)) and not isinstance(salary_max, (int, float)):
        return None, None, currency, None

    if salary_min and salary_max:
        display = f"{currency or ''} {int(salary_min):,} - {int(salary_max):,}".strip()
    elif salary_min or salary_max:
        display = f"{currency or ''} {int(salary_min or salary_max):,}+".strip()
    else:
        display = None
    return salary_min, salary_max, currency, display


def _normalise(posting: dict, company_name: str | None, domain: str, query_key: str) -> dict | None:
    title = (posting.get("title") or "").strip()
    apply_url = (posting.get("url") or "").strip()
    # No url means no verified apply link. Falling back to the careers page
    # itself would point every posting on it at the same generic URL, which
    # is a worse outcome than dropping the row — same principle
    # ats_boards.fetch_board already applies to a title-less or url-less row.
    if not title or not apply_url:
        return None

    location, is_remote = _location_from(posting)
    work_mode = "Remote" if is_remote else _infer_work_mode(location)

    salary_min, salary_max, salary_currency, salary_range = _salary_from(posting)

    identifier = posting.get("identifier")
    if isinstance(identifier, dict):
        identifier = identifier.get("value")
    external_id = f"jsonld:{domain}:{identifier}" if identifier else None

    hiring_org = posting.get("hiringOrganization")
    company = (hiring_org or {}).get("name") if isinstance(hiring_org, dict) else None

    return {
        "query_key": query_key,
        "external_id": external_id,
        "title": title,
        "company": (company or company_name or _NO_COMPANY).strip(),
        "location": location,
        "work_mode": work_mode,
        "salary_range": salary_range,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": salary_currency,
        "description": strip_html(posting.get("description"))[:MAX_DESCRIPTION_CHARS] or None,
        "skills": json.dumps([]),
        "apply_url": apply_url,
        "posted_at": _parse_iso(posting.get("datePosted")),
        "source": "jsonld",
    }


def fetch_jsonld_postings(
    careers_url: str,
    query_key: str = "jsonld",
    company_name: str | None = None,
    fetch: Callable[[str], tuple[int, str]] | None = None,
) -> list[dict]:
    """One company's careers page. Returns [] on any failure — robots.txt
    disallow, an unreachable page, a page with no JobPosting markup — the
    same swallow-everything contract as ats_boards.fetch_board, so a sweep
    over many jsonld companies is never ended by one bad page."""
    fetch = fetch or _default_fetch

    if not _robots_allow(careers_url, fetch):
        logger.info("jsonld %s: disallowed by robots.txt", careers_url)
        return []

    try:
        status, body = fetch(careers_url)
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same non-event
        logger.info("jsonld %s unreachable: %s", careers_url, exc)
        return []

    if status != 200:
        logger.info("jsonld %s returned %s", careers_url, status)
        return []

    domain = urlsplit(careers_url).netloc
    rows = []
    for posting in _extract_jobpostings(body):
        row = _normalise(posting, company_name, domain, query_key)
        if row:
            rows.append(row)

    logger.info("jsonld %s -> %d postings", careers_url, len(rows))
    return rows
