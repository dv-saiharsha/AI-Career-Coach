"""Resume quality diagnostics: bullet impact, section context, and recency.

These are DIAGNOSTICS, not a score. ats_score continues to come from the
trained regression model (app/ml/inference.predict_score, MAE 7.35 / R² 0.722
on 2,066 labelled examples); nothing here feeds into it. The distinction
matters because a hand-weighted composite can be tuned until it produces
pleasing numbers, whereas a fitted model's error is measured against real
labels. What these add is the thing a score cannot give: a specific,
actionable reason a resume is weak.

Three lenses:

  1. Bullet impact — Google's X-Y-Z shape ("accomplished [X] as measured by
     [Y] by doing [Z]"): a strong opening verb, a real figure, and the tool
     or method used.
  2. Section context — where a skill appears. A skill demonstrated inside an
     experience bullet is evidenced; the same word in a comma-separated list
     under "Skills" is a claim.
  3. Recency — when it was last used. AWS in the current role and AWS in a
     2019 internship are not the same signal to a recruiter.
"""

import math
import re
from datetime import date

from app.core.taxonomy import canonical

# ── Bullet impact (X-Y-Z) ────────────────────────────────────────────────

# Reused rather than redefined — app/ml/features.py already owns this list and
# the model was trained on counts derived from it. Two divergent copies would
# mean the diagnostic and the score disagreed about what a strong verb is.
from app.ml.features import ACTION_VERBS

WEAK_OPENERS = {
    "responsible", "worked", "helped", "assisted", "participated", "involved",
    "tasked", "duties", "supported", "contributed", "familiar", "exposure",
}

# A figure a recruiter can hold onto. Deliberately not a bare \d+ — "5 years"
# and "Python 3" are numbers that measure nothing about impact.
METRIC_PATTERNS = [
    r"\d+(?:\.\d+)?\s*%",                                   # 40%, 12.5%
    r"[$£€]\s?\d[\d,]*(?:\.\d+)?\s*[kKmMbB]?",              # $2M, £45,000
    r"\b\d+(?:\.\d+)?\s*[kKmMbB]\b(?!\w)",                  # 500k, 2M
    r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds|min|mins|minutes|hours|hrs|days|weeks)\b",
    r"\b\d+(?:\.\d+)?\s*x\b",                               # 3x
    r"\bfrom\s+\d[\d,.]*\s*\w*\s+to\s+\d[\d,.]*",           # from 40 to 95
    r"\b\d[\d,]{3,}\b",                                     # 10,000+ — large raw counts
]
_METRIC_RE = re.compile("|".join(METRIC_PATTERNS), re.IGNORECASE)

# Evidence of *how* the work was done. Kept generic — a curated tool list would
# go stale, whereas these constructions are how people phrase method.
_TOOL_CONTEXT_RE = re.compile(
    r"\b(using|with|via|through|leveraging|built on|in)\s+[A-Z][\w.+#-]*"
    r"|\b(?:[A-Z][\w+#.-]*\s+){0,2}(?:API|SDK|framework|pipeline|cluster|service)s?\b",
)

_BULLET_PREFIX = re.compile(r"^\s*[•\-\*–—▪·]\s*")


def _first_word(text: str) -> str:
    stripped = _BULLET_PREFIX.sub("", text).strip()
    return stripped.split(" ", 1)[0].lower().strip(".,:;") if stripped else ""


def evaluate_bullet(bullet: str) -> dict:
    """Grade one bullet against the X-Y-Z shape.

    `grade` counts the three components present. It is intentionally NOT
    converted to a 0-100 "score": a 3-point checklist reported as "67%" implies
    a precision it does not have.
    """
    text = _BULLET_PREFIX.sub("", bullet or "").strip()
    opener = _first_word(text)

    has_strong_verb = opener in ACTION_VERBS
    has_weak_opener = opener in WEAK_OPENERS
    metrics = [m.group(0).strip() for m in _METRIC_RE.finditer(text)]
    has_metric = bool(metrics)
    has_tool_context = bool(_TOOL_CONTEXT_RE.search(text))

    suggestions: list[str] = []
    if has_weak_opener:
        suggestions.append(
            f'Opens with "{opener}" — lead with what you did (Built, Reduced, Designed) '
            "rather than what you were assigned."
        )
    elif not has_strong_verb:
        suggestions.append("Start with a strong action verb so the achievement lands first.")
    if not has_metric:
        suggestions.append("No figure here — add the number, percentage, or timeframe if you have one.")
    if not has_tool_context:
        suggestions.append("Name the tool or method you used to do it.")

    grade = sum([has_strong_verb, has_metric, has_tool_context])
    return {
        "bullet": text,
        "grade": grade,
        # Same three checks on a 0-100 scale for display. The floor is a real
        # 0: a bullet with no verb, no metric and no method has demonstrated
        # nothing, and reporting that as "50%" would read like a pass.
        "impact_rating": round(grade / 3 * 100, 1),
        "has_strong_verb": has_strong_verb,
        "has_weak_opener": has_weak_opener,
        "has_metric": has_metric,
        "has_tool_context": has_tool_context,
        "metrics": metrics[:5],
        "suggestions": suggestions,
    }


def evaluate_bullets(bullets: list[str]) -> dict:
    """Aggregate bullet quality across a resume."""
    cleaned = [b for b in (bullets or []) if b and b.strip()]
    if not cleaned:
        return {
            "bullet_count": 0,
            "quantified_ratio": 0.0,
            "strong_verb_ratio": 0.0,
            "weak_opener_count": 0,
            "average_grade": 0.0,
            "impact_rating": 0.0,
            "bullets": [],
        }

    evaluations = [evaluate_bullet(b) for b in cleaned]
    total = len(evaluations)
    return {
        "bullet_count": total,
        "impact_rating": round(sum(e["impact_rating"] for e in evaluations) / total, 1),
        "quantified_ratio": round(sum(e["has_metric"] for e in evaluations) / total * 100, 1),
        "strong_verb_ratio": round(sum(e["has_strong_verb"] for e in evaluations) / total * 100, 1),
        "weak_opener_count": sum(e["has_weak_opener"] for e in evaluations),
        "average_grade": round(sum(e["grade"] for e in evaluations) / total, 2),
        # Weakest first: the list is a worklist, so what needs fixing goes on top.
        "bullets": sorted(evaluations, key=lambda e: e["grade"])[:20],
    }


# ── Section context ──────────────────────────────────────────────────────

# Where a skill appears changes what it evidences. A skill inside an experience
# bullet was demonstrably applied; the same token in a footer list is asserted.
SECTION_WEIGHTS: dict[str, float] = {
    "experience": 1.0,
    "projects": 0.5,
    "skills": 0.7,
    "education": 0.3,
    "certifications": 0.3,
    "other": 0.4,
}

_SECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("experience", re.compile(r"^\s*(work\s+|professional\s+|relevant\s+)?experience\b|^\s*employment\b|^\s*work\s+history\b", re.I)),
    ("projects", re.compile(r"^\s*(personal\s+|academic\s+|side\s+)?projects\b|^\s*portfolio\b", re.I)),
    ("skills", re.compile(r"^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|proficiencies|technologies)\b|^\s*areas of expertise\b", re.I)),
    ("education", re.compile(r"^\s*education\b|^\s*academic\b|^\s*coursework\b", re.I)),
    ("certifications", re.compile(r"^\s*certifications?\b|^\s*licen[cs]es?\b|^\s*credentials\b", re.I)),
]

# A heading is a short line. Without this, a sentence merely *containing* the
# word "experience" would open a new section mid-paragraph.
_MAX_HEADING_WORDS = 6


def split_sections(resume_text: str) -> dict[str, str]:
    """Segment resume text by heading. Text before any recognised heading goes
    to 'other' — that is usually the name/contact block and a summary."""
    sections: dict[str, list[str]] = {}
    current = "other"

    for line in (resume_text or "").splitlines():
        stripped = line.strip()
        if stripped and len(stripped.split()) <= _MAX_HEADING_WORDS:
            for name, pattern in _SECTION_PATTERNS:
                if pattern.search(stripped):
                    current = name
                    break
            else:
                sections.setdefault(current, []).append(line)
                continue
            # Heading line itself is not body text.
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)

    return {name: "\n".join(lines) for name, lines in sections.items()}


# Repeating a term this many times without ever evidencing it in experience or
# projects is the classic keyword-stuffing pattern.
STUFFING_THRESHOLD = 5


def skill_context(resume_text: str, skill: str) -> dict:
    """Where a skill appears, and what that is worth.

    `weight` is the best context the skill was found in — a skill in both the
    skills list and an experience bullet earns the experience weight, since the
    weaker mention doesn't diminish the stronger evidence.
    """
    sections = split_sections(resume_text)
    node = canonical(skill)
    needle = skill.lower().strip()

    found_in: list[str] = []
    occurrences = 0
    for name, body in sections.items():
        lowered = body.lower()
        count = lowered.count(needle)
        if count == 0 and node and node != needle:
            count = lowered.count(node)
        if count:
            found_in.append(name)
            occurrences += count

    if not found_in:
        return {
            "skill": skill,
            "found": False,
            "sections": [],
            "occurrences": 0,
            "weight": 0.0,
            "stuffed": False,
        }

    weight = max(SECTION_WEIGHTS.get(name, SECTION_WEIGHTS["other"]) for name in found_in)
    evidenced = any(name in ("experience", "projects") for name in found_in)
    stuffed = occurrences >= STUFFING_THRESHOLD and not evidenced

    return {
        "skill": skill,
        "found": True,
        "sections": sorted(found_in),
        "occurrences": occurrences,
        # Stuffing costs the skill its context weight rather than the whole
        # resume a flat penalty — the damage is localised to the claim.
        "weight": round(weight * (0.5 if stuffed else 1.0), 3),
        "stuffed": stuffed,
    }


# ── Recency ──────────────────────────────────────────────────────────────

# Exponential decay: credit = e^(-LAMBDA * years_since_last_use).
# LAMBDA 0.17 gives ~1.00 at 0 years, ~0.84 at 1, ~0.71 at 2, ~0.60 at 3 —
# matching the intended "current 100% / recent 85% / stale 60%" shape with a
# continuous curve rather than a step function, so a role ending 23 months ago
# isn't scored identically to one ending 13 months ago.
RECENCY_LAMBDA = 0.17
RECENCY_FLOOR = 0.5

_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
_PRESENT_RE = re.compile(r"\b(present|current|now|ongoing|to date)\b", re.I)


def parse_end_year(dates_text: str, today: date | None = None) -> int | None:
    """Year a role ended, or the current year when it's ongoing.

    Returns None when no year is present — the caller then treats recency as
    unknown rather than assuming a date, because guessing here would silently
    penalise a resume that simply formats dates unusually.
    """
    text = dates_text or ""
    reference = today or date.today()
    if _PRESENT_RE.search(text):
        return reference.year
    years = [int(m.group(0)) for m in _YEAR_RE.finditer(text)]
    if not years:
        return None
    # The later year is the end of the range.
    return max(years)


def recency_credit(end_year: int | None, today: date | None = None) -> float:
    """Decay multiplier for a skill last used in `end_year`.

    Unknown dates return 1.0, not a penalty: we cannot distinguish "old" from
    "unparseable", and docking a resume for its date format would be wrong.
    """
    if end_year is None:
        return 1.0
    reference = today or date.today()
    years_ago = max(0, reference.year - end_year)
    return round(max(RECENCY_FLOOR, math.exp(-RECENCY_LAMBDA * years_ago)), 3)


def evaluate_recency(experiences: list[dict], today: date | None = None) -> list[dict]:
    """Per-role recency credit.

    `experiences` are dicts with 'title', 'company', 'dates' and 'bullets' —
    the same shape the resume builder already uses.
    """
    results = []
    for experience in experiences or []:
        end_year = parse_end_year(experience.get("dates", ""), today)
        results.append({
            "title": experience.get("title", ""),
            "company": experience.get("company", ""),
            "dates": experience.get("dates", ""),
            "end_year": end_year,
            "recency_credit": recency_credit(end_year, today),
        })
    return results
