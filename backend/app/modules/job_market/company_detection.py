"""Detect which ATS (if any) a company's careers page uses.

Used by backend/scripts/detect_ats.py to fill in ats_type/ats_slug for rows
on data/companies_seed.csv that don't have one yet — kept as its own module,
not inline in the script, so the detection logic is unit-testable without a
network call, the same relationship board_discovery.py has to
scripts/discover_boards.py.

For a company with no known ats_type: look for a link on its careers page
pointing at one of the six ATS providers ats_boards.py reads, and — matching
boards_registry.py's own "probe before adding" discipline — confirm a match
by actually fetching that board before accepting it, rather than trusting a
regex match alone. No live ATS link? Fall back to checking the same page for
schema.org JobPosting JSON-LD. Neither? "manual_review" — a real, expected
steady state for a registry this size, not a failure.
"""

from __future__ import annotations

import re

from app.modules.job_market import ats_boards, jsonld_crawler

# Structural URL segments a naive capture group can pick up by accident (e.g.
# "j" from apply.workable.com/j/<shortcode>, a job link rather than the
# account slug) — never a real company slug, so a match on one of these is
# discarded rather than probed.
_INVALID_TOKENS = {"j", "api", "v1", "widget", "accounts", "companies", "postings", "offers"}

# Best-effort: matched against raw page HTML, not a clean apply_url field the
# way board_discovery.py matches a job-feed's own apply_url. A page that
# links to its board through a redirect, a JS-rendered embed with no static
# URL, or an unusual path shape will not match — that is the "manual_review"
# steady state this module's docstring describes, not a bug in the pattern.
_HTML_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("greenhouse", re.compile(r"https?://(?:job-boards(?:\.eu)?|boards)\.greenhouse\.io/([a-zA-Z0-9_-]+)", re.I)),
    ("lever", re.compile(r"https?://jobs\.lever\.co/([a-zA-Z0-9_-]+)", re.I)),
    ("ashby", re.compile(r"https?://jobs\.ashbyhq\.com/([a-zA-Z0-9_-]+)", re.I)),
    ("workable", re.compile(r"https?://apply\.workable\.com/([a-zA-Z0-9_-]+)", re.I)),
    (
        "smartrecruiters",
        re.compile(r"https?://(?:jobs|api)\.smartrecruiters\.com/(?:v1/companies/)?([a-zA-Z0-9_-]+)", re.I),
    ),
    ("recruitee", re.compile(r"https?://([a-zA-Z0-9_-]+)\.recruitee\.com", re.I)),
)


def find_ats_link(page_html: str) -> tuple[str, str] | None:
    """The first (provider, token) an ATS link pattern matches, in the fixed
    priority order above. One match is enough — this only needs a candidate
    worth probing, not every link on the page."""
    for provider, pattern in _HTML_PATTERNS:
        match = pattern.search(page_html)
        if match and match.group(1).lower() not in _INVALID_TOKENS:
            return provider, match.group(1)
    return None


def detect_one(row: dict, fetch=None, probe=None, jsonld_extract=None) -> tuple[dict, str]:
    """One company's row -> (updated row, a one-line status message).

    fetch/probe/jsonld_extract are injectable so this is testable with no
    network access — mirroring ats_boards.fetch_board's own `fetch` seam.
    """
    fetch = fetch or jsonld_crawler._default_fetch
    probe = probe or ats_boards.fetch_board
    jsonld_extract = jsonld_extract or jsonld_crawler._extract_jobpostings

    row = dict(row)
    careers_url = (row.get("careers_url") or "").strip()
    if not careers_url:
        row["ats_type"] = "manual_review"
        return row, "no careers_url on file"

    if not jsonld_crawler._robots_allow(careers_url, fetch):
        row["ats_type"] = "manual_review"
        return row, "robots.txt disallows this page"

    try:
        status, body = fetch(careers_url)
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same non-event
        row["ats_type"] = "manual_review"
        return row, f"unreachable: {exc}"

    if status != 200:
        row["ats_type"] = "manual_review"
        return row, f"careers_url returned {status}"

    found = find_ats_link(body)
    if found:
        provider, token = found
        live_rows = probe(provider, token)
        if live_rows:
            row["ats_type"] = provider
            row["ats_slug"] = token
            return row, f"{provider}/{token} — {len(live_rows)} roles"
        # A matched link that doesn't answer is exactly what
        # boards_registry.py's docstring warns a guess produces — probing is
        # what catches it rather than trusting the regex alone.

    if jsonld_extract(body):
        row["ats_type"] = "jsonld"
        return row, "jsonld — JobPosting markup found"

    row["ats_type"] = "manual_review"
    return row, "no live ATS link or JobPosting markup found"
