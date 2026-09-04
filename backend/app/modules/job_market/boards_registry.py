"""The curated list of employer ATS boards worth sweeping.

EVERY TOKEN HERE WAS PROBED BEFORE IT WAS ADDED

A board token is a guess until it returns 200. Of 78 plausible-looking
candidates — the obvious engineering orgs, AI labs and developer-tools
companies — only 33 actually resolve. The rest 404, because the company moved
ATS, uses a self-hosted board, renamed its token, or never used that provider
at all.

The failure mode of not checking is quiet: fetch_board swallows a 404 by
design, so a registry half full of dead tokens produces a sweep that looks
like it ran, logs nothing alarming, and returns a third of the roles it should.

Lever was the surprise. Most of the developer-tools companies people associate
with Lever are not on it: netflix, linear, zapier, docker, sentry, sourcegraph,
supabase, postman, airtable, rippling, instacart and lyft all 404. Four live
Lever boards is not an oversight, it is the finding.

Live totals when this list was built: 7,928 roles across 33 boards, against
~2,578 rows accumulated in the database from paid Apify runs.

RE-PROBE BEFORE ADDING
Do not add a token because the company is large or obviously technical. Probe
it. A dead token costs a wasted request per sweep and silently shrinks the
feed.
"""

from __future__ import annotations

# (provider, token). Ordered by live role count at the time of probing, so a
# partial sweep that runs out of time has still fetched the biggest boards.
#
# The counts in the comments are a snapshot, not a contract — they move daily
# and are recorded only to show the probe happened and roughly what each board
# contributes.
GREENHOUSE_BOARDS: tuple[str, ...] = (
    "databricks",   # 859
    "stripe",       # 611
    "anthropic",    # 588
    "mongodb",      # 406
    "elastic",      # 357
    "cloudflare",   # 328
    "brex",         # 272
    "samsara",      # 244
    "gitlab",       # 230
    "scaleai",      # 215
    "affirm",       # 203
    "pinterest",    # 194
    "coinbase",     # 187
    "flexport",     # 173
    "airbnb",       # 172
    "lyft",         # 170
    "figma",        # 157
    "reddit",       # 147
    "twilio",       # 144
    "robinhood",    # 133
    "instacart",    # 113
    "asana",        # 113
    "duolingo",     # 90
    "vercel",       # 88
    "gusto",        # 88
    "chime",        # 64
    "carta",        # 61
    "discord",      # 49
    "checkr",       # 44

    # Second probe: 153 further candidates, 34 live. Deliberately widened
    # past pure software, because the feed was almost entirely SaaS and the
    # roles people search for are not. Autonomous vehicles, space, energy and
    # health all publish Greenhouse boards and none were represented.
    "rocketlab",        # 454
    "waymo",            # 343
    "redwoodmaterials",  # 139
    "nuro",             # 108
    "justworks",        # 102
    "mixpanel",         # 84
    "astranis",         # 81
    "kodiak",           # 71
    "motional",         # 68
    "faire",            # 60
    "mercury",          # 58
    "zocdoc",           # 50
    "amplitude",        # 37
    "komodohealth",     # 34
    "stockx",           # 34
    "webflow",          # 29
    "freenome",         # 28
    "alloy",            # 22
    "airtable",         # 16
    "modernhealth",     # 12
    "honor",            # 12
    "labelbox",         # 10
    "lithic",           # 6
    "forward",          # 5
    "highnote",         # 4
)

LEVER_BOARDS: tuple[str, ...] = (
    "gopuff",       # 765
    "palantir",     # 310
    "binance",      # 280
    "spotify",      # 73
    "zoox",         # 241
    "sila",         # 210
    "arcadia",      # 18
)

# Probed and confirmed dead. Kept so the next person does not spend an
# afternoon rediscovering that OpenAI is not on a public Greenhouse board and
# that almost no developer-tools company is on Lever.
KNOWN_DEAD: tuple[tuple[str, str], ...] = (
    ("greenhouse", "openai"),
    ("greenhouse", "notion"),
    ("greenhouse", "plaid"),
    ("greenhouse", "hashicorp"),
    ("greenhouse", "canva"),
    ("greenhouse", "ramp"),
    ("greenhouse", "doordash"),
    ("greenhouse", "grammarly"),
    ("greenhouse", "snyk"),
    ("lever", "netflix"),
    ("lever", "linear"),
    ("lever", "zapier"),
    ("lever", "docker"),
    ("lever", "sentry"),
    ("lever", "sourcegraph"),
    ("lever", "supabase"),
    ("lever", "postman"),
    ("lever", "airtable"),
    ("lever", "rippling"),
    ("lever", "shopify"),
    ("lever", "anduril"),
)


# Ashby's board API returns no company name — not on the posting, not on the
# payload — so the display name lives here or users see "mistral.ai" as an
# employer. Greenhouse and Lever both carry their own name and need no entry.
ASHBY_BOARDS: tuple[tuple[str, str], ...] = ()


def display_name(provider: str, token: str) -> str | None:
    """The employer's real name, where the provider does not supply one."""
    if provider != "ashby":
        return None
    for board, name in ASHBY_BOARDS:
        if board == token:
            return name
    return None


def all_boards() -> list[tuple[str, str]]:
    """Every live board as (provider, token), biggest first."""
    return (
        [("greenhouse", token) for token in GREENHOUSE_BOARDS]
        + [("lever", token) for token in LEVER_BOARDS]
        + [("ashby", token) for token, _name in ASHBY_BOARDS]
    )


def board_count() -> int:
    return len(GREENHOUSE_BOARDS) + len(LEVER_BOARDS) + len(ASHBY_BOARDS)
