"""A deterministic, inspectable score breakdown.

The headline ats_score comes from a trained GradientBoostingRegressor and
stays that way — it is the authoritative number everywhere else in the
product. This module does something different: it computes named sub-scores
from measurable properties of the document, so a user can see *what* is weak
rather than only *that* something is.

The two numbers will not always agree, and that is not a bug to paper over.
The model learned from 2066 scored examples; the rubric applies fixed weights
to seven signals. Where they diverge, the rubric is the one that can be argued
with, which is precisely its value. Both are labelled by what produced them.

Weights are a considered allocation, not a citation. Calling them
"research-backed" in the UI would attribute them to literature this module
does not reference, so the UI says they are ours and documents them here:

  hard skills 30   The single strongest filter. A keyword search runs before
                   a human reads anything, and a missing required skill ends
                   the application regardless of everything below.
  title 15         Recruiters filter by title far more than by content.
  quantified 15    The difference between a claim and evidence.
  parseability 15  A document that does not parse scores zero on the rest of
                   this list no matter how good it is.
  sections 10      Parsers locate content by heading.
  recency 8        Weighted low deliberately: nobody can change their own
                   history, so scoring it heavily is scoring the unfixable.
  readability 7    Real but marginal next to the above.

A metric whose inputs are unavailable returns None and its weight is removed
from the denominator, rather than scoring zero. Scoring an unrunnable check
as failure would report a resume as worse than it is for a reason that has
nothing to do with the resume.
"""

import re

from app.core.taxonomy import canonical, expand_skills, skill_candidates
from app.modules.resume_analyzer.layout_check import inspect_ats_parsing_readiness
from app.modules.resume_analyzer.quality import (
    evaluate_bullets,
    parse_end_year,
    recency_credit,
    split_sections,
)

WEIGHTS: dict[str, int] = {
    "hard_skill_match": 30,
    "title_alignment": 15,
    "quantified_impact": 15,
    "ats_parseability": 15,
    "section_completeness": 10,
    "recency": 8,
    "readability": 7,
}

LABELS: dict[str, str] = {
    "hard_skill_match": "Hard skill match",
    "title_alignment": "Title alignment",
    "quantified_impact": "Quantified impact",
    "ats_parseability": "ATS parseability",
    "section_completeness": "Section completeness",
    "recency": "Recency",
    "readability": "Readability",
}

# Bands. Named rather than numeric so the UI never has to invent a cutoff,
# and kept coarse — a five-point difference is inside the noise of every
# measurement here, so finer bands would imply precision the inputs lack.
def band(score: float | None) -> str:
    if score is None:
        return "NOT CHECKED"
    if score >= 85:
        return "EXCELLENT"
    if score >= 70:
        return "STRONG"
    if score >= 55:
        return "GOOD"
    if score >= 35:
        return "NEEDS WORK"
    return "WEAK"


_BULLET_PREFIX = re.compile(r"^\s*[-•*·▪◦‣]\s+")
_STOPWORDS = {
    "senior", "sr", "junior", "jr", "staff", "principal", "lead", "i", "ii",
    "iii", "iv", "the", "a", "an", "of", "and", "for", "to", "in", "at",
}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", (text or "").lower()) if w not in _STOPWORDS and len(w) > 2}


def _bullets(resume_text: str) -> list[str]:
    return [
        _BULLET_PREFIX.sub("", line).strip()
        for line in (resume_text or "").splitlines()
        if _BULLET_PREFIX.match(line)
    ]


def hard_skill_match(resume_text: str, jd_text: str) -> float | None:
    """Share of the posting's skills the resume states or implies.

    Taxonomy-aware, so a candidate is not marked down for omitting a skill
    their other skills already demonstrate — the same expansion the analyzer
    uses, rather than a second opinion that would disagree with it.
    """
    required = skill_candidates(jd_text)
    if not required:
        return None
    have = expand_skills(skill_candidates(resume_text))
    hits = sum(1 for skill in required if canonical(skill) in have)
    return round(100.0 * hits / len(required), 1)


def title_alignment(resume_text: str, jd_title: str | None) -> float | None:
    """Overlap between the posting's title and the titles held.

    None when no title was supplied. Guessing one out of the JD body finds
    "Engineer" in a responsibilities paragraph and scores against it, which is
    worse than declining to score — the weight is redistributed instead.
    """
    wanted = _tokens(jd_title or "")
    if not wanted:
        return None

    experience = split_sections(resume_text).get("experience", "")
    held = _tokens(experience)
    if not held:
        return 0.0
    return round(100.0 * len(wanted & held) / len(wanted), 1)


def quantified_impact(resume_text: str) -> float | None:
    """Share of bullets carrying a number."""
    bullets = _bullets(resume_text)
    if not bullets:
        return None
    # Already a percentage, not a fraction — multiplying by 100 here
    # produced scores of 10000.
    return round(evaluate_bullets(bullets)["quantified_ratio"], 1)


def ats_parseability(resume_text: str, pdf_bytes: bytes | None) -> float:
    """Structural readiness, reused from the analyzer's own checker."""
    return inspect_ats_parsing_readiness(resume_text, pdf_bytes)["parsing_readiness_score"]


# Contact is checked separately from the headed sections: it has no heading of
# its own, so section splitting cannot find it.
REQUIRED_SECTIONS = ("experience", "education", "skills")


def section_completeness(resume_text: str) -> float:
    sections = split_sections(resume_text)
    present = sum(1 for name in REQUIRED_SECTIONS if (sections.get(name) or "").strip())
    return round(100.0 * present / len(REQUIRED_SECTIONS), 1)


_DATE_LINE = re.compile(r"\b(19|20)\d{2}\b")


def recency(resume_text: str) -> float | None:
    """How recent the roles are, from the years found in the experience block.

    Unknown dates are skipped rather than treated as old — a resume that omits
    years is unclear, not stale, and penalising it here would be measuring
    formatting under the name of recency.
    """
    experience = split_sections(resume_text).get("experience", "")
    credits = [
        recency_credit(year)
        for line in experience.splitlines()
        if _DATE_LINE.search(line)
        if (year := parse_end_year(line)) is not None
    ]
    if not credits:
        return None
    return round(100.0 * sum(credits) / len(credits), 1)


# Long bullets are the common failure; short ones are rarely the problem, so
# only the upper bound is scored.
IDEAL_BULLET_WORDS = 24
MAX_BULLET_WORDS = 40


def readability(resume_text: str) -> float | None:
    """Bullet length and how many open with a strong verb.

    Two halves, evenly weighted: a resume of forty-word bullets is hard to
    scan, and one that opens every line with "Responsible for" buries what the
    candidate actually did.
    """
    bullets = _bullets(resume_text)
    if not bullets:
        return None

    lengths = [len(b.split()) for b in bullets]
    over = sum(1 for n in lengths if n > MAX_BULLET_WORDS)
    length_score = 100.0 * (1 - over / len(lengths))

    verbs = evaluate_bullets(bullets)["strong_verb_ratio"]  # already 0-100
    return round(0.5 * length_score + 0.5 * verbs, 1)


def build_breakdown(
    resume_text: str,
    jd_text: str,
    jd_title: str | None = None,
    pdf_bytes: bytes | None = None,
) -> dict:
    """Every sub-score, plus the weighted total of the ones that could run.

    The total is renormalised over the weights that actually applied, so a
    resume whose title could not be checked is scored out of 85 and reported
    as such — not silently given zero for a check nobody performed.
    """
    scores: dict[str, float | None] = {
        "hard_skill_match": hard_skill_match(resume_text, jd_text),
        "title_alignment": title_alignment(resume_text, jd_title),
        "quantified_impact": quantified_impact(resume_text),
        "ats_parseability": ats_parseability(resume_text, pdf_bytes),
        "section_completeness": section_completeness(resume_text),
        "recency": recency(resume_text),
        "readability": readability(resume_text),
    }

    applied = {k: v for k, v in scores.items() if v is not None}
    weight_total = sum(WEIGHTS[k] for k in applied)
    total = (
        round(sum(WEIGHTS[k] * v for k, v in applied.items()) / weight_total, 1)
        if weight_total
        else None
    )

    metrics = [
        {
            "key": key,
            "label": LABELS[key],
            "weight": WEIGHTS[key],
            "score": scores[key],
            "band": band(scores[key]),
        }
        for key in WEIGHTS
    ]

    return {
        "rubric_total": total,
        "metrics": metrics,
        # What the total is actually out of. A UI that prints "72/100" when
        # only 85 points of checks ran is overstating its own coverage.
        "weight_applied": weight_total,
        "skipped": [LABELS[k] for k, v in scores.items() if v is None],
    }
