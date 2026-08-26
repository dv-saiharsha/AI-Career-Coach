"""Immigration policy news, crawled from the Federal Register.

Every item returned by this module is a real document with a real publication
date, a real issuing agency, and a link to the source. Nothing is authored
here.

That constraint is the whole design. A hardcoded list of policy "headlines"
stamped with the current time would be worse than showing nothing: readers
make visa, travel, and job-acceptance decisions on this, the claims are
checkable, and attributing invented text to DHS or USCIS misrepresents an
agency. If the feed is unreachable, this returns an empty list and the UI says
so — it does not fall back to canned content.

Source: federalregister.gov/developers/api/v1 — public, no key, no quota.
It is the government's own record of proposed and final rules, so a rule that
exists appears here and one that doesn't, doesn't.

Deliberately not an LLM summary: the abstract shipped with each document is
written by the issuing agency, and paraphrasing regulatory text through a
model would introduce exactly the drift this module exists to avoid.
"""

import logging
import time
from datetime import date, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

API_URL = "https://www.federalregister.gov/api/v1/documents.json"

# Refreshed hourly. The Federal Register publishes once a day on business
# days, so this is already far more often than the source changes — it exists
# so a long-running process picks up the day's edition without a restart.
CACHE_SECONDS = 3600

REQUEST_TIMEOUT_SECS = 12

# Search terms, not a curated article list. Broad enough to catch F-1, OPT,
# H-1B and student-visa rules; narrow enough that unrelated DHS notices don't
# crowd the feed.
SEARCH_TERMS = (
    "H-1B nonimmigrant",
    "F-1 nonimmigrant student",
    "optional practical training",
)

# How far back to look. Long enough that a quiet fortnight doesn't empty the
# panel, short enough that nothing stale reads as current.
LOOKBACK_DAYS = 180

MAX_ARTICLES = 6

# A term search matches anywhere in the document, so an IRS rule that mentions
# "nonimmigrant" in passing scores as highly as a DHS visa rule. Requiring one
# of these in the title or abstract is what keeps the panel about immigration
# rather than about everything that cites it.
_RELEVANCE = (
    "h-1b", "h1b", "f-1", "f1 ", "nonimmigrant", "optional practical training",
    "opt ", "student visa", "sevis", "visa", "immigrant", "naturalization",
    "duration of status", "employment authorization",
)


def _is_relevant(document: dict) -> bool:
    haystack = f"{document.get('title') or ''} {document.get('abstract') or ''}".lower()
    return any(term in haystack for term in _RELEVANCE)

_CACHE: dict[str, Any] = {"fetched_at": 0.0, "articles": [], "reachable": True}


def _classify(document: dict) -> str:
    """A label from the document's own type and title — never a judgement.

    "High Impact" and similar editorialising is deliberately absent: rating
    the consequence of a rule for an individual reader is advice this module
    is in no position to give.
    """
    doc_type = (document.get("type") or "").strip()
    return doc_type or "Document"


def _to_article(document: dict) -> dict[str, Any]:
    agencies = [a.get("name", "") for a in (document.get("agencies") or []) if a.get("name")]
    return {
        "id": document.get("document_number") or document.get("html_url", ""),
        "title": (document.get("title") or "").strip(),
        # The agency's own abstract, verbatim and truncated — not rewritten.
        "summary": (document.get("abstract") or "").strip() or None,
        "type": _classify(document),
        "agency": ", ".join(agencies) or "Federal Register",
        # The real publication date. Never "now".
        "published_at": document.get("publication_date"),
        "url": document.get("html_url"),
    }


def _fetch_term(client: httpx.Client, term: str, since: str) -> list[dict]:
    response = client.get(
        API_URL,
        params={
            "per_page": 10,
            "order": "newest",
            "conditions[term]": term,
            "conditions[publication_date][gte]": since,
            "fields[]": [
                "document_number",
                "title",
                "abstract",
                "publication_date",
                "html_url",
                "agencies",
                "type",
            ],
        },
    )
    response.raise_for_status()
    return response.json().get("results") or []


def fetch_immigration_news(force: bool = False) -> dict[str, Any]:
    """Recent Federal Register documents on F-1, OPT and H-1B.

    Returns `reachable: False` with an empty list when the API cannot be
    reached, so the UI can say the feed is unavailable rather than render a
    stale panel as though it were current.
    """
    now = time.monotonic()
    if not force and _CACHE["articles"] and (now - _CACHE["fetched_at"]) < CACHE_SECONDS:
        return {
            "articles": _CACHE["articles"],
            "fetched_at": _CACHE["fetched_at"],
            "reachable": _CACHE["reachable"],
            "cached": True,
        }

    since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    seen: set[str] = set()
    articles: list[dict] = []

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECS) as client:
            for term in SEARCH_TERMS:
                for document in _fetch_term(client, term, since):
                    if not _is_relevant(document):
                        continue
                    article = _to_article(document)
                    # One rule matches several search terms; dedup on the
                    # document number so it appears once.
                    if not article["id"] or article["id"] in seen:
                        continue
                    seen.add(article["id"])
                    articles.append(article)
    except Exception:
        logger.warning("news: Federal Register unreachable", exc_info=True)
        # Previously-fetched real articles are still real, so they are kept and
        # flagged rather than discarded. Only their freshness is in doubt.
        return {
            "articles": _CACHE["articles"],
            "fetched_at": _CACHE["fetched_at"],
            "reachable": False,
            "cached": bool(_CACHE["articles"]),
        }

    articles.sort(key=lambda a: a["published_at"] or "", reverse=True)
    articles = articles[:MAX_ARTICLES]

    _CACHE.update({"fetched_at": now, "articles": articles, "reachable": True})
    return {"articles": articles, "fetched_at": now, "reachable": True, "cached": False}


def clear_cache() -> None:
    _CACHE.update({"fetched_at": 0.0, "articles": [], "reachable": True})
