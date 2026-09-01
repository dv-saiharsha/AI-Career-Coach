"""Turn orchestration: persist the user's message, stream Claude's reply,
generate follow-up chips, persist the reply. One streaming call plus one
small non-streaming call per turn — no interleaved tool-use-inside-a-stream,
by explicit choice: two ordinary, sequential calls are simpler to reason
about and test than one call producing mixed event types.
"""

import json
from typing import AsyncIterator

from sqlalchemy.orm import Session

from app.core.llm import llm_client
from app.models.career_coach import CoachConversation, CoachMessage
from app.modules.career_coach.context import build_grounding_context, format_grounding_for_prompt

MAX_HISTORY_MESSAGES = 20
MAX_REPLY_TOKENS = 1500
MAX_FOLLOWUP_TOKENS = 300
TITLE_MAX_LENGTH = 60

SYSTEM_PROMPT_TEMPLATE = (
    "You are the Career Coach inside Zenith, an AI career operating system. You behave like an "
    "experienced career mentor: you educate, explain, recommend, and guide. You never replace the "
    "app's other tools (Resume Review, Job Matching, Interview Preparation, Mock Interview) — you "
    "orchestrate and explain them, pointing the user to the right one and helping them understand "
    "what it already told them.\n\n"
    "Ground every specific claim in the data below. If a figure isn't listed here, say the user "
    "hasn't generated it yet (e.g. \"you haven't run a mock interview yet\") rather than guessing or "
    "inventing a number. You do not have access to live job market search results — only to jobs "
    "the user has already saved or applied to, which is included below if any exist.\n\n"
    "What you know about this user right now:\n{grounding}\n\n"
    "Use Markdown for structure (short paragraphs, lists, **bold** for emphasis). When a concrete "
    "next step exists in the app, mention it by name with a Markdown link using these exact paths: "
    "Resume Studio → /resume, Job Matching → /jobs, Interview Preparation → /interview?mode=prep, "
    "Mock Interview → /interview, Application Tracker → /applications."
)

FOLLOWUP_SYSTEM_PROMPT = (
    "You generate short, clickable follow-up prompts for a career-coaching chat, based on the "
    "assistant's most recent reply. Each suggestion is something the user could click and send "
    "immediately as their next message — a short phrase (2-5 words) like \"Improve Resume\" or "
    "\"Explain ATS Score\", never a full sentence or a question mark. Ground every suggestion in "
    "what was just discussed; do not suggest something unrelated to the reply."
)

FOLLOWUP_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "follow_ups": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-4 short phrases (2-5 words each) the user could click to send as their next message.",
        },
    },
    "required": ["follow_ups"],
}


def _derive_title(user_text: str) -> str:
    text = " ".join(user_text.split())
    return text[:TITLE_MAX_LENGTH] + ("…" if len(text) > TITLE_MAX_LENGTH else "")


def _history_for_claude(db: Session, conversation_id: int) -> list[dict]:
    rows = (
        db.query(CoachMessage)
        .filter(CoachMessage.conversation_id == conversation_id)
        # id as a tiebreaker: SQLite's CURRENT_TIMESTAMP is second-resolution,
        # so a user message and the reply that follows it within the same
        # second would otherwise sort arbitrarily.
        .order_by(CoachMessage.created_at.desc(), CoachMessage.id.desc())
        .limit(MAX_HISTORY_MESSAGES)
        .all()
    )
    rows.reverse()
    return [{"role": row.role, "content": row.content} for row in rows]


def _generate_follow_ups(user_text: str, reply_text: str) -> list[str]:
    if not llm_client.available:
        return []
    try:
        user_prompt = (
            f"The user asked: {user_text[:1000]}\n\n"
            f"The assistant replied: {reply_text[:3000]}\n\n"
            "Suggest 2-4 short follow-up prompts reacting to this reply."
        )
        data = llm_client.complete_tool_json(
            FOLLOWUP_SYSTEM_PROMPT, user_prompt, "submit_follow_ups", FOLLOWUP_TOOL_SCHEMA,
            max_tokens=MAX_FOLLOWUP_TOKENS,
        )
        return [f for f in (data.get("follow_ups") or []) if isinstance(f, str) and f.strip()][:4]
    except Exception:
        return []  # follow-ups are a nicety, never worth failing the turn over


async def stream_reply(
    db: Session, conversation: CoachConversation, user_text: str
) -> AsyncIterator[dict]:
    """Yields {"type": "token", "text": ...} while generating, then exactly
    one of {"type": "followups", "items": [...]} / {"type": "error", "message": ...},
    always followed by {"type": "done"}.

    The user's message is persisted before any Claude call — it survives even
    if generation fails outright. The assistant's message is persisted once,
    after the stream ends, with whatever text was produced (partial output on
    a mid-stream failure is kept rather than discarded, since it's still a
    real, useful answer as far as it got).
    """
    is_first_message = (
        db.query(CoachMessage).filter(CoachMessage.conversation_id == conversation.id).first() is None
    )
    db.add(CoachMessage(conversation_id=conversation.id, role="user", content=user_text))
    if is_first_message and not conversation.title:
        conversation.title = _derive_title(user_text)
    db.commit()

    grounding = format_grounding_for_prompt(build_grounding_context(db, conversation.user_id))
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(grounding=grounding)
    messages = _history_for_claude(db, conversation.id)

    full_text = ""
    error_message: str | None = None
    # Set when the caller closes the generator early (client disconnect) —
    # an async generator may not yield again once GeneratorExit reaches it,
    # so every yield below is skipped in that case; the `raise` re-propagates
    # the closure after the `finally` block has saved whatever was produced.
    disconnecting = False
    try:
        if not llm_client.available:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        async for chunk in llm_client.stream_message(system_prompt, messages, max_tokens=MAX_REPLY_TOKENS):
            full_text += chunk
            yield {"type": "token", "text": chunk}
    except GeneratorExit:
        disconnecting = True
        raise
    except Exception as exc:
        error_message = str(exc) if not llm_client.available else "The Career Coach is temporarily unavailable. Please try again."
    finally:
        follow_ups: list[str] = []
        if full_text.strip():
            # No follow-ups on a disconnect — the client that would have
            # rendered them is already gone, so it's a wasted call.
            follow_ups = [] if disconnecting else _generate_follow_ups(user_text, full_text)
            db.add(
                CoachMessage(
                    conversation_id=conversation.id,
                    role="assistant",
                    content=full_text,
                    follow_ups=json.dumps(follow_ups),
                )
            )
            db.commit()

    if error_message:
        yield {"type": "error", "message": error_message}
    else:
        yield {"type": "followups", "items": follow_ups}
    yield {"type": "done"}
