"""Job Matching Engine.

Structured as a small registry of independent match providers rather than
one monolithic scoring function, specifically so Experience/Education/
Salary/Location can be added later — once there is real structured data to
back them — without touching the engine itself or either provider shipped
here. Every provider shares one signature: `(context, job) -> dict | None`,
returning `None` when it cannot run for that job (no stored description, no
listed skills). The engine never fabricates a number for a dimension that
can't run; it omits the dimension instead — the same principle
`resume_analyzer/rubric.py` and `resume_analyzer/review.py` already apply.

Two providers ship today:

  Resume Match  — the same trained model already used for
                  JobApplication.match_score (app/ml/inference.py). No
                  second scoring model, no new logic — a thin call site.

  Skills Match  — taxonomy-aware overlap between the resume's skills and
                  JobListing.skills, using the exact alias/expansion
                  machinery resume_analyzer/rubric.py's hard_skill_match
                  already relies on, adapted to compare against a curated
                  skills list instead of raw job-description text (more
                  precise attribution: "8 of 10 listed skills", not a
                  fuzzy text-similarity guess).

Experience/Education/Salary/Location Match are NOT implemented — see the
architecture review this milestone was scoped against: the job side has no
structured data for Education/Salary/Location at all, and the user side has
no years-of-experience or degree field either. Fabricating a score here
would be exactly what this file's docstring above forbids. Adding one later
means writing one function matching MatchProvider's signature and appending
it to PROVIDERS — nothing else in this file changes.
"""

from dataclasses import dataclass
from typing import Callable

from app.core.taxonomy import canonical, expand_skills, group_by_domain, skill_candidates
from app.ml.inference import model_available, predict_score
from app.modules.resume_analyzer.rubric import band


@dataclass(frozen=True)
class MatchContext:
    """Computed once per request, passed to every provider. Each provider
    reads only the fields it needs — score_resume_match never touches
    `skill_set`, score_skills_match never touches `resume_text` — but one
    shared shape is what makes the registry below a real registry instead
    of a lookup table of incompatible function signatures."""

    resume_text: str
    skill_set: dict[str, float]


# ── Resume Match ────────────────────────────────────────────────────────


def score_resume_match(context: MatchContext, job: dict) -> dict | None:
    """The trained model's own score — identical call to what already
    populates JobApplication.match_score, just against a feed listing
    instead of a saved application."""
    description = job.get("description")
    if not description or not model_available():
        return None
    score = float(predict_score(context.resume_text, description))
    return {
        "key": "resume_match",
        "label": "Resume Match",
        "score": round(score, 1),
        "band": band(score),
    }


# ── Skills Match ────────────────────────────────────────────────────────


def score_skills_match(context: MatchContext, job: dict) -> dict | None:
    """Taxonomy-aware overlap against this listing's own skills list."""
    job_skills = job.get("skills") or []
    if not job_skills:
        return None

    matching: list[str] = []
    missing: list[str] = []
    for skill in job_skills:
        if canonical(skill) in context.skill_set:
            matching.append(skill)
        else:
            missing.append(skill)

    score = 100.0 * len(matching) / len(job_skills)
    return {
        "key": "skills_match",
        "label": "Skills Match",
        "score": round(score, 1),
        "band": band(score),
        "matchingSkills": matching,
        "missingSkills": missing,
        # Reuses the same domain grouping review.py already shows for a
        # resume's own skill gaps — same vocabulary, applied to a listing.
        "skillCategories": group_by_domain(missing),
        # Filled in by annotate_priority_skills once the whole feed is
        # known — a single job can't tell which of its missing skills also
        # blocks other listings the user is looking at.
        "prioritySkills": [],
        "learningRecommendations": [],
    }


# The registry. A future Experience/Education/Salary/Location provider is
# one function of this same shape, appended here — build_job_match and
# everything downstream of it needs no change to pick it up.
MatchProvider = Callable[[MatchContext, dict], "dict | None"]
PROVIDERS: tuple[MatchProvider, ...] = (score_resume_match, score_skills_match)


def _build_explanation(dimensions: dict[str, dict]) -> str:
    """Deterministic, template-based — no LLM call in this phase. Built
    from the real matched/missing counts, in the exact shape the product
    spec's own example used: 'X of Y required skills... improving Z would
    improve your chances.'"""
    resume_match = dimensions.get("resume_match")
    skills_match = dimensions.get("skills_match")
    if not resume_match and not skills_match:
        return "Not enough information to explain this match — this listing has no stored description or skills to compare against."

    tier_word = {
        "EXCELLENT": "an excellent",
        "STRONG": "a strong",
        "GOOD": "a good",
        "NEEDS WORK": "a partial",
        "WEAK": "a weak",
    }
    sentences: list[str] = []

    if skills_match:
        matched_n = len(skills_match["matchingSkills"])
        total_n = matched_n + len(skills_match["missingSkills"])
        headline_band = resume_match["band"] if resume_match else skills_match["band"]
        sentences.append(
            f"This role is {tier_word.get(headline_band, 'a')} match — your resume aligns with "
            f"{matched_n} of {total_n} listed skills."
        )
        top_missing = skills_match["prioritySkills"] or skills_match["missingSkills"][:2]
        if top_missing:
            sentences.append(f"Improving {' and '.join(top_missing[:2])} would improve your chances.")
    elif resume_match:
        sentences.append(
            f"This role is {tier_word.get(resume_match['band'], 'a')} match based on your resume's "
            "overall alignment with the posting."
        )

    return " ".join(sentences)


def build_job_match(context: MatchContext, job: dict) -> dict:
    """The engine: run every registered provider, keep only what actually
    ran, build the explanation from whatever came back. Overall Match is
    the Resume Match score itself — Skills Match is shown as its own
    detail alongside it, not blended into one number, so each stays
    inspectable on its own terms rather than hidden inside a weighted
    average nobody can unpack."""
    dimensions: dict[str, dict] = {}
    for provider in PROVIDERS:
        result = provider(context, job)
        if result is not None:
            dimensions[result["key"]] = result

    resume_match = dimensions.get("resume_match")
    return {
        "overallMatch": resume_match["score"] if resume_match else None,
        "band": resume_match["band"] if resume_match else None,
        "resumeMatch": resume_match,
        "skillsMatch": dimensions.get("skills_match"),
        "explanation": _build_explanation(dimensions),
        "generatedBy": "deterministic",
    }


def annotate_priority_skills(jobs_with_matches: list[dict]) -> None:
    """Ranks each listing's missing skills by how many OTHER listings in
    this same feed also require them, in place.

    The skill most worth learning is the one that unlocks the most of what
    a candidate is currently looking at, not just the one job it happened
    to attach to. Purely a re-ranking of data already computed — no new
    scoring, and it costs nothing extra to skip when a feed has only one
    or two scored listings.
    """
    from collections import Counter

    frequency: Counter[str] = Counter()
    for job in jobs_with_matches:
        skills_match = (job.get("match") or {}).get("skillsMatch")
        if skills_match:
            frequency.update(skills_match["missingSkills"])

    for job in jobs_with_matches:
        match = job.get("match")
        skills_match = match.get("skillsMatch") if match else None
        if not skills_match or not skills_match["missingSkills"]:
            continue
        ranked = sorted(skills_match["missingSkills"], key=lambda s: -frequency[s])[:3]
        skills_match["prioritySkills"] = ranked
        skills_match["learningRecommendations"] = [
            (
                f"{skill} appears in {frequency[skill]} of your matched jobs"
                if frequency[skill] > 1
                else f"{skill} is required for this role"
            )
            for skill in ranked
        ]
        # The explanation was built before priority ranking existed for
        # this feed pass, so its "improving X" clause still pointed at an
        # arbitrary pair of missing skills rather than the highest-leverage
        # ones — rebuild it now that ranking is known, from the same two
        # dimension slots build_job_match populated.
        rebuilt_dimensions = {"skills_match": skills_match}
        if match["resumeMatch"]:
            rebuilt_dimensions["resume_match"] = match["resumeMatch"]
        match["explanation"] = _build_explanation(rebuilt_dimensions)


def attach_matches(jobs_payload: list[dict], resume_text: str) -> list[dict]:
    """Public entry point for the router: annotate an already-built,
    already-filtered job payload list with a `match` key per job.

    Computed fresh per request rather than cached — predict_score() is a
    local model call (no network, no LLM) and the skills overlap is a set
    intersection over a feed of a few dozen listings, so the cost this
    would guard against doesn't really exist yet. Add a cache if profiling
    ever says otherwise; introducing one now would be solving a problem
    that hasn't shown up.
    """
    context = MatchContext(resume_text=resume_text, skill_set=expand_skills(skill_candidates(resume_text)))
    for job in jobs_payload:
        job["match"] = build_job_match(context, job)
    annotate_priority_skills(jobs_payload)
    return jobs_payload
