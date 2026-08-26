"""Cover letter generation, grounded in the resume it was written from.

A cover letter is free prose, which makes it the most dangerous document this
product generates. A resume bullet is anchored to a role and a date; a cover
letter paragraph is not anchored to anything, and a model asked to "sound
confident" will write "I increased revenue 40%" without hesitation. The
candidate then has to defend that number in an interview.

So the generation is constrained twice, and neither is decorative:

  * The prompt forbids introducing any metric, employer, technology or
    outcome not present in the resume. Tone changes register, never content —
    "confident" is a way of writing the same facts, not permission to add
    better ones.

  * Output is checked afterwards. Every number in the letter is looked for in
    the resume, and any that is missing is returned in `unsupported_claims`
    for the user to see before they send it. The check is cheap and catches
    the failure that matters most; it is not a guarantee, and the UI says so
    rather than implying the letter has been verified true.

Cost is roughly $0.017 per letter at current Sonnet pricing — about 3k input
tokens (resume plus posting) and 500 output.
"""

import logging
import re

from app.core.llm import ClaudeClient
from app.modules.resume_builder.faang import sanitize_token, split_name

logger = logging.getLogger(__name__)

TONES = ("professional", "confident", "concise")

# Long enough for three or four real paragraphs, short enough that the model
# cannot pad. A cover letter that runs to a second page does not get read.
MAX_TOKENS = 1200
MAX_PARAGRAPHS = 4

_SYSTEM = """You write cover letters that a candidate can defend in an interview.

You are given a candidate's resume text and a job posting. Write a short,
specific cover letter connecting what the candidate has actually done to what
the posting asks for.

Absolute constraints — these override the tone instruction:

1. Never state a metric, percentage, dollar figure, timespan, employer,
   job title, technology or credential that does not appear in the resume.
   If the resume says "reduced latency", you may say "reduced latency". You
   may NOT say "reduced latency by 40%" unless 40% is in the resume.
2. Never claim years of experience unless the resume's dates support it.
3. Never claim enthusiasm for, or knowledge of, the company beyond what the
   posting itself states.
4. If the candidate is weak against a requirement, do not paper over it.
   Either connect the nearest genuine experience or leave it out. Do not
   assert a skill the resume does not evidence.

Tone controls register and sentence length only. It never licenses a stronger
claim than the resume supports.

Write 3-4 paragraphs. No greeting line, no sign-off — those are added by the
template. Return each paragraph as a separate string."""

_TONE_GUIDANCE = {
    "professional": "Measured and plain. Standard business register.",
    "confident": "Direct and assertive in phrasing. Same facts, stated without hedging.",
    "concise": "As short as the content allows. Three paragraphs, short sentences.",
}

_SCHEMA = {
    "type": "object",
    "properties": {
        "paragraphs": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-4 body paragraphs. No greeting, no sign-off.",
        },
        "grounded_in": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Short quotes from the resume that each claim rests on.",
        },
    },
    "required": ["paragraphs", "grounded_in"],
}

# Matches figures a reader would treat as a factual claim. Bare small integers
# are excluded: "3 teams" is not the kind of number anyone verifies, and
# flagging every one of them would bury the metrics that matter.
_FIGURE = re.compile(r"\b\d[\d,.]*\s*(?:%|percent|k\b|m\b|bn\b|x\b)|\$\s?\d[\d,.]*|\b\d{4}\b|\b\d{2,}\b", re.I)


def _normalise_figures(text: str) -> set[str]:
    return {m.group(0).lower().replace(" ", "").replace(",", "") for m in _FIGURE.finditer(text or "")}


def unsupported_figures(letter: str, resume_text: str) -> list[str]:
    """Numbers asserted in the letter that do not appear in the resume.

    Deliberately a report, not a rejection. The match is textual, so a resume
    saying "38%" and a letter saying "nearly 40%" flags even though the intent
    is defensible — the user is the right person to judge that, and silently
    dropping the sentence would be worse than showing them.
    """
    in_resume = _normalise_figures(resume_text)
    return sorted(f for f in _normalise_figures(letter) if f not in in_resume)


def build_filename(full_name: str | None, job_title: str, company: str) -> str:
    """LASTNAME_FIRSTNAME_COVER_LETTER_ROLE_COMPANY.pdf

    Same convention and same helpers as the resume, so a candidate's two
    documents sort together in a recruiter's downloads folder.
    """
    first, last = split_name(full_name)
    return (
        f"{last}_{first}_COVER_LETTER_"
        f"{sanitize_token(job_title, 'ROLE')}_"
        f"{sanitize_token(company, 'COMPANY')}.pdf"
    )


def generate_letter(
    resume_text: str,
    job_title: str,
    company: str,
    job_description: str,
    tone: str = "professional",
) -> dict:
    """Draft the body paragraphs. One Claude call.

    Raises RuntimeError when no API key is configured — there is no rule-based
    fallback here on purpose. A template letter with the company name slotted
    in reads as a template letter, and shipping one under the label "tailored"
    would be worse for the candidate than telling them the feature is off.
    """
    if tone not in TONES:
        tone = "professional"

    client = ClaudeClient()
    if not client.available:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")

    user = (
        f"TONE: {tone} — {_TONE_GUIDANCE[tone]}\n\n"
        f"ROLE: {job_title}\n"
        f"COMPANY: {company}\n\n"
        f"JOB POSTING:\n{job_description[:6000]}\n\n"
        f"CANDIDATE RESUME:\n{resume_text[:6000]}"
    )

    result = client.complete_tool_json(
        system=_SYSTEM,
        user=user,
        tool_name="cover_letter",
        input_schema=_SCHEMA,
        max_tokens=MAX_TOKENS,
    )

    paragraphs = [p.strip() for p in (result.get("paragraphs") or []) if p and p.strip()]
    paragraphs = paragraphs[:MAX_PARAGRAPHS]

    body = "\n\n".join(paragraphs)
    return {
        "paragraphs": paragraphs,
        "grounded_in": result.get("grounded_in") or [],
        # Surfaced rather than silently stripped: the user decides whether a
        # figure is defensible, and a sentence deleted behind their back is
        # not something they can review.
        "unsupported_claims": unsupported_figures(body, resume_text),
        "tone": tone,
    }
