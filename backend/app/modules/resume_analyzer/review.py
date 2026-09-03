"""Resume Review — one categorised view over analysers that already exist.

This module computes nothing new. Every number here is produced by
`rubric`, `quality`, `layout_check`, or `parse_checks`; the work is deciding
what to call each one, why it matters, and what to do about it. Adding a
second opinion on top of measurements the product already trusts would
create two answers to the same question, which is the failure mode this
module exists to remove rather than add to.

Two decisions worth stating up front, because both constrain everything
below:

**Resume Health is job-independent in both modes.** The rubric carries seven
weighted metrics, two of which (hard skill match, title alignment) only mean
anything against a posting. If Health included those, the same resume would
score differently depending on whether the user happened to paste a job
description — so Health would be measuring the match, not the resume. Health
is therefore computed from the five job-independent metrics alone, in both
modes, and Job Match is reported separately.

**Job Match is the trained model's number, and nothing else is.** The model
score stays the single authoritative figure for "how well does this resume
fit this posting", exactly as it is everywhere else in the product. It is
surfaced under its own name rather than blended into Health, because
averaging a learned prediction with a hand-weighted rubric would produce a
figure neither of them vouches for.
"""

from app.modules.resume_analyzer import quality
from app.modules.resume_analyzer import ats_vendors
from app.modules.resume_analyzer.layout_check import (
    check_contact_placement,
    check_glyph_integrity,
    inspect_ats_parsing_readiness,
)
from app.modules.resume_analyzer.rubric import (
    LABELS,
    WEIGHTS,
    band,
    build_breakdown,
    extract_bullets,
)

MODE_GENERAL = "general"
MODE_JOB_SPECIFIC = "job_specific"

# The rubric metrics that describe the document itself. See the module
# docstring: Health is built from these in both modes so it stays comparable.
HEALTH_KEYS: tuple[str, ...] = (
    "quantified_impact",
    "ats_parseability",
    "section_completeness",
    "recency",
    "readability",
)

# The metrics that only exist relative to a posting.
JOB_KEYS: tuple[str, ...] = ("hard_skill_match", "title_alignment")


def _priority(weight: int, score: float | None) -> str:
    """How much fixing this would actually move the score.

    Deliberately not just "low score = urgent". Recency is weighted 8 for a
    documented reason — nobody can change their own history — so a poor
    recency score is not the same call to action as a poor parseability
    score at weight 15, even at identical numbers. Ranking by recoverable
    weight puts effort where it pays.
    """
    if score is None:
        return "none"
    impact = weight * (100 - score) / 100
    if impact >= 6:
        return "high"
    if impact >= 3:
        return "medium"
    return "low"


# What each metric means and what to do about it. Static because Phase 1 adds
# no LLM call — these are the rubric's own documented rationale, surfaced to
# the user instead of living only in a docstring. Phase 3 replaces the
# `improvements` list with recruiter-voice, resume-specific rewrites.
_GUIDANCE: dict[str, dict[str, object]] = {
    "quantified_impact": {
        "label": "Resume strength",
        "explanation": (
            "The share of your bullets that carry a number — a percentage, a dollar "
            "figure, a count, a time saved."
        ),
        "improvements": [
            "Add a measurable outcome to your strongest bullets: what changed, and by how much.",
            "Where you cannot measure the outcome, measure the input — team size, request volume, data scale.",
        ],
    },
    "ats_parseability": {
        "label": "ATS readiness",
        "explanation": (
            "Whether an applicant tracking system can extract your resume's text and "
            "structure at all."
        ),
        "improvements": [
            "Use a single-column layout — multi-column resumes are frequently read out of order.",
            "Keep contact details in the body of the page rather than a header or footer.",
            "Export as a text-based PDF, not a scan or an image.",
        ],
    },
    "section_completeness": {
        "label": "Weak sections",
        "explanation": (
            "Whether the standard sections a parser looks for — experience, education, "
            "skills — are present and clearly headed."
        ),
        "improvements": [
            "Give every section a conventional heading; parsers locate content by heading, not by position.",
            "Avoid creative section names — 'Where I've Worked' does not match what a parser searches for.",
        ],
    },
    "recency": {
        "label": "Recency",
        "explanation": (
            "How recent your roles are, read from the dates in your experience section."
        ),
        "improvements": [
            "Make sure every role carries an explicit end date — undated roles are skipped, not penalised.",
            "Lead with the most recent role; skills used today count for more than the same skills years ago.",
        ],
    },
    "readability": {
        # Named for what it actually measures. The rubric key is historical.
        "label": "Bullet clarity",
        "explanation": (
            "Bullet length and how many of them open with a strong action verb. This is "
            "a scannability measure, not a prose-reading-level score."
        ),
        "improvements": [
            "Keep bullets under 40 words — a recruiter scans, they do not read.",
            "Open with what you did, not with 'Responsible for' or 'Helped with'.",
        ],
    },
    "hard_skill_match": {
        "label": "Keyword match",
        "explanation": (
            "The share of the skills named in this posting that your resume states or "
            "clearly implies."
        ),
        "improvements": [
            "State the skills you genuinely have that the posting names — a keyword search will not infer them.",
            "Put each skill where you actually used it, not only in a list at the bottom.",
        ],
    },
    "title_alignment": {
        "label": "Title alignment",
        "explanation": "How closely the titles you have held match the title on this posting.",
        "improvements": [
            "Where your internal title differs from the industry-standard one, consider noting both.",
        ],
    },
}


def _category(key: str, score: float | None, reason: str) -> dict:
    guidance = _GUIDANCE[key]
    weight = WEIGHTS[key]
    return {
        "key": key,
        "label": guidance["label"],
        "score": score,
        "band": band(score),
        "priority": _priority(weight, score),
        "explanation": guidance["explanation"],
        "reason": reason,
        "improvements": list(guidance["improvements"]),
        "available": score is not None,
    }


def _reason_for(key: str, score: float | None, facts: dict) -> str:
    """One sentence stating the measurement behind the score.

    Separate from `explanation` on purpose: the explanation says what the
    metric is, the reason says what *this* resume did. A user who disagrees
    with a score needs the second one to argue with it.
    """
    if score is None:
        if key in JOB_KEYS:
            return "Not scored — this needs a job description to compare against."
        if key in ("quantified_impact", "readability"):
            return (
                "Not scored — no bullet points were detected, so there was nothing to measure. "
                "If your resume uses bullets, they may not be exporting as text."
            )
        return "Not scored — the inputs for this check were unavailable."

    if key == "quantified_impact":
        return f"{score:.0f}% of your {facts['bullet_count']} bullets include a measurable result."
    if key == "ats_parseability":
        warnings = facts.get("warning_count", 0)
        if warnings:
            return f"Structural readiness scored {score:.0f}, with {warnings} formatting issue(s) detected."
        return f"Structural readiness scored {score:.0f} with no blocking formatting issues found."
    if key == "section_completeness":
        missing = facts.get("missing_sections") or []
        if missing:
            return f"Missing or unheaded: {', '.join(missing)}."
        return "Experience, education, and skills are all present and headed."
    if key == "recency":
        return f"Recency across your dated roles scored {score:.0f}."
    if key == "readability":
        return (
            f"{facts['strong_verb_ratio']:.0f}% of bullets open with a strong verb; "
            f"{facts['weak_opener_count']} open weakly."
        )
    if key == "hard_skill_match":
        return f"Your resume covers {score:.0f}% of the skills this posting names."
    if key == "title_alignment":
        return f"Title overlap with this posting scored {score:.0f}."
    return f"Scored {score:.0f}."


def _weighted_total(metrics_by_key: dict[str, float | None], keys: tuple[str, ...]) -> tuple[float | None, int, list[str]]:
    """Weighted mean over the subset of `keys` that could actually run.

    Same renormalisation the rubric uses: an unrunnable check is removed from
    the denominator rather than scored zero, so a resume is never reported as
    worse than it is because of a check nobody performed.
    """
    applied = {k: v for k, v in metrics_by_key.items() if k in keys and v is not None}
    weight = sum(WEIGHTS[k] for k in applied)
    if not weight:
        return None, 0, [LABELS[k] for k in keys]
    total = round(sum(WEIGHTS[k] * v for k, v in applied.items()) / weight, 1)
    skipped = [LABELS[k] for k in keys if metrics_by_key.get(k) is None]
    return total, weight, skipped


def _next_actions(mode: str, categories: list[dict], missing_skills: list[str]) -> list[dict]:
    """What to do next, derived from what was actually found.

    Ordered by the priority of the finding that produced each one, so the
    list is not the same six links on every resume.
    """
    by_key = {c["key"]: c for c in categories}
    actions: list[dict] = []

    def urgency(key: str) -> str:
        return by_key.get(key, {}).get("priority", "none")

    if urgency("ats_parseability") in ("high", "medium"):
        actions.append({
            "key": "improve_ats",
            "label": "Improve ATS compatibility",
            "description": "Fix the structural issues stopping a parser from reading this resume cleanly.",
            "href": "/resume",
            "priority": urgency("ats_parseability"),
        })
    if urgency("section_completeness") in ("high", "medium"):
        actions.append({
            "key": "improve_formatting",
            "label": "Fix section headings",
            "description": "Add or rename the sections a parser expects to find.",
            "href": "/resume",
            "priority": urgency("section_completeness"),
        })
    if missing_skills:
        actions.append({
            "key": "add_missing_skills",
            "label": "Add missing skills",
            "description": f"{len(missing_skills)} skill(s) this posting names are absent from your resume.",
            "href": "/resume",
            "priority": "high",
        })

    if mode == MODE_GENERAL:
        actions.append({
            "key": "job_specific_review",
            "label": "Review against a specific job",
            "description": "Add a job description to see keyword match, missing skills, and tailoring advice.",
            "href": "/jobs",
            "priority": "medium",
        })
    else:
        # /resume/tailor requires a job_listings id (?job=), which a
        # job-specific review never has — the job description here was
        # pasted as free text, not selected from a listing. Routing there
        # directly would be a dead end, so this points at the flow that
        # actually reaches it: pick a real posting, then tailor for it.
        actions.append({
            "key": "tailor_resume",
            "label": "Tailor for a specific job",
            "description": "Browse postings and tailor this resume for one directly.",
            "href": "/jobs",
            "priority": "medium",
        })

    actions.append({
        "key": "practice_interview",
        "label": "Practice interview questions",
        "description": "Rehearse the questions this resume invites.",
        "href": "/interview",
        "priority": "low",
    })
    actions.append({
        "key": "find_jobs",
        "label": "Find matching jobs",
        "description": "See postings that line up with what this resume already shows.",
        "href": "/jobs",
        "priority": "low",
    })
    return actions


def _contact_needles(resume_text: str) -> list[str]:
    """The contact strings whose placement check_contact_placement locates.

    Email and phone only. A name is not reliably findable as a literal — it
    may be styled, split across spans, or simply absent — and a needle that
    never matches would report "couldn't locate contact details" on a resume
    whose contact block is perfectly placed.
    """
    import re as _re

    email = _re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", resume_text or "")
    phone = _re.search(r"\+?\d[\d\-\s().]{7,}\d", resume_text or "")
    return [m.group(0).strip() for m in (email, phone) if m]


def build_review(
    resume_text: str,
    jd_text: str = "",
    *,
    pdf_bytes: bytes | None = None,
    stored_result: dict | None = None,
    model_score: float | None = None,
    resume_filename: str | None = None,
    analysis_id: int | None = None,
) -> dict:
    """The whole review, in whichever mode the inputs support.

    Mode is decided by the presence of a job description rather than by a
    caller-supplied flag: a stored scan already carries one or it does not,
    and a flag that could disagree with the data is a bug waiting to happen.
    """
    stored = stored_result or {}
    has_jd = bool((jd_text or "").strip())
    mode = MODE_JOB_SPECIFIC if has_jd else MODE_GENERAL

    breakdown = build_breakdown(resume_text, jd_text or "", jd_title=None, pdf_bytes=pdf_bytes)
    metrics_by_key: dict[str, float | None] = {m["key"]: m["score"] for m in breakdown["metrics"]}

    # Facts the reason strings quote. Computed once from the same bullet set
    # the rubric scored, so the narrative and the number cannot disagree.
    bullets = extract_bullets(resume_text)
    bullet_report = quality.evaluate_bullets(bullets)
    readiness = inspect_ats_parsing_readiness(resume_text, pdf_bytes)
    sections = quality.split_sections(resume_text)
    missing_sections = [
        name for name in ("experience", "education", "skills")
        if not (sections.get(name) or "").strip()
    ]
    facts = {
        "bullet_count": bullet_report["bullet_count"],
        "strong_verb_ratio": bullet_report["strong_verb_ratio"],
        "weak_opener_count": bullet_report["weak_opener_count"],
        "warning_count": len(readiness["warnings"]),
        "missing_sections": missing_sections,
    }

    keys = HEALTH_KEYS + (JOB_KEYS if has_jd else ())
    categories = [
        _category(key, metrics_by_key.get(key), _reason_for(key, metrics_by_key.get(key), facts))
        for key in keys
    ]

    # Grammar is a declared category with no implementation yet (Phase 2).
    # Present-but-unavailable rather than omitted: a gap the user can see is
    # honest, whereas a silently missing category reads as an oversight.
    categories.append({
        "key": "grammar",
        "label": "Grammar",
        "score": None,
        "band": band(None),
        "priority": "none",
        "explanation": "Spelling, tense consistency, and grammatical errors across the document.",
        "reason": "Not yet analysed — grammar checking is not part of this release.",
        "improvements": [],
        "available": False,
    })

    health, health_weight, health_skipped = _weighted_total(metrics_by_key, HEALTH_KEYS)

    missing_skills = list(stored.get("missing_skills") or [])
    matched_skills = list(stored.get("matched_skills") or [])
    missing_keywords = [
        item["keyword"]
        for item in (stored.get("keyword_analysis") or [])
        if not item.get("present")
    ]

    # Per-vendor compatibility. Built from the checks already computed above
    # rather than anything new — see ats_vendors.py for why this reports what
    # each system will do to the document instead of inventing a score for it.
    vendor_report = ats_vendors.evaluate(
        readiness,
        check_glyph_integrity(resume_text),
        check_contact_placement(pdf_bytes, _contact_needles(resume_text)),
    )

    return {
        "analysis_id": analysis_id,
        "resume_filename": resume_filename,
        "mode": mode,
        "ats_vendors": vendor_report,
        "resume_health": {
            "score": health,
            "band": band(health),
            "weight_applied": health_weight,
            "skipped": health_skipped,
        },
        # Only with a posting to match against, and only ever the model's own
        # number — see the module docstring.
        "job_match": (
            {
                "score": round(float(model_score), 1),
                "band": band(float(model_score)),
                "source": "trained_model",
            }
            if has_jd and model_score is not None
            else None
        ),
        "categories": categories,
        "missing_skills": missing_skills[:25],
        "matched_skills": matched_skills[:25],
        "missing_keywords": missing_keywords[:25],
        # Weakest first, already ordered by quality.evaluate_bullets.
        "bullet_improvements": [
            {
                "bullet": b["bullet"],
                "grade": b["grade"],
                "has_strong_verb": b["has_strong_verb"],
                "has_metric": b["has_metric"],
                "has_tool_context": b["has_tool_context"],
                "suggestions": b["suggestions"],
            }
            for b in bullet_report["bullets"]
            if b["grade"] < 3
        ][:10],
        "next_actions": _next_actions(mode, categories, missing_skills),
        # Phase 2/3 will flip this once grammar and recruiter-voice rewrites
        # land. Stated so a client never has to guess whether an LLM ran.
        "generated_by": "deterministic",
    }
