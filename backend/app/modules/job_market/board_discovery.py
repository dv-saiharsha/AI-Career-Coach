"""Finding employer ATS boards we are not yet sweeping.

WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT

It is not a job source. artificialintelligencejobs.co publishes a free,
keyless, agent-friendly index of ~19,000 AI roles, and their rows carry no
job description — only title, company, location, level and a link. Importing
those would give us thousands of postings that cannot be ATS-scored, tailored
against, or matched to a resume, which is the entire product.

What their feed does have is the employer's real apply_url, and that names
the ATS. So this reads their index for one fact per company — which board
this employer publishes on — and the roles themselves then come from that
employer's own public board API, with full descriptions, exactly as the
boards already in the registry do.

That ordering matters beyond the descriptions:

  - The employer published that board to be read. Greenhouse, Lever and
    Ashby all expose it precisely so job seekers find the roles.
  - Someone did real work assembling that index. Reading it as a pointer and
    going to the source does not extract that work; mirroring it wholesale
    would.
  - Our feed does not then depend on their uptime.
  - The applicant gets the employer's own apply link, not one through an
    aggregator.

Their terms ask only that attribution is appreciated; ATTRIBUTION below is
carried into the report so it reaches whoever reads it.

NOTHING HERE WRITES TO THE REGISTRY

boards_registry.py says it outright: do not add a token because the company
is large or obviously technical, probe it. So this probes every candidate and
reports what is live, and a human puts the survivors in the file. A discovery
run that edited the registry itself would be the same unchecked guess the
registry warns against, only faster.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.request
from dataclasses import dataclass, field

from app.modules.job_market import ats_boards, boards_registry

logger = logging.getLogger(__name__)

DIRECTORY_URL = "https://artificialintelligencejobs.co/api/jobs"
ATTRIBUTION = "Company/ATS index via artificialintelligencejobs.co"

PAGE_SIZE = 200  # their documented maximum
DEFAULT_MAX_PAGES = 25  # 5,000 roles: enough to reach the long tail of companies
PAUSE_SECONDS = 0.3  # deliberate: this is somebody else's free service
TIMEOUT_SECONDS = 30

# The board token as it appears in an employer's apply link, per provider.
#
# IGNORECASE because the host half of a URL is case-insensitive by spec and
# the feed does not normalise it. Without it a row written
# "JOBS.ASHBYHQ.COM/..." is silently not a candidate — no error, just a board
# that never gets found. The token is lower-cased on the way out either way,
# and the probe step is what catches a token that lower-casing broke.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "greenhouse",
        re.compile(
            r"^https?://(?:job-boards(?:\.eu)?|boards)\.greenhouse\.io/([^/?#]+)",
            re.IGNORECASE,
        ),
    ),
    ("lever", re.compile(r"^https?://jobs\.lever\.co/([^/?#]+)", re.IGNORECASE)),
    ("ashby", re.compile(r"^https?://jobs\.ashbyhq\.com/([^/?#]+)", re.IGNORECASE)),
)


@dataclass
class Candidate:
    provider: str
    token: str
    company: str
    live: bool = False
    role_count: int = 0


@dataclass
class DiscoveryReport:
    sampled_roles: int = 0
    candidates: list[Candidate] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def live(self) -> list[Candidate]:
        return [c for c in self.candidates if c.live]

    @property
    def new_roles(self) -> int:
        return sum(c.role_count for c in self.live)


def _default_get(url: str) -> str:
    request = urllib.request.Request(
        url, headers={"User-Agent": "ApplyCenter/1.0 (+board discovery)"}
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.read().decode("utf-8", "replace")


def extract_token(apply_url: str | None) -> tuple[str, str] | None:
    """(provider, token) from an employer apply link, or None.

    Company-hosted and Workday links return None on purpose. They are real
    jobs, but there is no public board API behind them, so a token would have
    nothing to fetch from even if one could be parsed out.
    """
    if not apply_url:
        return None
    for provider, pattern in _PATTERNS:
        match = pattern.match(apply_url.strip())
        if match:
            return provider, match.group(1).lower()
    return None


def fetch_directory(max_pages: int = DEFAULT_MAX_PAGES, get=None) -> tuple[list[dict], list[str]]:
    """Page through the public index. Returns (rows, errors)."""
    get = get or _default_get
    rows: list[dict] = []
    errors: list[str] = []

    for page in range(max_pages):
        url = f"{DIRECTORY_URL}?limit={PAGE_SIZE}&offset={page * PAGE_SIZE}"
        try:
            payload = json.loads(get(url))
        except Exception as exc:  # noqa: BLE001 - one bad page must not lose the rest
            errors.append(f"page {page}: {type(exc).__name__}: {exc}")
            break

        batch = payload.get("jobs") or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(PAUSE_SECONDS)

    return rows, errors


def find_candidates(rows: list[dict]) -> list[Candidate]:
    """Board tokens in the feed that the registry does not already have.

    Deduplicated by (provider, token), keeping the first company name seen —
    one board yields many roles and we want one candidate, not hundreds.
    """
    known = set(boards_registry.all_boards())
    dead = set(boards_registry.KNOWN_DEAD)

    seen: dict[tuple[str, str], Candidate] = {}
    for row in rows:
        found = extract_token(row.get("apply_url"))
        if not found or found in known:
            continue
        # KNOWN_DEAD is per provider, and the pair is what gets compared.
        # OpenAI is dead on Greenhouse and very much alive on Ashby; matching
        # on the token alone would hide exactly the boards worth finding.
        if found in dead:
            continue
        seen.setdefault(
            found,
            Candidate(
                provider=found[0],
                token=found[1],
                company=(row.get("company") or found[1]).strip(),
            ),
        )
    return list(seen.values())


def probe(candidates: list[Candidate], fetch=None) -> list[Candidate]:
    """Ask each board for its roles. A candidate is live only if it answers.

    This is the step boards_registry.py insists on: a token is a guess until
    it returns jobs, and a dead one costs a request every sweep while
    silently shrinking the feed.
    """
    for candidate in candidates:
        rows = ats_boards.fetch_board(
            candidate.provider, candidate.token, query_key="discovery", fetch=fetch
        )
        candidate.role_count = len(rows)
        candidate.live = bool(rows)
        logger.info(
            "probe %s/%s -> %s (%d roles)",
            candidate.provider,
            candidate.token,
            "live" if candidate.live else "dead",
            candidate.role_count,
        )
    return candidates


def discover(max_pages: int = DEFAULT_MAX_PAGES, get=None, fetch=None) -> DiscoveryReport:
    rows, errors = fetch_directory(max_pages=max_pages, get=get)
    report = DiscoveryReport(sampled_roles=len(rows), errors=errors)
    report.candidates = probe(find_candidates(rows), fetch=fetch)
    return report


def render_registry_lines(report: DiscoveryReport) -> str:
    """The live candidates as lines to paste into boards_registry.py.

    Paste, not patch — a person reads the company names before any of this
    reaches the sweep.
    """
    out: list[str] = []
    for provider in ("greenhouse", "lever", "ashby"):
        found = sorted(
            (c for c in report.live if c.provider == provider),
            key=lambda c: -c.role_count,
        )
        if not found:
            continue
        out.append(f"# --- add to {provider.upper()}_BOARDS ---")
        for candidate in found:
            if provider == "ashby":
                # Ashby carries no company name of its own, so the entry does.
                out.append(
                    f'    ("{candidate.token}", "{candidate.company}"),'
                    f"  # {candidate.role_count}"
                )
            else:
                out.append(
                    f'    "{candidate.token}",'.ljust(24)
                    + f"# {candidate.role_count} — {candidate.company}"
                )
        out.append("")
    return "\n".join(out)
