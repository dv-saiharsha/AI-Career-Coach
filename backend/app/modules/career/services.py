"""Career roadmap and offer-negotiation coaching.

Two rules carried over from the screening-prep module, for the same reason:

1. Compensation figures come from real cached postings or are absent. A
   benchmark is a number a user may repeat to an employer, so an invented one
   is worse than none — the caller is told the sample size and can say "we
   don't have data for this role" rather than render a confident band over
   nothing.
2. Generated prose never asserts a fact about the candidate. The counter-offer
   email ships with [bracketed placeholders] wherever a real detail belongs,
   because the alternative is handing someone a script that claims a
   background they may not have.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.llm import llm_client
from app.models.job import JobListing
from app.modules.career import salary as salary_utils

ROADMAP_SYSTEM_PROMPT = (
    "You are a career architect mapping a concrete progression path between two roles. "
    "Produce an ordered set of milestones from where the candidate is now to the role they're "
    "targeting, each naming the capabilities that actually gate the next step.\n\n"
    "Ground every milestone in the candidate's stated current role and target. Name specific, "
    "checkable things — a named technology, an architecture pattern, a scope of ownership, a "
    "credential — never vague advice like 'improve communication' or 'gain more experience'. "
    "Mark a skill as already-held only when the candidate's own details show it; when you are "
    "unsure, list it as a gap, because telling someone they already have a skill they lack is the "
    "one error that makes the whole roadmap useless to them."
)

ROADMAP_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "The role or level at this step."},
                    "summary": {"type": "string", "description": "One sentence on what changes at this step."},
                    "typical_duration": {"type": "string", "description": "Realistic time to reach it, e.g. '12-18 months'."},
                    "have_skills": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Capabilities the candidate's details show they already hold.",
                    },
                    "gap_skills": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Capabilities they must add to clear this step.",
                    },
                },
                "required": ["title", "summary", "typical_duration", "have_skills", "gap_skills"],
            },
        },
    },
    "required": ["milestones"],
}


def _roadmap_fallback(current_role: str, target_role: str) -> list[dict]:
    """Offline scaffold.

    Nothing here claims the candidate holds any skill, because with no LLM and
    no analysis there is nothing to base such a claim on.
    """
    return [
        {
            "title": current_role or "Where you are now",
            "summary": "Your current scope — the baseline the rest of the path builds on.",
            "typical_duration": "—",
            "have_skills": [],
            "gap_skills": [],
        },
        {
            "title": "Next level up",
            "summary": (
                "The step where ownership widens from tasks to systems. Add your current role and "
                "target in Profile, and connect the AI coach, to get this mapped specifically."
            ),
            "typical_duration": "12-18 months",
            "have_skills": [],
            "gap_skills": [
                "System design at production scale",
                "Owning a service end to end",
                "Mentoring or reviewing others' work",
            ],
        },
        {
            "title": target_role or "Your target role",
            "summary": "The role you're aiming at.",
            "typical_duration": "2-4 years",
            "have_skills": [],
            "gap_skills": [
                "Architecture decisions across multiple teams",
                "Influence without direct authority",
            ],
        },
    ]


def career_roadmap(
    current_role: str,
    target_role: str,
    seniority: str | None = None,
    known_skills: list[str] | None = None,
    gap_skills: list[str] | None = None,
) -> dict:
    """Milestone path from current role to target.

    known_skills/gap_skills come from the user's most recent resume analysis
    when there is one — that is what lets a milestone distinguish "you have
    this" from "this is missing" instead of guessing.
    """
    milestones: list[dict] = []
    llm_grounded = False

    if llm_client.available and (current_role.strip() or target_role.strip()):
        details = [f"CURRENT ROLE: {current_role or 'not specified'}", f"TARGET ROLE: {target_role or 'not specified'}"]
        if seniority:
            details.append(f"CURRENT SENIORITY: {seniority}")
        if known_skills:
            details.append("SKILLS CONFIRMED ON THEIR RESUME: " + ", ".join(known_skills[:30]))
        if gap_skills:
            details.append("SKILLS FLAGGED MISSING BY THEIR LAST SCAN: " + ", ".join(gap_skills[:30]))

        try:
            data = llm_client.complete_tool_json(
                ROADMAP_SYSTEM_PROMPT,
                "\n".join(details) + "\n\nMap 3-5 milestones from where they are to their target.",
                "submit_roadmap",
                ROADMAP_TOOL_SCHEMA,
                max_tokens=3000,
            )
            milestones = [m for m in (data.get("milestones") or []) if m.get("title")]
            llm_grounded = bool(milestones)
        except Exception:
            milestones = []

    if not milestones:
        milestones = _roadmap_fallback(current_role, target_role)

    for index, milestone in enumerate(milestones):
        milestone["id"] = f"m{index + 1}"
        milestone.setdefault("summary", "")
        milestone.setdefault("typical_duration", "")
        milestone.setdefault("have_skills", [])
        milestone.setdefault("gap_skills", [])

    return {
        "current_role": current_role,
        "target_role": target_role,
        # Lets the UI distinguish a real tailored path from the generic
        # scaffold, rather than presenting both with equal authority.
        "tailored": llm_grounded,
        "milestones": milestones,
    }


def salary_benchmark(db: Session, role: str) -> dict:
    """Pay bands for a role, computed from cached postings only.

    Matches on title rather than the cache's query_key so a role typed here
    still finds postings pulled under a different search. Returns sample_size
    0 with null bands when nothing matches — the honest answer when we simply
    have no data for a role.
    """
    term = role.strip()
    rows: list[str | None] = []
    if term:
        rows = [
            row[0]
            for row in db.query(JobListing.salary_range)
            .filter(
                JobListing.salary_range.isnot(None),
                func.lower(JobListing.title).contains(term.lower()),
            )
            .all()
        ]

    summary = salary_utils.summarise(rows)
    if summary is None:
        return {
            "role": role,
            "sample_size": 0,
            "p25": None,
            "median": None,
            "p75": None,
            "low": None,
            "high": None,
        }
    return {"role": role, **summary}


def counter_offer_email(
    role: str,
    company: str,
    current_offer: str,
    target_offer: str,
    benchmark: dict | None = None,
) -> str:
    """A counter-offer draft the candidate completes and sends.

    Deliberately not asserting a rationale on their behalf: the original
    template for this feature claimed "my specialized background in cloud
    architecture" for every user regardless of background, and cited market
    benchmarks whether or not any existed. Both are things a hiring manager
    can check, so both are placeholders here — and the benchmark sentence is
    only included when there is real data behind it.
    """
    company_phrase = company.strip() or "[Company]"
    role_phrase = role.strip() or "[Role]"

    if benchmark and benchmark.get("sample_size", 0) >= 3 and benchmark.get("median"):
        evidence = (
            f"Looking at current postings for comparable {role_phrase} roles, the midpoint sits "
            f"around ${benchmark['median']:,}, with the upper quartile near ${benchmark['p75']:,}. "
        )
    else:
        # No usable sample. Rather than inventing a figure, the draft asks the
        # candidate to supply their own source — which is also the stronger
        # negotiating position, since they can cite something specific.
        evidence = (
            "[Cite your evidence here — a specific competing offer, a levelling guide, or postings "
            "for comparable roles. A concrete source is far more persuasive than a general claim.] "
        )

    offer_line = (
        f"You extended an offer of {current_offer.strip()}, and "
        if current_offer.strip()
        else "Regarding the base compensation, "
    )
    target_phrase = target_offer.strip() or "[your target figure]"

    return (
        f"Hi [Hiring manager's name],\n\n"
        f"Thank you for the offer for the {role_phrase} role at {company_phrase} — I'm genuinely "
        f"excited about [the specific thing about the team or work that appeals to you], and I want "
        f"to make this work.\n\n"
        f"{offer_line}I'd like to discuss the base salary. "
        f"[Briefly name what you bring that's most relevant — the experience or result the role "
        f"is actually hiring for.] {evidence}"
        f"With that in mind, I'm hoping we can get the base to {target_phrase}.\n\n"
        f"If we can reach that, I'm ready to sign. Happy to talk it through on a call if that's "
        f"easier — and thank you for working with me on it.\n\n"
        f"Best,\n"
        f"[Your name]"
    )
