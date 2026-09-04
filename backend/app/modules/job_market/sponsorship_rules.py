"""A free, rule-based read of visa sponsorship language, for when Claude
is not available to do the real job.

WHY THIS EXISTS

h1b_sponsorship is Claude-enriched, and enrichment is a paid Batch API call.
With the account out of credits, `_enrich` in ingestion.py returns {} for
every pending posting and `enriched_at` stays NULL — permanently, since that
column is what gates a re-attempt. 11,419 postings sit unclassified, and the
"Sponsors H-1B" filter shows zero matches. That reads as a broken filter; it
is an unpaid one.

This is not a replacement for Claude. It is a narrow, high-precision
stand-in for the minority of postings that say something completely
unambiguous, so the filter has real answers today instead of none. The
rubric it enforces is the SAME one the LLM prompt already states — classify
only on an explicit statement, everything else is `unmentioned` — because
that asymmetry is what makes a wrong classification rare here: a false
"explicitly_sponsored" sends a visa-needing candidate into a screening call
that wastes their time, and that failure mode is worse than a blank far more
often than it is better.

WHERE THIS DOES NOT TOUCH THE PAID PATH

Nothing here sets `enriched_at`. A row this module classifies is left
exactly as eligible for real Claude enrichment as it was before — the
column's only job is "was this billed for", and a free heuristic was not.
When credits return, the ordinary sweep re-evaluates these rows and Claude's
answer overwrites whatever this module wrote, silently and correctly.
"""

from __future__ import annotations

import re

# Checked in this order deliberately. "We are not able to sponsor" contains
# the word "sponsor" and would satisfy a loosely-written positive pattern if
# negative phrases were not tried first — so a negative match short-circuits
# before any positive pattern gets a chance to misread it.
_NEGATIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(?:do|does|will)\s+not\s+(?:sponsor|provide\s+sponsorship)", re.I),
    re.compile(r"\b(?:unable|not\s+able)\s+to\s+(?:sponsor|provide\s+(?:visa\s+)?sponsorship)", re.I),
    # (?:\w+\s+){0,2} is deliberate slack, not laziness: "No immigration
    # sponsorship is available" was misclassified as EXPLICITLY_SPONSORED
    # before this — the anchor required "no" to sit directly against
    # "sponsorship", and the qualifier word in between broke it. That
    # inverted the classification on the exact statement the whole rubric
    # exists to get right, and it was the FIRST real posting tested against.
    re.compile(
        r"\bno\s+(?:\w+\s+){0,2}sponsorship\s+(?:is\s+|will\s+be\s+)?"
        r"(?:available|offered|provided)\b",
        re.I,
    ),
    re.compile(r"\b(?:sponsorship|visa\s+sponsorship)\s+(?:is\s+)?not\s+(?:available|offered|provided)\b", re.I),
    re.compile(
        r"\bmust\s+(?:currently\s+)?be\s+(?:authorized|eligible)\s+to\s+work\b[^.]{0,80}\bwithout\s+"
        r"(?:the\s+need\s+for\s+)?(?:employer\s+)?(?:visa\s+)?sponsorship\b",
        re.I,
    ),
    # Left unconditional deliberately, unlike the positive "will/can/do/does
    # sponsor" pattern below — every occurrence found while testing this
    # against the real, unenriched corpus was genuinely about a visa, and the
    # failure mode of tightening it further is a NEW false negative (tested:
    # "unable to sponsor or take over sponsorship of an employment visa" has
    # its qualifying word seven tokens after the verb, past any window narrow
    # enough to still rule out an unrelated use of "sponsor"). The harm here
    # is also the gentler direction — a wrongly withheld "no_sponsorship"
    # only discourages an application; the positive pattern's false hit sends
    # someone into a screening call on a claim the posting never made, which
    # is the one this module exists to avoid.
    re.compile(r"\bwe\s+(?:are\s+)?(?:currently\s+)?(?:not\s+)?unable\s+to\s+sponsor\b", re.I),
    re.compile(r"\bcannot\s+(?:provide|offer)\s+(?:visa\s+)?sponsorship\b", re.I),
)

_VISA_OBJECT = r"visas?|h-?1b|immigration|employment[\s-]based|work\s+(?:visa|authorization)"

_POSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Requires a visa-ish word within three tokens of "sponsor". Without it,
    # this matched a REAL posting — "Elastic will sponsor the [security
    # clearance] process" — where the sponsorship on offer has nothing to do
    # with a visa, and the false positive would have told a visa-needing
    # candidate this employer sponsors work authorization when the posting
    # never says so. Caught by testing against the actual unenriched corpus,
    # not invented as a hypothetical. The bare verb genuinely needs the
    # object noun; "sponsorship" (the other patterns below) does not carry
    # the same ambiguity in the postings actually seen.
    # \s+ is mandatory right after "sponsor", not folded into the optional
    # filler group — (?:\s+\w+){0,3} matching zero times leaves NO whitespace
    # consumed between "sponsor" and the visa word that follows it, so the
    # very case this was written for ("do sponsor visas") could never match:
    # there is a real space in that text with nothing in the pattern able to
    # cross it. Caught the same way as the bug above — by running this
    # against the real corpus and watching the match count collapse from
    # hundreds to one, not by reading the regex and assuming it was right.
    re.compile(rf"\b(?:will|can|do|does)\s+sponsor\s+(?:\w+\s+){{0,3}}(?:{_VISA_OBJECT})\b", re.I),
    re.compile(r"\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b", re.I),
    re.compile(r"\bopen\s+to\s+sponsor(?:ing)?\b", re.I),
    re.compile(r"\bh-?1b\s+sponsorship\s+(?:is\s+)?available\b", re.I),
    re.compile(r"\bwe\s+(?:provide|offer)\s+(?:visa\s+)?sponsorship\b", re.I),
    re.compile(r"\bwill\s+support\s+(?:a\s+|an\s+)?(?:h-?1b\s+)?visa\b", re.I),
    re.compile(r"\b(?:visa\s+)?sponsorship\s+available\s+for\s+(?:qualified|the\s+right)\s+candidate", re.I),
)

# Split on sentence-ending punctuation followed by whitespace, keeping the
# match crude on purpose — job postings are full of bullet fragments that
# are not real sentences, and a stricter splitter would just as often miss
# the one that matters. This only needs to find SOME surrounding text to
# quote as evidence, not to parse the document.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def _evidence_for(text: str, pattern: re.Pattern[str]) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    for sentence in _SENTENCE_SPLIT.split(text):
        if pattern.search(sentence):
            return sentence.strip()[:280]
    return match.group(0)


def classify_sponsorship(description: str | None) -> tuple[str, str]:
    """(h1b_sponsorship, h1b_evidence) from the posting text alone.

    Returns ("unmentioned", "") for anything not caught by an explicit
    pattern — including every posting a smarter reader might reasonably
    classify from softer language. That is the deliberate trade: this
    module gives up recall entirely in exchange for never being wrong in
    the more expensive direction.
    """
    text = description or ""
    if not text.strip():
        return "unmentioned", ""

    for pattern in _NEGATIVE_PATTERNS:
        evidence = _evidence_for(text, pattern)
        if evidence:
            return "no_sponsorship", evidence

    for pattern in _POSITIVE_PATTERNS:
        evidence = _evidence_for(text, pattern)
        if evidence:
            return "explicitly_sponsored", evidence

    return "unmentioned", ""
