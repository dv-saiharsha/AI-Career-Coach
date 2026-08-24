"""Parse JSearch's free-text salary strings into annual USD figures.

The cached job_listings rows store whatever JSearch formatted, not structured
numbers, so anything built on top of them has to parse first. Observed shapes
in the live cache:

    '126K-196K a year'          en-dash, K suffix
    '164,939-181,185 a year'    comma-separated, full numbers
    '175K a year'               single value, no range
    '$60 - $80 an hour'         hourly, needs annualising

Anything that doesn't parse cleanly returns None and is dropped from the
sample rather than guessed at — a benchmark built from misread numbers is
worse than one that admits it has too little data.
"""

import re

# Separators seen in real postings: hyphen, en-dash, em-dash, and "to".
_RANGE_SPLIT = re.compile(r"\s*(?:[-‐-―]|\bto\b)\s*")

_AMOUNT = re.compile(
    r"""
    (?P<value>\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)
    \s*
    (?P<suffix>[kKmM])?
    """,
    re.VERBOSE,
)

# Full-time equivalents. 2080 = 40h x 52wk, the standard US convention.
_HOURS_PER_YEAR = 2080
_WEEKS_PER_YEAR = 52
_MONTHS_PER_YEAR = 12

# Sanity bounds. A parsed "salary" outside these is a misread — a stray year
# like 2024 falls under the floor and is dropped.
MIN_PLAUSIBLE_ANNUAL = 10_000
MAX_PLAUSIBLE_ANNUAL = 2_000_000

# "401k" reads as $401,000 to the amount parser and sits inside the plausible
# band, so bounds alone do not catch it — it has to be rejected by name.
_BENEFITS_NOISE = re.compile(r"\b401\s*\(?k\)?\b", re.I)


def _period_multiplier(text: str) -> float | None:
    lowered = text.lower()
    if "hour" in lowered or "hr" in lowered or "/h" in lowered:
        return _HOURS_PER_YEAR
    if "week" in lowered:
        return _WEEKS_PER_YEAR
    if "month" in lowered or "/mo" in lowered:
        return _MONTHS_PER_YEAR
    if "day" in lowered:
        return 260.0  # working days per year
    if "year" in lowered or "annum" in lowered or "yr" in lowered or "/y" in lowered:
        return 1.0
    # No period stated. Treated as annual, which is what bare figures mean in
    # these postings — the plausibility bounds below catch the exceptions.
    return 1.0


def _to_number(value: str, suffix: str | None) -> float | None:
    try:
        amount = float(value.replace(",", ""))
    except ValueError:
        return None
    if suffix and suffix.lower() == "k":
        amount *= 1_000
    elif suffix and suffix.lower() == "m":
        amount *= 1_000_000
    return amount


def parse_salary_range(raw: str | None) -> tuple[float, float] | None:
    """Annualised (low, high) in USD, or None when nothing parses.

    A single figure yields (value, value) so callers get one consistent shape.
    """
    if not raw or not raw.strip():
        return None

    text = raw.strip()
    if _BENEFITS_NOISE.search(text):
        return None
    multiplier = _period_multiplier(text)
    if multiplier is None:
        return None

    # Strip the trailing period phrase so "a year" can't contribute digits.
    cleaned = re.sub(r"\b(an?|per)\s+(hour|hr|week|month|mo|day|year|yr|annum)\b", " ", text, flags=re.I)
    cleaned = re.sub(r"[/](hour|hr|week|month|mo|day|year|yr)\b", " ", cleaned, flags=re.I)

    parts = _RANGE_SPLIT.split(cleaned, maxsplit=1)
    amounts: list[float] = []
    for part in parts[:2]:
        match = _AMOUNT.search(part)
        if not match:
            continue
        number = _to_number(match.group("value"), match.group("suffix"))
        if number is None:
            continue
        amounts.append(number * multiplier)

    if not amounts:
        return None

    low, high = min(amounts), max(amounts)
    if low < MIN_PLAUSIBLE_ANNUAL or high > MAX_PLAUSIBLE_ANNUAL:
        return None
    return low, high


def _percentile(sorted_values: list[float], fraction: float) -> float:
    """Linear-interpolated percentile.

    statistics.quantiles needs n >= 2 and cuts into fixed buckets; this works
    on any non-empty sample, which matters because real role queries routinely
    return three or four postings with pay attached.
    """
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = fraction * (len(sorted_values) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    weight = position - lower_index
    return sorted_values[lower_index] * (1 - weight) + sorted_values[upper_index] * weight


def summarise(raw_salaries: list[str | None]) -> dict | None:
    """Percentile bands over the midpoint of each posting's range.

    Midpoints rather than lows or highs: a posting advertising 120K-200K
    describes one job, and folding both ends in as separate observations would
    double-count it and widen the spread artificially.

    Returns None when nothing parsed — the caller must say "no data" rather
    than render an empty band as though it were a finding.
    """
    midpoints = sorted(
        (low + high) / 2
        for low, high in filter(None, (parse_salary_range(raw) for raw in raw_salaries))
    )
    if not midpoints:
        return None

    return {
        "sample_size": len(midpoints),
        "p25": round(_percentile(midpoints, 0.25)),
        "median": round(_percentile(midpoints, 0.50)),
        "p75": round(_percentile(midpoints, 0.75)),
        "low": round(midpoints[0]),
        "high": round(midpoints[-1]),
    }
