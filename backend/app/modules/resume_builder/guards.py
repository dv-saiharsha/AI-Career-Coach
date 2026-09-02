"""Deterministic verification of LLM-suggested bullet rewrites.

The rewrite prompt in services.py already tells the model never to introduce a
metric, technology or outcome the original does not imply. That instruction is
correct and it is not enforcement — nothing downstream has ever checked
whether the model complied, so a fabricated "99.9% uptime" reached the user
with exactly the same confidence as a faithful reframing.

This module is the check. It is deliberately not a second model and not a
second prompt: an LLM asked to audit an LLM shares the failure mode you are
auditing for. Everything here is regex and set arithmetic over the text, so
the same input gives the same verdict on every run, forever, at no cost.

THE BOUND

The candidate's own history is treated as a hard ceiling on what a suggestion
may assert. Two containments, checked separately because they fail for
different reasons and want different messages:

  metrics(suggested) ⊆ metrics(original)

    Numbers are the expensive lie. A reframing may drop a figure or move it,
    never add one — a number that appears in a rewrite and nowhere in the
    original was invented, including a plausible one. Scoped to the *bullet*,
    not the resume: "34%" appearing in some other role does not license it
    here.

  tools(suggested) ⊆ tools(original) ∪ tools(resume)

    Scoped wider on purpose. Naming Kubernetes in a bullet when the skills
    section already lists it is exactly the legitimate move — the candidate
    has the skill and a keyword search was missing it because it was never
    written where it counted. Naming a tool that appears nowhere in the
    document is fabrication.

WHAT A FAILURE DOES

The suggestion is dropped and the reason recorded. Not surfaced-with-a-warning:
a rewrite shown next to a caution still gets copied, and the person copying it
is the one who has to defend it in an interview. `review_suggestions` returns
the survivors and the rejections separately so a caller can log the rate
without ever putting a rejected line in front of a user.
"""

import re

from app.core.taxonomy import canonical, skill_candidates
from app.ml.features import ACTION_VERBS
from app.modules.resume_analyzer.quality import METRIC_PATTERNS

# Reuses the analyzer's definition rather than declaring a second one. Two
# regexes for "a figure that means something" drift apart, and then a bullet
# is graded as quantified by one module and unquantified by the other.
_METRIC_RE = re.compile("|".join(METRIC_PATTERNS), re.IGNORECASE)

# Bare integers and decimals, for the numeric-containment check. Broader than
# METRIC_PATTERNS on purpose: "reduced incidents from 12 to 3" carries two
# figures that METRIC_PATTERNS' "from X to Y" alternative matches as one span,
# and an invented "3" has to be catchable on its own.
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")

# Written-out numerals, so "three services" cannot smuggle in a count that
# "3 services" would have been caught adding. Stops at twelve; beyond that
# people write digits.
_WORD_NUMBERS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "ten": "10", "eleven": "11", "twelve": "12",
    "half": "0.5", "double": "2", "doubled": "2", "triple": "3", "tripled": "3",
}

# Multipliers that assert a magnitude. "500k" and "500,000" are the same claim
# and must normalise to the same token, or a rewrite could restate a figure in
# the other notation and read as an addition.
_SCALE = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}
_SCALED_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([kmb])\b", re.IGNORECASE)

# Digits that belong to a name rather than to a claim: p99, S3, EC2, H1, K8s,
# OAuth2, IPv6, HTTP2. Letter-prefixed, which is what separates them from
# figures — a real quantity is either bare ("34 services") or takes its unit
# as a suffix ("500k", "200ms"), never a letter in front.
#
# This distinction is not cosmetic. Without it "cut p99 latency 34%" reads as
# asserting a 99, so a rewrite that faithfully restates the candidate's own
# 34% gets rejected for inventing a number nobody wrote. Percentile notation
# is how the target roles talk about latency, so that false rejection would
# fire hardest on exactly the resumes this feature is meant to help.
_IDENTIFIER_RE = re.compile(r"\b[a-z]+\d+(?:\.\d+)?[a-z]*\b", re.IGNORECASE)

# The same notation, excluded from tool extraction. skill_candidates is
# permissive by design — it has to catch tools no curated list would have —
# and that permissiveness reads "p99" as a technology name.
_NOT_A_TOOL = re.compile(r"^p\d{1,3}(?:\.\d+)?$|^\d", re.IGNORECASE)

# Language names shorter than keyword_candidates' 3-character floor. Kept tiny
# and unambiguous — every entry here is a word with an ordinary English
# meaning, so they are matched case-sensitively and nothing lowercase joins
# this set.
_SHORT_TOOL_NAMES = ("Go", "C", "R")

# Generic architectural nouns. These read as technology names to a permissive
# extractor, but naming one is describing the work, not claiming a tool: a
# rewrite that turns "worked on backend stuff" into "rebuilt the backend API
# layer" has invented nothing, it has just written a sentence. Treating them
# as claims makes the guard fire on ordinary English and teaches whoever reads
# the log to ignore it.
#
# Anything specific enough to be a lie stays out of this set — Kafka, Spark and
# Snowflake are technologies a candidate either used or did not.
_GENERIC_NOUNS = frozenset(
    {
        "api", "apis", "backend", "frontend", "database", "databases", "server",
        "servers", "service", "services", "microservice", "microservices",
        "pipeline", "pipelines", "platform", "system", "systems", "framework",
        "frameworks", "infrastructure", "dashboard", "dashboards", "cloud",
        "data", "code", "codebase", "app", "application", "applications",
        "web", "mobile", "layer", "stack", "tooling", "tools",
    }
)

_BULLET_PREFIX = re.compile(r"^\s*[•\-\*–—▪·]\s*")


def _normalise_numbers(text: str) -> set[str]:
    """Every numeric claim in `text`, as comparable strings.

    Normalisation matters more than extraction here. 500k, 500,000 and 500 K
    are one claim; if they normalise differently the containment check reports
    a faithful restatement as an invention, and the guard becomes noise that
    somebody switches off.
    """
    # Identifiers go first and go entirely: p99, S3 and OAuth2 carry digits
    # that are part of a name, and reading them as quantities is what makes
    # this check reject faithful rewrites.
    lowered = _IDENTIFIER_RE.sub(" ", text.lower())

    values: set[str] = set()

    # Scaled figures first, and remove them, so 500k does not also register
    # as a bare 500.
    def _take_scaled(match: re.Match[str]) -> str:
        magnitude = float(match.group(1)) * _SCALE[match.group(2).lower()]
        values.add(_fmt(magnitude))
        return " "

    remaining = _SCALED_RE.sub(_take_scaled, lowered)

    # Thousands separators are notation, not information.
    remaining = re.sub(r"(?<=\d),(?=\d{3}\b)", "", remaining)

    for raw in _NUMBER_RE.findall(remaining):
        values.add(_fmt(float(raw)))

    for word, digits in _WORD_NUMBERS.items():
        if re.search(rf"\b{word}\b", remaining):
            values.add(_fmt(float(digits)))

    return values


def _fmt(value: float) -> str:
    """Canonical string for a number, so 3 and 3.0 compare equal."""
    return str(int(value)) if value == int(value) else str(value)


def extract_metrics(text: str) -> list[str]:
    """The recruiter-legible figures in a bullet, as written."""
    return [m.group(0).strip() for m in _METRIC_RE.finditer(text or "")]


def extract_tools(text: str) -> set[str]:
    """Canonical technology names mentioned in `text`.

    Goes through the shared taxonomy so "postgres", "PostgreSQL" and
    "Postgres 14" collapse to one term. A rewrite that renames a tool the
    candidate really uses is a reframing, not an addition, and canonicalising
    is what keeps the guard from calling it one.

    Only ever called on a single bullet. skill_candidates is built for job
    descriptions: it drops tokens of two characters or fewer and keeps only
    `most_common(25)`, so on a whole resume it silently truncates and the tail
    of the alphabet disappears. Licensing is done by `_is_licensed` against
    the raw text instead, which has no cap.
    """
    found = {
        canonical(term)
        for term in skill_candidates(text or "")
        if not _NOT_A_TOOL.match(term.strip()) and term.strip().lower() not in _GENERIC_NOUNS
    }
    found -= _GENERIC_NOUNS
    # Language names too short for keyword_candidates' 3-character floor. Go
    # is the one that matters in practice — it is all over backend postings,
    # and without this the guard can neither detect it being invented nor
    # recognise it being legitimately reused. Matched case-sensitively so the
    # ordinary verb "go" does not register as the language.
    for short in _SHORT_TOOL_NAMES:
        if re.search(rf"\b{re.escape(short)}\b", text or ""):
            found.add(canonical(short))
    return found


def _is_licensed(tool: str, original: str, resume_text: str) -> bool:
    """Whether `tool` is something the candidate already claims somewhere.

    Checked by looking for the term in the source text rather than by
    enumerating the source's tools, because the enumerator caps at 25 terms
    and a real resume carries more than that. Getting this backwards is what
    would make the guard reject honest rewrites that name a candidate's own
    stack — the exact failure that would get it switched off.
    """
    needle = re.escape(tool)
    for haystack in (original, resume_text):
        if not haystack:
            continue
        if re.search(rf"\b{needle}\b", haystack, re.IGNORECASE):
            return True
        # The canonical form may differ from how the candidate wrote it
        # ("PostgreSQL" on the resume, canonicalised to "postgres").
        if any(
            canonical(term) == tool
            for term in skill_candidates(haystack)
        ):
            return True
    return False


def _first_word(text: str) -> str:
    stripped = _BULLET_PREFIX.sub("", text or "").strip()
    return stripped.split(" ", 1)[0].lower().strip(".,:;") if stripped else ""


def structure(text: str) -> dict:
    """Which of [Action Verb] + [Quantified Metric] + [Technical Tool] are present.

    The same three components resume_analyzer.quality.evaluate_bullet grades,
    computed here so a suggestion can be compared against the bullet it
    replaces without importing the analyzer's display shape.
    """
    body = _BULLET_PREFIX.sub("", text or "").strip()
    has_verb = _first_word(body) in ACTION_VERBS
    has_metric = bool(_METRIC_RE.search(body))
    has_tool = bool(extract_tools(body))
    return {
        "action_verb": has_verb,
        "quantified_metric": has_metric,
        "technical_tool": has_tool,
        "components": sum([has_verb, has_metric, has_tool]),
    }


def verify_suggestion(original: str, suggested: str, resume_text: str = "") -> dict:
    """Check one rewrite against the candidate's own history.

    `resume_text` widens the tool bound to the whole document. Passing it
    empty makes the check stricter, not broken — the bullet is then the only
    licence for a tool name.

    Returns a verdict with every violation named, rather than a bare bool: the
    caller logs these, and "rejected" without "invented 99.9%" is a number
    nobody can act on.
    """
    violations: list[str] = []

    original_numbers = _normalise_numbers(original)
    suggested_numbers = _normalise_numbers(suggested)
    invented_numbers = sorted(suggested_numbers - original_numbers)
    if invented_numbers:
        violations.append(
            "introduces figures absent from the original bullet: "
            + ", ".join(invented_numbers)
        )

    invented_tools = sorted(
        tool
        for tool in extract_tools(suggested)
        if not _is_licensed(tool, original, resume_text)
    )
    if invented_tools:
        violations.append(
            "names technologies that appear nowhere in the resume: "
            + ", ".join(invented_tools)
        )

    return {
        "ok": not violations,
        "violations": violations,
        "invented_numbers": invented_numbers,
        "invented_tools": invented_tools,
        "structure_before": structure(original),
        "structure_after": structure(suggested),
    }


def review_suggestions(
    suggestions: list[dict],
    resume_text: str = "",
) -> tuple[list[dict], list[dict]]:
    """Split LLM rewrites into (accepted, rejected).

    Each suggestion is expected to carry `original` and `suggested`, which is
    what BULLET_SUGGESTIONS_SCHEMA requires. One missing either is rejected
    rather than passed through — an unverifiable suggestion is exactly the
    thing this exists to stop.
    """
    accepted: list[dict] = []
    rejected: list[dict] = []

    for suggestion in suggestions:
        original = (suggestion.get("original") or "").strip()
        rewritten = (suggestion.get("suggested") or "").strip()

        if not original or not rewritten:
            rejected.append(
                {**suggestion, "rejection": ["missing the original or the rewrite, so nothing could be checked"]}
            )
            continue

        verdict = verify_suggestion(original, rewritten, resume_text)
        if verdict["ok"]:
            accepted.append({**suggestion, "structure": verdict["structure_after"]})
        else:
            rejected.append({**suggestion, "rejection": verdict["violations"]})

    return accepted, rejected
