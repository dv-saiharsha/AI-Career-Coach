"""A blocklist for postings whose location names a country other than the US.

WHY A BLOCKLIST, NOT AN ALLOWLIST

Most rows carry no country at all — "Remote", "San Francisco, CA", "Not
specified" — and this app's boards (ats_boards.py) are overwhelmingly US
companies, so the absence of a US marker is not evidence a role is foreign.
What IS evidence is an explicit non-US signal: "São Paulo, Brazil",
"Remote (EMEA)", "London, UK". Those are excluded outright; everything else
is kept.

This mirrors ats_boards._work_mode's own rule: an unrecognised location stays
On-site rather than a guessed Remote, because a wrongly-hidden real posting
costs a candidate a job they would have applied to, while a wrongly-shown
foreign one costs them ten seconds reading a card they skip. The asymmetry
means bias toward keeping.

Deliberately conservative on what counts as a signal: no bare two-letter
code (ambiguous with US state abbreviations — "CA" is California, "IN" is
Indiana, "GA" is Georgia the state), and no country/city name that collides
with an unrelated common English word or a US place name.
"""

from __future__ import annotations

import re

# Substrings checked case-insensitively against the raw location string.
NON_US_MARKERS: tuple[str, ...] = (
    # Region tags employers use in place of a country.
    "emea", "apac", "latam", "anz",
    # Americas, outside the US.
    "brazil", "brasil", "canada", "mexico", "argentina", "chile", "colombia",
    "peru", "uruguay", "costa rica", "toronto", "vancouver", "montreal",
    "são paulo", "sao paulo", "buenos aires", "mexico city", "bogota", "bogotá",
    # Europe.
    "united kingdom", "england", "scotland", "wales", "ireland", "france",
    "germany", "deutschland", "spain", "españa", "portugal", "italy", "italia",
    "netherlands", "belgium", "switzerland", "austria", "sweden", "norway",
    "denmark", "finland", "poland", "romania", "ukraine", "russia", "greece",
    "hungary", "czech republic", "slovakia", "london", "dublin", "berlin",
    "paris", "amsterdam", "madrid", "lisbon", "warsaw",
    # Asia-Pacific.
    "india", "bangalore", "bengaluru", "mumbai", "hyderabad", "new delhi",
    "china", "hong kong", "taiwan", "japan", "tokyo", "south korea", "seoul",
    "singapore", "philippines", "manila", "indonesia", "jakarta", "vietnam",
    "thailand", "malaysia", "pakistan", "bangladesh", "sri lanka",
    "australia", "sydney", "melbourne", "new zealand", "auckland",
    # Middle East & Africa.
    "israel", "united arab emirates", "dubai", "saudi arabia", "egypt",
    "nigeria", "kenya", "south africa",
)

# "UK" needs a word boundary — a bare substring match would flag "Milwaukee".
# "United Kingdom" itself is already in NON_US_MARKERS above.
_UK_ABBREVIATION = re.compile(r"(?<![a-z])uk(?![a-z])", re.IGNORECASE)


def is_non_us_location(location: str | None) -> bool:
    """True only when `location` names a place outside the US.

    Blank or ambiguous input returns False — see the module docstring on why
    absence of a US signal is not treated as evidence of a non-US one.
    """
    if not location:
        return False
    lowered = location.lower()
    if any(marker in lowered for marker in NON_US_MARKERS):
        return True
    return bool(_UK_ABBREVIATION.search(lowered))
