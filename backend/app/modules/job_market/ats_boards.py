"""Jobs straight from employers' own ATS boards. Free, keyed to no account.

WHY THIS SOURCE EXISTS

This was written to run alongside a paid Apify LinkedIn scraper, billed per
run and bounded by two cost ceilings in ingestion.py — that scraper has
since been removed entirely (first in favour of a budgeted JSearch
aggregator, which has itself since been removed too, leaving this and the
other five ATS adapters plus the JSON-LD fallback as the only job source),
but the economics that motivated building this first are still the reason it
stayed the primary source rather than a supplement. Greenhouse
and Lever both publish the job board of every company that uses them as
public JSON, with no key, no account and no per-call charge. One request to
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
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable
from urllib.parse import quote, urlencode, urljoin, urlsplit
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
WORKABLE_URL = "https://apply.workable.com/api/v1/widget/accounts/{board}?details=true"
# limit=100 is a deliberate ceiling, not the API's own default: this module's
# whole cost model is one request per board (see the module docstring), and a
# board with more open reqs than that is truncated to its first page rather
# than paginated — the same "bounded useful slice, not the full firehose"
# tradeoff MAX_DESCRIPTION_CHARS already makes below.
SMARTRECRUITERS_URL = "https://api.smartrecruiters.com/v1/companies/{board}/postings?limit=100"
RECRUITEE_URL = "https://{board}.recruitee.com/api/offers/"
WORKDAY_PAGE_SIZE = 20
# 2,000 newest postings per board, which is also where Workday's reported
# total tops out. Store-heavy boards (CVS ~19k, Lowe's ~12.6k) would
# otherwise cost ~1,000 requests a crawl, every crawl.
WORKDAY_MAX_PAGES = 100
PUBLIC_ROLE_QUERIES = (
    "software engineer",
    "entry level software engineer",
    "new grad software engineer",
    "backend engineer",
    "frontend engineer",
    "full stack engineer",
    "site reliability engineer",
    "devops engineer",
    "cloud engineer",
    "cybersecurity engineer",
    "security analyst",
    "data engineer",
    "data analyst",
    "network engineer",
    "systems engineer",
)
PUBLIC_BOARD_PAGE_SIZE = 100
PUBLIC_BOARD_MAX_PAGES_PER_QUERY = 3
# Microsoft's API serves 10 postings a page; 300 pages is headroom over its
# ~1,250 U.S. jobs, and a bound if "count" ever stops being reported.
MICROSOFT_MAX_PAGES = 300

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


def strip_html(raw: str | None, limit: int | None = MAX_DESCRIPTION_CHARS) -> str:
    """Greenhouse returns HTML-escaped HTML. Both layers have to come off.

    The content field arrives double-encoded — `&lt;p&gt;` rather than `<p>` —
    so unescaping first turns it into real tags, and only then can they be
    removed. Doing it in the other order leaves the markup visible in the
    stored description, which is what the matcher would then read.

    `limit` caps the result (the stored-description size by default); pass None
    to keep everything, as the JD analyzer does for a long pasted posting.
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

    result = "\n".join(cleaned).strip()
    return result if limit is None else result[:limit]



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


def _workday_parts(board: str) -> tuple[str, str, str] | None:
    parsed = urlsplit(board if "://" in board else f"https://{board}")
    host = parsed.netloc.lower()
    site = parsed.path.strip("/").split("/", 1)[0]
    if not re.fullmatch(r"[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com", host) or not site:
        return None
    tenant = host.split(".wd", 1)[0]
    return host, tenant, site


def _workday_nodes(nodes):
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        yield node
        yield from _workday_nodes(node.get("values"))


def _is_workday_country_facet(facet_parameter: str | None) -> bool:
    # Tenants name this facet themselves: locationCountry, Location_Country,
    # Country_and_Jurisdiction, CF_..._Country_from_Job_Posting_Location...
    return bool(facet_parameter) and (
        facet_parameter == "locationHierarchy1" or "country" in facet_parameter.lower()
    )


def _workday_us_facet(facets: list[dict]) -> tuple[str, str] | None:
    for node in _workday_nodes(facets):
        facet_parameter = node.get("facetParameter")
        if not _is_workday_country_facet(facet_parameter):
            continue
        for value in node.get("values") or []:
            if (value.get("descriptor") or "").strip().lower() in {
                "united states", "united states of america", "usa", "us"
            }:
                facet_id = value.get("id")
                if facet_id:
                    return facet_parameter, facet_id
    return None


def _parse_workday_posted_on(value: str | None) -> datetime | None:
    lowered = (value or "").lower()
    now = datetime.now(timezone.utc)
    if "today" in lowered:
        return now
    if "yesterday" in lowered:
        return now - timedelta(days=1)
    match = re.search(r"(\d+)\+?\s+days?\s+ago", lowered)
    if match:
        return now - timedelta(days=int(match.group(1)))
    return None


def normalise_workday(
    postings: list[dict], board: str, query_key: str, display_name: str | None = None
) -> list[dict]:
    """Workday CXS search results -> the shared job-listing row shape."""
    parts = _workday_parts(board)
    if not parts:
        return []
    host, tenant, site = parts
    rows = []
    for posting in postings:
        title = (posting.get("title") or "").strip()
        external_path = (posting.get("externalPath") or "").strip()
        if not title or not external_path:
            continue
        if not external_path.startswith("/"):
            external_path = f"/{external_path}"
        # CXS returns "/job/<location>/<slug>", relative to the career site:
        # without the site segment the public URL is a Workday 404.
        if not external_path.startswith(f"/{site}/"):
            external_path = f"/{site}{external_path}"
        location = (posting.get("locationsText") or "").strip() or "United States"
        requisition = next(iter(posting.get("bulletFields") or []), None)
        stable_id = requisition or external_path.rsplit("/", 1)[-1]
        rows.append(
            {
                "query_key": query_key,
                "external_id": f"workday:{tenant}:{stable_id}",
                "title": title,
                "company": display_name or tenant,
                "location": location,
                "work_mode": _work_mode(location),
                "salary_range": None,
                "description": None,
                "skills": json.dumps([]),
                "apply_url": f"https://{host}{external_path}",
                "posted_at": _parse_workday_posted_on(posting.get("postedOn")),
                "source": "workday",
            }
        )
    return rows


def _default_workday_fetch(url: str, body: dict) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "User-Agent": "HireLoomBot/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def fetch_workday_board(
    board: str,
    query_key: str,
    fetch: Callable[..., tuple[int, str]] | None = None,
    display_name: str | None = None,
    max_pages: int | None = None,
) -> list[dict]:
    """Fetch one public Workday career board's U.S. postings, newest first.

    Filtered server-side by the board's country facet when it has one. A
    board without one is fetched unfiltered and its non-U.S. rows are dropped
    by the crawler's geo filter. Bounded by WORKDAY_MAX_PAGES either way:
    these are POSTs with no conditional-request support, so every crawl
    refetches every page.
    """
    parts = _workday_parts(board)
    if not parts:
        return []
    host, tenant, site = parts
    url = f"https://{host}/wday/cxs/{tenant}/{quote(site, safe='-_')}/jobs"
    request = fetch or _default_workday_fetch
    try:
        status, body = request(url, {"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""})
        if status != 200:
            return []
        initial = json.loads(body)
        us_facet = _workday_us_facet(initial.get("facets") or [])
        applied_facets = {us_facet[0]: [us_facet[1]]} if us_facet else {}
        if max_pages is None:
            max_pages = WORKDAY_MAX_PAGES
        total = 0
        offset = 0
        pages_fetched = 0
        seen_paths: set[str] = set()
        rows = []
        while True:
            status, body = request(
                url,
                {
                    "appliedFacets": applied_facets,
                    "limit": WORKDAY_PAGE_SIZE,
                    "offset": offset,
                    "searchText": "",
                },
            )
            if status != 200:
                logger.info("workday board %s returned %s at offset %d", board, status, offset)
                break
            page = json.loads(body)
            postings = page.get("jobPostings") or []
            total = max(total, int(page.get("total") or 0))
            if not postings:
                break

            new_postings = []
            for posting in postings:
                external_path = posting.get("externalPath")
                if external_path and external_path in seen_paths:
                    continue
                if external_path:
                    seen_paths.add(external_path)
                new_postings.append(posting)
            if not new_postings:
                break

            rows.extend(normalise_workday(new_postings, board, query_key, display_name))
            offset += len(postings)
            pages_fetched += 1
            if total and offset >= total:
                break
            if len(postings) < WORKDAY_PAGE_SIZE:
                break
            if pages_fetched >= max_pages:
                break
        return rows
    except Exception as exc:  # noqa: BLE001 - a failing board must not stop the crawl
        logger.info("workday board %s fetch failed: %s", board, exc)
        return []


def _default_workday_detail_fetch(url: str) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "HireLoomBot/1.0", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def fetch_workday_detail(
    board: str,
    apply_url: str,
    fetch: Callable[[str], tuple[int, str]] | None = None,
) -> tuple[str | None, str | None]:
    """Load one Workday description and accept only its same-host apply URL."""
    parts = _workday_parts(board)
    if not parts:
        return None, None
    host, tenant, site = parts
    try:
        posting_url = urlsplit(apply_url)
        if posting_url.hostname != host or posting_url.username or posting_url.password:
            return None, None
        slug = posting_url.path.rstrip("/").rsplit("/", 1)[-1]
        if not slug:
            return None, None
        detail_url = f"https://{host}/wday/cxs/{tenant}/{quote(site, safe='-_')}/job/{quote(slug, safe='-_.')}"
        status, body = (fetch or _default_workday_detail_fetch)(detail_url)
        if status != 200:
            return None, None
        info = json.loads(body).get("jobPostingInfo") or {}
        description = strip_html(info.get("jobDescription")) or None
        external_url = info.get("externalUrl")
        parsed_external_url = urlsplit(external_url or "")
        safe_apply_url = (
            external_url
            if parsed_external_url.scheme == "https"
            and parsed_external_url.hostname == host
            and not parsed_external_url.username
            and not parsed_external_url.password
            else None
        )
        return description, safe_apply_url
    except Exception as exc:  # noqa: BLE001 - details are best-effort on the click path
        logger.info("workday job detail fetch failed for %s: %s", board, exc)
        return None, None


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


def _parse_space_datetime(value: str | None) -> datetime | None:
    """Recruitee's own format: "2026-05-21 16:05:31 UTC" — not ISO 8601, so
    _parse_iso's fromisoformat parse would raise on the space and the literal
    "UTC" suffix."""
    if not value:
        return None
    try:
        return datetime.strptime(value.removesuffix(" UTC"), "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def normalise_workable(payload: dict, board: str, query_key: str) -> list[dict]:
    """Workable's public widget API -> the same row shape as the other five.

    shortcode, not `code` (present but empty in every board probed), is the
    stable per-posting id — it is also what the job's own URLs are built
    from, so it was never going to be optional for us to key on.
    """
    rows = []
    for job in payload.get("jobs") or []:
        shortcode = job.get("shortcode")
        title = (job.get("title") or "").strip()
        # "url" is the job page; "application_url" is the actual /apply
        # form — apply_url should land a candidate on the form, not a page
        # they then have to find a button on.
        apply_url = (job.get("application_url") or job.get("url") or "").strip()
        if not shortcode or not title or not apply_url:
            continue

        location = ", ".join(
            part for part in (job.get("city"), job.get("state"), job.get("country")) if part
        ) or "Not specified"
        # telecommuting is Workable's own explicit flag, preferred over
        # reading the location string for the same reason Lever's
        # workplaceType is: a stated fact beats an inferred one.
        work_mode = "Remote" if job.get("telecommuting") else _work_mode(location)

        salary = job.get("salary") or {}
        salary_min, salary_max = salary.get("salary_from"), salary.get("salary_to")
        salary_currency = (salary.get("salary_currency") or "").upper() or None
        salary_range = None
        if salary_min and salary_max:
            salary_range = f"{salary_currency or ''} {int(salary_min):,} - {int(salary_max):,}".strip()
        elif salary_min:
            salary_range = f"{salary_currency or ''} {int(salary_min):,}+".strip()

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"workable:{board}:{shortcode}",
                "title": title,
                "company": (payload.get("name") or board).strip(),
                "location": location,
                "work_mode": work_mode,
                "salary_range": salary_range,
                "salary_min": salary_min,
                "salary_max": salary_max,
                "salary_currency": salary_currency,
                "description": strip_html(job.get("description")) or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _parse_iso(job.get("published_on")),
                "department": job.get("department") or None,
                "source": "workable",
            }
        )
    return rows


def normalise_smartrecruiters(payload: dict, board: str, query_key: str) -> list[dict]:
    """SmartRecruiters' postings list -> the same row shape as the other five.

    List-endpoint only, deliberately: the full jobAd (description, the
    canonical postingUrl/applyUrl) only exists behind a per-posting detail
    call, and fetching one per posting would turn "one request per board"
    into one-plus-N for every SmartRecruiters employer, on a host every
    other SmartRecruiters company in the registry shares. apply_url is
    synthesized instead from SmartRecruiters' own routing, confirmed live to
    resolve without the SEO slug suffix
    (jobs.smartrecruiters.com/{company}/{id} == .../{id}-{slug}); description
    is left null, same as any board whose list view omits it.
    """
    rows = []
    for posting in payload.get("content") or []:
        posting_id = posting.get("id")
        title = (posting.get("name") or "").strip()
        if not posting_id or not title:
            continue

        company = posting.get("company") or {}
        identifier = company.get("identifier") or board
        location_info = posting.get("location") or {}
        location = (location_info.get("fullLocation") or "").strip() or "Not specified"
        if location_info.get("remote"):
            work_mode = "Remote"
        elif location_info.get("hybrid"):
            work_mode = "Hybrid"
        else:
            work_mode = _work_mode(location)

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"smartrecruiters:{board}:{posting_id}",
                "title": title,
                "company": (company.get("name") or board).strip(),
                "location": location,
                "work_mode": work_mode,
                "salary_range": None,
                "description": None,
                "skills": json.dumps([]),
                "apply_url": f"https://jobs.smartrecruiters.com/{identifier}/{posting_id}",
                "posted_at": _parse_iso(posting.get("releasedDate")),
                "department": (posting.get("department") or {}).get("label"),
                "source": "smartrecruiters",
            }
        )
    return rows


def normalise_recruitee(payload: dict, board: str, query_key: str) -> list[dict]:
    """Recruitee's offers API -> the same row shape as the other five.

    The one board of the six that states remote/hybrid/on-site as three
    explicit booleans rather than one flag plus a location-string guess.
    """
    rows = []
    for offer in payload.get("offers") or []:
        offer_id = offer.get("id")
        title = (offer.get("title") or "").strip()
        apply_url = (offer.get("careers_apply_url") or offer.get("careers_url") or "").strip()
        if offer_id is None or not title or not apply_url:
            continue

        location = (offer.get("location") or "").strip() or "Not specified"
        if offer.get("remote"):
            work_mode = "Remote"
        elif offer.get("hybrid"):
            work_mode = "Hybrid"
        else:
            work_mode = _work_mode(location)

        description = strip_html(offer.get("description"))
        requirements = strip_html(offer.get("requirements"))
        if requirements:
            description = f"{description}\n\n{requirements}".strip()

        salary = offer.get("salary") or {}
        salary_min, salary_max = salary.get("min"), salary.get("max")
        salary_currency = salary.get("currency")
        salary_range = None
        if salary_min and salary_max:
            salary_range = f"{salary_currency or ''} {int(salary_min):,} - {int(salary_max):,}".strip()
        elif salary_min:
            salary_range = f"{salary_currency or ''} {int(salary_min):,}+".strip()

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"recruitee:{board}:{offer_id}",
                "title": title,
                "company": (offer.get("company_name") or board).strip(),
                "location": location,
                "work_mode": work_mode,
                "salary_range": salary_range,
                "salary_min": salary_min,
                "salary_max": salary_max,
                "salary_currency": salary_currency,
                "description": description[:MAX_DESCRIPTION_CHARS] or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _parse_space_datetime(offer.get("published_at")),
                "department": offer.get("department") or None,
                "source": "recruitee",
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
    fetch: Callable[..., tuple[int, str]] | None = None,
    display_name: str | None = None,
) -> list[dict]:
    """One board from one provider. Returns [] on any failure.

    Swallows rather than raises so a sweep over dozens of boards is not ended
    by one company that has closed its board, renamed it, or is briefly down —
    a 404 here means "this company does not use this ATS", which is ordinary
    and not an error worth propagating.
    """
    if provider == "workday":
        return fetch_workday_board(board, query_key, fetch=fetch, display_name=display_name)
    if provider == "amazon_jobs":
        return fetch_amazon_board(query_key, fetch=fetch, display_name=display_name)
    if provider == "microsoft_jobs":
        return fetch_microsoft_board(query_key, fetch=fetch, display_name=display_name)

    fetch = fetch or _default_fetch
    urls = {
        "greenhouse": GREENHOUSE_URL,
        "lever": LEVER_URL,
        "ashby": ASHBY_URL,
        "workable": WORKABLE_URL,
        "smartrecruiters": SMARTRECRUITERS_URL,
        "recruitee": RECRUITEE_URL,
    }
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
    if provider == "workable":
        return normalise_workable(payload, board, query_key)
    if provider == "smartrecruiters":
        return normalise_smartrecruiters(payload, board, query_key)
    if provider == "recruitee":
        return normalise_recruitee(payload, board, query_key)
    return normalise_lever(payload, board, query_key)


def _parse_amazon_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(" ".join(value.split()), "%B %d, %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def normalise_amazon(
    jobs: list[dict], query_key: str, display_name: str | None = None
) -> list[dict]:
    """Amazon Jobs search results, retaining explicitly U.S.-based postings only."""
    rows = []
    for job in jobs:
        if (job.get("country_code") or "").upper() not in {"US", "USA"}:
            continue
        title = (job.get("title") or "").strip()
        job_id = job.get("id_icims") or job.get("id")
        job_path = (job.get("job_path") or "").strip()
        # The public posting page, not url_next_step: that is the sign-in
        # wall of the application flow, and the posting page links to it.
        apply_url = urljoin("https://www.amazon.jobs", job_path) if job_path else ""
        if not apply_url:
            apply_url = (job.get("url_next_step") or "").strip()
        if not title or not job_id or not apply_url:
            continue

        location = (job.get("location") or "").strip() or "United States"
        work_mode = _work_mode(location)
        for raw_location in job.get("locations") or []:
            try:
                location_data = json.loads(raw_location) if isinstance(raw_location, str) else raw_location
            except (TypeError, ValueError):
                continue
            location_type = (location_data.get("type") or "").upper()
            if location_type == "REMOTE":
                work_mode = "Remote"
                break
            if location_type == "HYBRID":
                work_mode = "Hybrid"

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"amazon:{job_id}",
                "title": title,
                # company_name is the hiring legal entity ("Amazon.com Services
                # LLC - A57"); one employer name keeps the feed and its
                # (source, company, external_id) identity stable.
                "company": display_name or "Amazon",
                "location": location,
                "work_mode": work_mode,
                "salary_range": None,
                "description": strip_html(job.get("description")) or None,
                "skills": json.dumps([]),
                "apply_url": apply_url,
                "posted_at": _parse_amazon_date(job.get("posted_date")),
                "source": "amazon_jobs",
            }
        )
    return rows


def fetch_amazon_board(
    query_key: str,
    fetch: Callable[..., tuple[int, str]] | None = None,
    display_name: str | None = None,
    max_pages: int = PUBLIC_BOARD_MAX_PAGES_PER_QUERY,
) -> list[dict]:
    """Search Amazon's official JSON feed for target technical role families."""
    request = fetch or _default_fetch
    seen_ids: set[str] = set()
    postings: list[dict] = []
    try:
        for term in PUBLIC_ROLE_QUERIES:
            offset = 0
            for _ in range(max_pages):
                url = "https://www.amazon.jobs/en/search.json?" + urlencode(
                    {
                        "base_query": term,
                        "loc_query": "United States",
                        "result_limit": PUBLIC_BOARD_PAGE_SIZE,
                        "offset": offset,
                    }
                )
                status, body = request(url)
                if status != 200:
                    break
                payload = json.loads(body)
                page = payload.get("jobs") or []
                if not page:
                    break
                for job in page:
                    job_id = str(job.get("id_icims") or job.get("id") or "")
                    if job_id and job_id not in seen_ids:
                        seen_ids.add(job_id)
                        postings.append(job)
                offset += len(page)
                if offset >= int(payload.get("hits") or 0) or len(page) < PUBLIC_BOARD_PAGE_SIZE:
                    break
        return normalise_amazon(postings, query_key, display_name)
    except Exception as exc:  # noqa: BLE001 - one public source must not stop the crawl
        logger.info("amazon jobs search failed: %s", exc)
        return normalise_amazon(postings, query_key, display_name)


def _microsoft_us_locations(position: dict) -> list[str]:
    locations = position.get("locations") or []
    return [location.strip() for location in locations if "united states" in location.lower()]


def normalise_microsoft(
    positions: list[dict], query_key: str, display_name: str | None = None
) -> list[dict]:
    """Microsoft's public careers search results, filtered to U.S. locations."""
    rows = []
    for position in positions:
        title = (position.get("name") or "").strip()
        position_id = position.get("displayJobId") or position.get("id")
        url = urljoin("https://apply.careers.microsoft.com", position.get("positionUrl") or "")
        locations = _microsoft_us_locations(position)
        if not title or not position_id or not locations:
            continue

        workplace = (position.get("workLocationOption") or "").lower()
        if "remote" in workplace:
            work_mode = "Remote"
        elif "hybrid" in workplace:
            work_mode = "Hybrid"
        else:
            work_mode = _work_mode("; ".join(locations))
        posted_ts = position.get("postedTs")
        try:
            posted_at = datetime.fromtimestamp(float(posted_ts), tz=timezone.utc) if posted_ts else None
        except (OverflowError, OSError, TypeError, ValueError):
            posted_at = None

        rows.append(
            {
                "query_key": query_key,
                "external_id": f"microsoft:{position_id}",
                "title": title,
                "company": display_name or "Microsoft",
                "location": "; ".join(locations),
                "work_mode": work_mode,
                "salary_range": None,
                "description": None,
                "skills": json.dumps([]),
                "apply_url": url,
                "posted_at": posted_at,
                "source": "microsoft_jobs",
            }
        )
    return rows


def fetch_microsoft_board(
    query_key: str,
    fetch: Callable[..., tuple[int, str]] | None = None,
    display_name: str | None = None,
    max_pages: int = MICROSOFT_MAX_PAGES,
) -> list[dict]:
    """Every U.S. posting from Microsoft's official careers API.

    The API pages 10 at a time, so role-keyword searches capped at a few pages
    each saw ~10% of the board; one unfiltered U.S. pass (~1,250 jobs, ~125
    requests) sees all of it for fewer requests.
    """
    request = fetch or _default_fetch
    seen_ids: set[str] = set()
    postings: list[dict] = []
    try:
        start = 0
        for _ in range(max_pages):
            url = "https://apply.careers.microsoft.com/api/pcsx/search?" + urlencode(
                {
                    "domain": "microsoft.com",
                    "query": "",
                    "location": "United States",
                    "start": start,
                    "sort_by": "timestamp",
                }
            )
            status, body = request(url)
            if status != 200:
                break
            payload = json.loads(body).get("data") or {}
            page = payload.get("positions") or []
            if not page:
                break
            for position in page:
                position_id = str(position.get("displayJobId") or position.get("id") or "")
                if position_id and position_id not in seen_ids:
                    seen_ids.add(position_id)
                    postings.append(position)
            start += len(page)
            if start >= int(payload.get("count") or 0):
                break
        return normalise_microsoft(postings, query_key, display_name)
    except Exception as exc:  # noqa: BLE001 - one public source must not stop the crawl
        logger.info("microsoft jobs search failed: %s", exc)
        return normalise_microsoft(postings, query_key, display_name)


def fetch_microsoft_detail(
    apply_url: str,
    expected_title: str,
    fetch: Callable[[str], tuple[int, str]] | None = None,
) -> str | None:
    """Read a Microsoft posting's JobPosting JSON-LD description from its official page."""
    parsed_url = urlsplit(apply_url)
    if parsed_url.scheme != "https" or parsed_url.hostname != "apply.careers.microsoft.com":
        return None
    try:
        status, body = (fetch or _default_fetch)(apply_url)
        if status != 200:
            return None
        from app.modules.job_market import jsonld_crawler

        expected = " ".join(expected_title.lower().split())
        for posting in jsonld_crawler._extract_jobpostings(body):
            title = " ".join((posting.get("title") or "").lower().split())
            if title == expected:
                return strip_html(posting.get("description")) or None
    except Exception as exc:  # noqa: BLE001 - details are loaded only when opened
        logger.info("microsoft job detail fetch failed: %s", exc)
    return None


def fetch_boards(
    boards: Iterable[tuple[str, str]],
    query_key: str = "ats-board",
    fetch: Callable[..., tuple[int, str]] | None = None,
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
