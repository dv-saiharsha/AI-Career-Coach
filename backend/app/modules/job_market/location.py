"""Country priority for a job listing's free-text location string.

WHY THIS EXISTS

JobListing has no structured country column — location is whatever text the
source gave us ("New York, NY", "Singapore", "San Francisco, CA | New York
City, NY", "Remote - USA"), and the sources are a mix of a US-only API
(jsearch, hardcoded country=us) and company ATS boards that publish every
office worldwide on the same feed. Nothing upstream tags which is which, so
without this, a US-based user's default feed is exactly as likely to open on
a Singapore or Bengaluru posting as a Seattle one.

WHAT THIS DOES AND DOES NOT PROMISE

This is a heuristic over free text, calibrated against the ~13,800 real rows
in this database (see the location distribution any of the ~2,400 distinct
values takes), not an exhaustive gazetteer. Three tiers, not two: a location
can positively say United States (tier 0), positively name a specific other
country or foreign city (tier 2), or say nothing usable either way — "Hybrid",
"Remote", "Distributed", "N/A" (tier 1). Tier 1 is deliberately NOT folded
into tier 2 — a bare "Remote" is not evidence the job is foreign, and treating
it as such would bury real US remote roles alongside actually-foreign ones.

A multi-location string that names the US ANYWHERE ("San Francisco, CA, New
York, NY, Portland, OR, or Remote within Canada or United States") is tier 0
even though it also names Canada — the point is "does a US option exist",
not "is this exclusively US".
"""

import re

_US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC",
}

_US_MARKERS = re.compile(r"\b(united states|u\.s\.a\.?|usa|u\.s\.|us)\b", re.IGNORECASE)

_US_STATE_NAMES = re.compile(
    r"\b(california|washington|illinois|texas|virginia|massachusetts|"
    r"pennsylvania|nevada|arizona|georgia|colorado|oregon|florida|"
    r"new york|ohio|michigan|north carolina|new jersey|utah|minnesota|"
    r"wisconsin|maryland|missouri|indiana|tennessee|connecticut)\b",
    re.IGNORECASE,
)

# High-frequency bare US city/region names that appear with no state or
# country attached often enough in this dataset to be worth naming directly
# ("San Francisco" alone: 138 rows; "New York City" alone: 52).
_US_CITY_MARKERS = re.compile(
    r"\b(san francisco|new york city|nyc|\bsf\b|chicago|seattle|austin|boston|denver|"
    r"philadelphia|dallas|houston|atlanta|phoenix|palo alto|mountain view|"
    r"bellevue|northbrook|los angeles|mclean|bay area|silicon valley|"
    r"washington,?\s*d\.?c\.?|san jose|san diego|miami|portland|pittsburgh|"
    r"cupertino|redmond|sunnyvale|menlo park|foster city|long beach)\b",
    re.IGNORECASE,
)

# Countries and foreign cities frequent enough in this dataset to name
# directly, plus a handful of region codes ("APAC", "EMEA") that are
# unambiguously not the US even without naming a specific country.
_NON_US_MARKERS = re.compile(
    r"\b(india|singapore|ireland|united kingdom|\buk\b|canada|germany|france|"
    r"australia|philippines|poland|spain|italy|netherlands|brazil|mexico|"
    r"japan|china|vietnam|pakistan|ukraine|romania|portugal|sweden|"
    r"switzerland|israel|argentina|colombia|nigeria|kenya|egypt|"
    r"south africa|new zealand|\bnz\b|indonesia|malaysia|thailand|"
    r"bangladesh|sri lanka|nepal|hong kong|taiwan|korea|greece|norway|"
    r"denmark|serbia|qatar|saudi arabia|cambodia|estonia|iceland|"
    r"costa rica|chile|peru|ecuador|uruguay|england|wales|scotland|"
    r"great britain|uae|united arab emirates|\bksa\b|abu dhabi|luxembourg|"
    r"slovenia|lithuania|belgium|hungary|finland|turkey|t.rkiye|kazakhstan|"
    r"jakarta|istanbul|rio de janeiro|ho chi minh|"
    r"cork|dublin|london|toronto|vancouver|montreal|bangalore|bengaluru|hyderabad|"
    r"mumbai|delhi|gurugram|gurgaon|noida|pune|chennai|kolkata|manila|warsaw|berlin|munich|"
    r"paris|amsterdam|madrid|barcelona|milan|rome|dubai|tel aviv|sydney|"
    r"melbourne|auckland|wellington|tokyo|osaka|beijing|shanghai|shenzhen|"
    r"zurich|geneva|stockholm|copenhagen|oslo|helsinki|prague|budapest|vienna|"
    r"lisbon|athens|brussels|edinburgh|manchester|glasgow|riyadh|jeddah|"
    r"doha|phnom penh|reykjav|sao paulo|bogota|buenos aires|"
    r"\basia\b|\beurope\b|\bemea\b|\bapac\b|\blatam\b)\b",
    re.IGNORECASE,
)

# A bare two-letter code standing alone in the text — "Remote - CA",
# "Denver, CO", "CA Remote (BC & ON only)" — as opposed to inside a longer
# word, which the lookaround boundaries below rule out.
_BARE_CODE = re.compile(r"(?<![A-Za-z])([A-Za-z]{2})(?![A-Za-z])")


def location_priority(location: str | None) -> int:
    """0 = names the US, 1 = no usable country signal, 2 = names elsewhere.

    Lower sorts first — see get_jobs' ordering, which puts tier 0 ahead of
    tier 1 ahead of tier 2, each still recency-ordered within itself.
    """
    text = (location or "").strip()
    if not text:
        return 1
    if _US_MARKERS.search(text) or _US_STATE_NAMES.search(text) or _US_CITY_MARKERS.search(text):
        return 0
    if any(code.upper() in _US_STATE_CODES for code in _BARE_CODE.findall(text)):
        return 0
    if _NON_US_MARKERS.search(text):
        return 2
    return 1
