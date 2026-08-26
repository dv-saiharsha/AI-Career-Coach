"""Claude enrichment for raw job postings.

Runs through the Batch API: this is a background sweep with no latency
requirement, and batching halves the token cost. Requests go out as tool calls
rather than "return valid JSON" prompts, so the API enforces the shape instead
of us parsing whatever text came back (see app/core/llm.py for why that
distinction was worth making).

Model is Haiku, not the app-wide ANTHROPIC_MODEL. This is bulk classification
of boilerplate — the sweep runs thousands of these, and the cost difference
across a month is the difference between the feature being viable and not.
Overridable via JOB_ENRICHMENT_MODEL if a sweep ever needs a stronger read.

On H-1B specifically: the model reports what a posting *says*, never what an
employer will actually do. Sponsorship language is boilerplate that goes stale,
gets copied between reqs, and is frequently contradicted at screening. The
schema has no "will sponsor" value for that reason — only what was stated — and
anything short of an explicit statement falls to `unmentioned`.
"""

import logging
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# Cheap, fast, and adequate for reading explicit boilerplate. Not the app-wide
# model: this path is bulk classification, not reasoning.
DEFAULT_ENRICHMENT_MODEL = "claude-haiku-4-5"

# Enough for the tool call; the schema's free text is one short summary.
MAX_TOKENS = 400

# Descriptions are truncated before sending. Sponsorship and seniority language
# is almost always in the requirements block near the top, and the tail of a
# long posting is benefits boilerplate we pay for and learn nothing from.
MAX_DESCRIPTION_CHARS = 3000

ENRICHMENT_SYSTEM_PROMPT = (
    "You extract structured facts from job postings. Report only what the posting "
    "states or clearly implies — never infer an employer's intent, and never fill a "
    "field to seem helpful.\n\n"
    "h1b_sponsorship is about the posting's own words:\n"
    "  - 'explicitly_sponsored' only when it states sponsorship is available, or that "
    "it will support/transfer a visa.\n"
    "  - 'no_sponsorship' only when it states sponsorship is unavailable, or requires "
    "authorization to work without sponsorship now or in the future.\n"
    "  - 'unmentioned' for everything else, including postings that merely mention "
    "work authorization, citizenship, or clearance without addressing sponsorship. "
    "When the language is ambiguous, choose 'unmentioned'.\n\n"
    "experience_level reflects required years and scope of responsibility. Use null "
    "when the posting gives no basis to judge — do not default to mid."
)

ENRICHMENT_TOOL_NAME = "submit_job_facts"

ENRICHMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "h1b_sponsorship": {
            "type": "string",
            "enum": ["explicitly_sponsored", "no_sponsorship", "unmentioned"],
            "description": "What the posting states about visa sponsorship, not what the employer will do.",
        },
        "h1b_evidence": {
            "type": "string",
            "description": (
                "The sentence the classification came from, quoted verbatim. Empty "
                "string when unmentioned. This is shown to the candidate so they can "
                "judge the claim themselves."
            ),
        },
        "experience_level": {
            "type": ["string", "null"],
            "enum": ["entry", "mid", "senior", "lead", None],
            "description": "Null when the posting gives no basis to judge.",
        },
        "employment_type": {
            "type": ["string", "null"],
            "enum": ["full_time", "part_time", "contract", "internship", None],
        },
        "core_skills": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Concrete technologies and methods named in the posting. No soft skills.",
        },
        "summary": {"type": "string", "description": "Two sentences on what the role actually involves."},
    },
    "required": ["h1b_sponsorship", "h1b_evidence", "experience_level", "employment_type", "core_skills", "summary"],
}

# Returned when enrichment did not run or could not be parsed. Every field is
# an admission of absence rather than a guess — a job that failed enrichment
# must be indistinguishable from one whose posting said nothing, because that
# is exactly what we know about it.
UNENRICHED: dict[str, Any] = {
    "h1b_sponsorship": "unmentioned",
    "h1b_evidence": "",
    "experience_level": None,
    "employment_type": None,
    "core_skills": [],
    "summary": "",
}


def enrichment_model() -> str:
    return getattr(settings, "JOB_ENRICHMENT_MODEL", None) or DEFAULT_ENRICHMENT_MODEL


def build_user_prompt(title: str, company: str, description: str) -> str:
    return (
        f"Title: {title or 'not stated'}\n"
        f"Company: {company or 'not stated'}\n"
        f"Description:\n{(description or '')[:MAX_DESCRIPTION_CHARS]}"
    )


def build_request_params(title: str, company: str, description: str) -> dict:
    """Params for one batch entry.

    A plain dict rather than MessageCreateParamsNonStreaming so this stays
    inspectable in tests without constructing SDK types.
    """
    return {
        "model": enrichment_model(),
        "max_tokens": MAX_TOKENS,
        "system": ENRICHMENT_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": build_user_prompt(title, company, description)}],
        "tools": [
            {
                "name": ENRICHMENT_TOOL_NAME,
                "description": "Record the facts stated in this job posting.",
                "input_schema": ENRICHMENT_SCHEMA,
            }
        ],
        "tool_choice": {"type": "tool", "name": ENRICHMENT_TOOL_NAME},
    }


def parse_enrichment(message: Any) -> dict[str, Any]:
    """Pull the tool_use payload out of a batch result message.

    Falls back to UNENRICHED rather than raising: one malformed response in a
    sweep of hundreds should cost that job its metadata, not abort the run
    after the tokens are already spent.
    """
    try:
        for block in message.content:
            if getattr(block, "type", None) == "tool_use":
                payload = dict(block.input)
                # Normalise rather than trust: the enum permits null, and a
                # model returning the string "null" or "" would otherwise be
                # stored as a real classification.
                for field in ("experience_level", "employment_type"):
                    if payload.get(field) in ("", "null", "none", "unknown"):
                        payload[field] = None
                if payload.get("h1b_sponsorship") not in (
                    "explicitly_sponsored",
                    "no_sponsorship",
                    "unmentioned",
                ):
                    payload["h1b_sponsorship"] = "unmentioned"
                # Evidence only ever accompanies a verdict. The model
                # sometimes returns a quote alongside "unmentioned" anyway,
                # and a quote shown under a "not mentioned" label reads as a
                # finding the classification explicitly declined to make.
                if payload.get("h1b_sponsorship") == "unmentioned":
                    payload["h1b_evidence"] = ""
                skills = payload.get("core_skills")
                payload["core_skills"] = [s for s in skills if isinstance(s, str)] if isinstance(skills, list) else []
                return {**UNENRICHED, **payload}
    except Exception:
        logger.warning("enrichment: could not parse batch result", exc_info=True)
    return dict(UNENRICHED)
