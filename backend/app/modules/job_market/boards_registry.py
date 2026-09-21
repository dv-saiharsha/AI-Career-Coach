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

    # Third probe: via board_discovery.py, which reads real apply-link
    # tokens out of a public jobs directory instead of guessing company
    # names — every one of 210 candidates it surfaced was live, a much
    # higher hit rate than the first two probes' hand-picked guesses. This
    # batch is Greenhouse's share.
    "andurilindustries",# 2373 — Anduril Industries
    "verkada",          # 297 — Verkada
    "xai",              # 266 — xAI
    "alphasense",       # 220 — AlphaSense
    "adyen",            # 217 — Adyen
    "chaosindustries",  # 129 — Chaos Industries
    "tenstorrent",      # 125 — Tenstorrent
    "gleanwork",        # 122 — Glean
    "muonspace",        # 121 — Muon Space
    "intercom",         # 110 — Intercom
    "figureai",         # 104 — Figure
    "cresta",           # 96 — Cresta
    "vardaspace",       # 95 — Varda Space Industries
    "peregrinetechnologies",# 93 — Peregrine
    "apptronik",        # 82 — Apptronik
    "chainguard",       # 80 — Chainguard
    "togetherai",       # 78 — Together AI
    "instawork",        # 57 — Instawork
    "parloa",           # 49 — Parloa
    "maymobility",      # 45 — May Mobility
    "latitude",         # 43 — Latitude AI
    "snorkelai",        # 39 — Snorkel AI
    "pathrobotics",     # 38 — Path Robotics
    "eve",              # 31 — Eve
    "prolific",         # 31 — Prolific
    "hackerrank",       # 29 — HackerRank
    "vannevarlabs",     # 28 — Vannevar Labs
    "torq",             # 28 — Torq
    "xairatherapeutics",# 23 — Xaira Therapeutics
    "shifttechnology",  # 21 — Shift Technology
    "turing",           # 21 — Turing Labs Inc.
    "obsidiansecurity", # 21 — Obsidian Security
    "pronto",           # 20 — Pronto
    "eudia",            # 18 — Eudia
    "assemblyai",       # 18 — AssemblyAI
    "riverai",          # 17 — River
    "parallel",         # 17 — Parallel
    "thealleninstitute",# 17 — Allen Institute for AI (Ai2)
    "galileo",          # 14 — Galileo
    "smarterdx",        # 12 — SmarterDx
    "dropzoneai",       # 11 — Dropzone AI
    "federato",         # 9 — Federato
    "sensei",           # 7 — Sensei
    "youcom",           # 7 — You.com
    "sourcegraph91",    # 7 — Sourcegraph
    "weave",            # 7 — Weave Bio
    "diligent",         # 6 — Diligent
    "covar",            # 6 — CoVar
    "stackblitz",       # 6 — StackBlitz
    "beam",             # 5 — Beam
    "raven",            # 3 — Raven
    "sixfold",          # 3 — Sixfold
    "ojin",             # 3 — Ojin
    "haven",            # 3 — Haven
    "newton",           # 2 — Newton
    "quotient",         # 2 — Quotient Labs
    "polyai",           # 2 — PolyAI
)

LEVER_BOARDS: tuple[str, ...] = (
    "gopuff",       # 765
    "palantir",     # 310
    "binance",      # 280
    "spotify",      # 73
    "zoox",         # 241
    "sila",         # 210
    "arcadia",      # 18

    # Via board_discovery.py — see the matching comment in GREENHOUSE_BOARDS.
    "shieldai",     # 498 — Shield AI
    "waabi",        # 85 — Waabi
    "articulate",   # 1 — Articulate
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
#
# Empty until board_discovery.py's directory-driven probe (see the matching
# comment in GREENHOUSE_BOARDS) — the earlier hand-picked-candidate approach
# never found a single live Ashby board; reading real apply-link tokens
# instead of guessing company names found 150 in one pass.
ASHBY_BOARDS: tuple[tuple[str, str], ...] = (
    ("openai", "OpenAI"),  # 815
    ("crusoe", "Crusoe"),  # 358
    ("snowflake", "Snowflake"),  # 346
    ("harvey", "Harvey"),  # 298
    ("legora", "Legora"),  # 272
    ("saronic", "Saronic"),  # 211
    ("sierra", "Sierra"),  # 210
    ("mistral.ai", "Mistral AI"),  # 198
    ("decagon", "Decagon"),  # 146
    ("cohere", "Cohere"),  # 142
    ("skydio", "Skydio"),  # 138
    ("cursor", "Cursor"),  # 122
    ("perplexity", "Perplexity"),  # 118
    ("cerebras", "Cerebras"),  # 113
    ("mercor", "Mercor"),  # 109
    ("etched", "Etched"),  # 106
    ("langchain", "LangChain"),  # 106
    ("baseten", "Baseten"),  # 100
    ("cognition", "Cognition"),  # 98
    ("deepgram", "Deepgram"),  # 92
    ("lambda", "Lambda"),  # 89
    ("heidihealth.com.au", "Heidi Health"),  # 89
    ("1x", "1X Technologies"),  # 88
    ("rogo", "Rogo"),  # 83
    ("fireworks", "Fireworks AI"),  # 79
    ("lovable", "Lovable"),  # 78
    ("higgsfieldai", "Higgsfield"),  # 76
    ("ashby", "Ashby"),  # 73
    ("suno", "Suno"),  # 69
    ("sarvam", "Sarvam AI"),  # 61
    ("claylabs", "Clay"),  # 60
    ("reflectionai", "Reflection AI"),  # 57
    ("voize", "voize"),  # 55
    ("nooks", "Nooks"),  # 52
    ("exa", "Exa"),  # 52
    ("writer", "Writer"),  # 51
    ("factory", "Factory AI"),  # 50
    ("mapbox", "Mapbox"),  # 49
    ("basis-ai", "Basis"),  # 47
    ("coderabbit", "CodeRabbit"),  # 47
    ("thinkingmachines", "Thinking Machines"),  # 45
    ("ema", "Ema"),  # 45
    ("permitflow", "PermitFlow"),  # 45
    ("tenex", "Tenex.AI"),  # 45
    ("campfire", "Campfire"),  # 44
    ("abridge", "Abridge"),  # 43
    ("taktile", "Taktile"),  # 43
    ("lumaai", "Luma AI"),  # 41
    ("deepl", "DeepL"),  # 40
    ("runway-ml", "Runway"),  # 40
    ("stepful", "Stepful"),  # 38
    ("afterquery", "AfterQuery"),  # 38
    ("code-metal", "Code Metal"),  # 38
    ("broccoli", "Broccoli AI"),  # 38
    ("retell-ai", "Retell AI"),  # 36
    ("physicalintelligence", "Physical Intelligence"),  # 35
    ("standardbots", "Standard Bots"),  # 34
    ("modal", "Modal"),  # 34
    ("n8n", "n8n"),  # 34
    ("metaview", "Metaview"),  # 33
    ("livekit", "LiveKit"),  # 33
    ("skydropx", "SkydropX"),  # 32
    ("vapi", "Vapi"),  # 31
    ("fal-ai", "Fal"),  # 31
    ("wispr-flow", "Wispr Flow"),  # 31
    ("cartesia", "Cartesia"),  # 30
    ("rilla", "Rilla"),  # 30
    ("litmus", "Litmus"),  # 28
    ("hyperexponential", "Hyperexponential"),  # 27
    ("openrouter", "OpenRouter"),  # 26
    ("socket", "Socket"),  # 25
    ("distyl", "Distyl AI"),  # 24
    ("tennr", "Tennr"),  # 24
    ("sesame", "Sesame"),  # 23
    ("gecko-robotics", "Gecko Robotics"),  # 22
    ("numeric", "Numeric"),  # 22
    ("spellbook.com", "Spellbook"),  # 21
    ("paraform", "Paraform"),  # 21
    ("anyscale", "Anyscale"),  # 21
    ("aptura", "Aptura AI"),  # 21
    ("oscilar", "Oscilar"),  # 20
    ("norm-ai", "Norm Ai"),  # 19
    ("nabla", "Nabla"),  # 19
    ("midjourney", "Midjourney"),  # 18
    ("conveo", "Conveo"),  # 18
    ("crosby", "Crosby"),  # 18
    ("solveintelligence", "Solve Intelligence"),  # 17
    ("hud", "HUD"),  # 17
    ("wisdom-ai", "Wisdom AI"),  # 17
    ("granola", "Granola"),  # 17
    ("pylon", "Pylon"),  # 17
    ("read-ai", "Read AI"),  # 17
    ("metriport", "Metriport"),  # 17
    ("sygaldry-technologies", "Sygaldry Technologies"),  # 16
    ("maven-agi", "Maven AGI"),  # 16
    ("simile", "Simile"),  # 16
    ("ambiencehealthcare", "Ambience Healthcare"),  # 15
    ("graymatter-robotics", "GrayMatter Robotics"),  # 15
    ("beaconai", "Beacon AI"),  # 14
    ("fyxer", "Fyxer AI"),  # 13
    ("aiuc", "AIUC"),  # 13
    ("workweave", "Weave (workweave)"),  # 12
    ("pika", "Pika"),  # 12
    ("auctor", "Auctor"),  # 12
    ("openevidence", "OpenEvidence"),  # 11
    ("lancedb", "LanceDB"),  # 11
    ("maincode", "Maincode"),  # 10
    ("unify", "Unify"),  # 10
    ("worldlabs", "World Labs"),  # 9
    ("claim-health", "Claim Health"),  # 9
    ("abundant", "Abundant"),  # 9
    ("casca", "Casca"),  # 8
    ("kira", "Kira Learning"),  # 8
    ("mintmcp", "MintMCP"),  # 7
    ("finto", "Finto"),  # 7
    ("browserbase", "Browserbase"),  # 7
    ("turbopuffer", "Turbopuffer"),  # 7
    ("hyperbound", "Hyperbound"),  # 7
    ("cradlebio", "Cradle"),  # 7
    ("finny", "FINNY AI"),  # 7
    ("kodex", "Kodex"),  # 6
    ("honeydew", "Honeydew"),  # 6
    ("dataleap", "Dataleap"),  # 6
    ("typesafe-ai", "TypeSafe AI"),  # 6
    ("artosai", "Artos"),  # 6
    ("probablygenetic", "Probably Genetic"),  # 6
    ("slingshotai", "Slingshot"),  # 6
    ("knowtex", "Knowtex"),  # 5
    ("august-health", "August Health"),  # 5
    ("checkly", "Checkly"),  # 5
    ("triggerdev", "Trigger.dev"),  # 5
    ("apolink", "Apolink"),  # 4
    ("lightsage", "Lightsage"),  # 4
    ("cranston", "Cranston AI"),  # 4
    ("pathos", "Pathos AI"),  # 4
    ("escape", "Escape"),  # 4
    ("kernel", "Kernel"),  # 4
    ("bild-ai", "Bild AI"),  # 4
    ("compa", "Compa.AI"),  # 4
    ("eventual", "Eventual"),  # 4
    ("eagle", "Eagle"),  # 3
    ("weaviate", "Weaviate"),  # 3
    ("fragmentai", "Fragment"),  # 3
    ("choco", "Choco"),  # 3
    ("conductor", "Conductor"),  # 3
    ("infera", "Infera"),  # 3
    ("upcodes", "UpCodes"),  # 3
    ("popl", "Popl"),  # 3
    ("conduit", "Conduit"),  # 2
    ("lark", "Lark"),  # 1
)


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
