"""Questions for the candidate to ask the interviewer, grounded in the JD.

Keyword selection goes through app/core/taxonomy.skill_candidates rather than a
local regex. Two reasons, both bugs the naive version has:

  * Stopword filtering has to happen in one case. Uppercasing tokens and then
    subtracting a lowercase stopword set removes nothing, so "FOR" and "WITH"
    survive as "keywords" and land mid-sentence in a question.
  * set() iteration order varies with PYTHONHASHSEED, so `list(set(words))[:4]`
    picks different terms on every process. The same JD would produce different
    questions each time it was opened, with no way to explain why.

skill_candidates is frequency-ordered, stopword-filtered, and phrase-aware, so
"deep learning" survives as one term instead of "DEEP" and "LEARNING".
"""

from app.core.taxonomy import domain_of, skill_candidates

# Fallbacks when a JD names nothing recognisable. Deliberately generic — a
# fabricated specific ("your Kubernetes migration") would have the candidate
# assert something about the company that may not be true.
_GENERIC_TECH = "the system's architecture"


def _display(term: str) -> str:
    """Present a term the way a person would say it.

    Canonical nodes are lowercase ("deep learning"), while acronyms extracted
    from the JD keep their original case ("AWS"). Uppercasing everything would
    put "trade-offs around DEEP LEARNING" in the middle of a sentence.
    """
    if term.isupper() or any(c.isdigit() for c in term):
        return term
    if term.islower() and " " in term:
        return term
    return term


def generate_reverse_questions(job_title: str, company: str, jd_text: str) -> list[dict]:
    """Three to five questions, the JD-specific ones first.

    Every question is either fully generic or built from a term the JD itself
    names — none of them assert a fact about the company.
    """
    title = (job_title or "").strip() or "this"
    org = (company or "").strip() or "the team"

    keywords = [k for k in skill_candidates(jd_text or "") if len(k) > 2][:4]
    primary = _display(keywords[0]) if keywords else None
    secondary = _display(keywords[1]) if len(keywords) > 1 else None
    domain = domain_of(keywords[0]) if keywords else None

    questions: list[dict] = []

    if primary:
        questions.append({
            "category": "Technical depth",
            "question": (
                f"The role leans on {primary}. What does that look like day to day here, and "
                f"what's the hardest problem the team has hit with it?"
            ),
            "purpose": (
                "Confirms the JD reflects the actual work, and surfaces the real constraints "
                "before you accept."
            ),
        })

    if secondary:
        questions.append({
            "category": "Scope and ownership",
            "question": (
                f"How do {primary} and {secondary} sit together in your stack — is one team "
                f"responsible for both, or are they split?"
            ),
            "purpose": "Reveals team boundaries and how much of the system you would actually own.",
        })

    if domain:
        questions.append({
            "category": "Trajectory",
            "question": (
                f"Where do you expect the {domain.lower()} side of the work to be in a year, and "
                f"what would you want this hire to have driven by then?"
            ),
            "purpose": "Turns the JD's requirements into a concrete definition of success.",
        })

    # Always included: these need no JD context and are the highest-signal
    # questions regardless of role.
    questions.append({
        "category": "Success criteria",
        "question": f"What would a strong first 90 days look like for a {title}?",
        "purpose": "Gets the hiring manager to state their real priorities, not the JD's.",
    })
    questions.append({
        "category": "Team reality",
        "question": (
            f"How does {org} decide between paying down technical debt and shipping new work "
            f"when both are urgent?"
        ),
        "purpose": "Shows how the team behaves under pressure, which the JD never says.",
    })

    if not primary:
        questions.insert(0, {
            "category": "Technical depth",
            "question": (
                f"What are the biggest technical constraints on {_GENERIC_TECH} right now?"
            ),
            "purpose": "Opens the conversation the JD didn't give enough detail to target.",
        })

    return questions[:5]
