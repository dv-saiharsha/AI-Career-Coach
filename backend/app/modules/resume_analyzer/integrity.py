"""Detection of documents that game the score rather than earn it.

WHY THIS EXISTS

The trained model that produces `ats_score` was measured against adversarial
input and does not survive it. On one JD, with a real two-role resume carrying
quantified achievements as the control:

    real resume, real achievements ........ 49
    keyword dump, zero experience ......... 86
    the job description pasted back ....... 88

Pasting the posting back at itself scores 39 points higher than having done
the work. That is not a training defect — it follows from the feature set. Of
the nine features in ml/features.py, `keyword_overlap_ratio` and
`tfidf_cosine` both reach 1.0 for a verbatim copy, `keyword_matched_count`
maxes out and `resume_jd_length_ratio` sits at exactly 1. Four of nine are
optimised by copying, and not one asks whether the document is a resume or
whether the claims belong to the candidate.

Ramping the stuffing confirms the shape: appending the JD's keyword list to a
real resume moved it 48 -> 84 in one step, then saturated flat at 85 no matter
how much more was added. So there is no penalty band above 85 to avoid — 85 is
a ceiling the model cannot exceed, and the curve is monotonically
non-decreasing all the way to a 97% keyword density. Advice to reframe
honestly toward a 75-80 band is advice that loses to cheating, as long as
nothing measures the cheating.

This module measures it. Everything here is counting, so the verdict is
deterministic and identical across runs — the same property the guard in
resume_builder/guards.py relies on, for the same reason.

WHAT IT MEASURES

Four signals, because any one alone has an honest document that trips it:

  keyword_density     Share of tokens that are JD keywords. A real resume for
                      a matching role runs about 5-12%. The dumps measured
                      40-97%.

  max_repetition      Times the single most repeated JD keyword appears. A
                      candidate names their main language a few times; a dump
                      names it once per copy.

  verbatim_overlap    Share of the resume's word 8-grams that also occur in
                      the posting. Long exact runs of the employer's own prose
                      are not something a person writes independently. This is
                      the signal that catches the 88-point case, where the
                      other three can look merely enthusiastic.

  lexical_diversity   Unique tokens over total. Padding repeats vocabulary;
                      the ratio collapses as the copies accumulate.

Thresholds are stated as constants with the measurement that set them, and
they are deliberately loose. A false positive here tells someone their honest
resume looks like cheating, which is a much worse failure than letting a
marginal case through.
"""

import re
from collections import Counter

from app.core.keywords import keyword_candidates

# Share of tokens that are JD keywords. Measured: the real-resume control ran
# 11.8%, the first stuffing step 42.7%. Set at 30% — above anything a genuine
# document produced, below every dump.
DENSITY_LIMIT = 0.30

# Occurrences of the most-repeated JD keyword. A real resume names its primary
# stack in the summary, the skills line and a bullet or two.
REPETITION_LIMIT = 12

# Share of the resume's 8-grams also present in the posting. Eight words is
# long enough that shared phrasing is copying rather than coincidence — job
# titles and common phrases like "distributed systems at scale" are far
# shorter. A verbatim paste scores 1.0.
VERBATIM_LIMIT = 0.18

# Unique tokens over total, below which the document is mostly repetition.
# English prose sits near 0.4-0.6; the control resume measured 0.62.
DIVERSITY_FLOOR = 0.25

# Documents shorter than this are too small to judge — a three-line resume has
# a high density because it is short, not because it is stuffed.
MIN_TOKENS_TO_JUDGE = 120

SHINGLE_SIZE = 8

_TOKEN_RE = re.compile(r"[a-z0-9+#.]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _shingles(tokens: list[str], size: int = SHINGLE_SIZE) -> set[tuple[str, ...]]:
    if len(tokens) < size:
        return set()
    return {tuple(tokens[i : i + size]) for i in range(len(tokens) - size + 1)}


def assess(resume_text: str, jd_text: str) -> dict:
    """Score-integrity verdict for one (resume, JD) pair.

    `checked` is False when there is too little text to judge, and callers must
    treat that as "not measured" rather than "clean" — reporting an unverified
    document as passing is the same mistake as reporting an unrunnable rubric
    metric as a zero.
    """
    resume_tokens = _tokens(resume_text)
    jd_tokens = _tokens(jd_text)

    if len(resume_tokens) < MIN_TOKENS_TO_JUDGE or not jd_tokens:
        return {
            "checked": False,
            "reason": "Too little text to judge reliably.",
            "stuffed": False,
            "signals": [],
        }

    keywords = {kw.lower() for kw in keyword_candidates(jd_text)}
    counts = Counter(token for token in resume_tokens if token in keywords)

    total = len(resume_tokens)
    density = sum(counts.values()) / total
    repetition = max(counts.values()) if counts else 0
    diversity = len(set(resume_tokens)) / total

    resume_shingles = _shingles(resume_tokens)
    jd_shingles = _shingles(jd_tokens)
    verbatim = (
        len(resume_shingles & jd_shingles) / len(resume_shingles) if resume_shingles else 0.0
    )

    signals: list[dict] = []
    if density > DENSITY_LIMIT:
        signals.append(
            {
                "signal": "keyword_density",
                "value": round(density * 100, 1),
                "limit": round(DENSITY_LIMIT * 100, 1),
                "detail": (
                    f"{density * 100:.0f}% of this document is keywords from the posting. "
                    "A resume written for the role normally runs around 5-12%."
                ),
            }
        )
    if repetition > REPETITION_LIMIT:
        term, count = counts.most_common(1)[0]
        signals.append(
            {
                "signal": "max_repetition",
                "value": count,
                "limit": REPETITION_LIMIT,
                "detail": f'"{term}" appears {count} times. Repetition does not add evidence.',
            }
        )
    if verbatim > VERBATIM_LIMIT:
        signals.append(
            {
                "signal": "verbatim_overlap",
                "value": round(verbatim * 100, 1),
                "limit": round(VERBATIM_LIMIT * 100, 1),
                "detail": (
                    f"{verbatim * 100:.0f}% of this document repeats the posting's own wording "
                    "in runs of eight words or more."
                ),
            }
        )
    if diversity < DIVERSITY_FLOOR:
        signals.append(
            {
                "signal": "lexical_diversity",
                "value": round(diversity * 100, 1),
                "limit": round(DIVERSITY_FLOOR * 100, 1),
                "detail": "Most of this document is the same words repeated.",
            }
        )

    return {
        "checked": True,
        # Two independent signals rather than one. Every single threshold here
        # has an honest document that can reach it — a genuinely on-target
        # resume for a narrow role runs dense, and a short one runs
        # repetitive. Needing two makes an accusation much harder to trigger
        # by accident, which matters because the cost of being wrong falls on
        # a candidate who did nothing.
        "stuffed": len(signals) >= 2,
        "signals": signals,
        "measurements": {
            "keyword_density": round(density * 100, 1),
            "max_repetition": repetition,
            "verbatim_overlap": round(verbatim * 100, 1),
            "lexical_diversity": round(diversity * 100, 1),
        },
    }


def trustworthy_score(raw_score: float | None, verdict: dict) -> dict:
    """Pair a model score with whether it can be believed.

    Returns the raw number either way. Silently capping a stuffed document to
    something plausible would hide the one fact the candidate most needs — that
    the number came from repetition and an employer's ATS will not reward it
    the same way. `reportable` is what a UI should show; `raw` stays available
    so the difference is inspectable rather than a number that changed for
    unexplained reasons.
    """
    if raw_score is None:
        return {"raw": None, "reportable": None, "trusted": False, "reason": "No model available."}

    if not verdict.get("checked"):
        return {"raw": raw_score, "reportable": raw_score, "trusted": True, "reason": ""}

    if verdict.get("stuffed"):
        return {
            "raw": raw_score,
            "reportable": None,
            "trusted": False,
            "reason": (
                "This score can't be reported honestly. The document matches the posting by "
                "repetition rather than by evidence, and the scoring model rewards that — a "
                "real employer's screen, and the human after it, will not."
            ),
        }

    return {"raw": raw_score, "reportable": raw_score, "trusted": True, "reason": ""}
