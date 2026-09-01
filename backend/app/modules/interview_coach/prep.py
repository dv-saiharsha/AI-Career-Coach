"""AI Interview Preparation — a teaching module, not a test.

Reuses the module's existing LLM plumbing (core/llm.py's shared ClaudeClient,
the same complete_tool_json pattern already proven by generate_questions and
generate_screening_prep) to generate rich, explained content instead of a
bare question. Nothing here hides an answer behind an attempt — every field
is returned the moment a question is fetched, because understanding, not
scoring, is the point.

Cache design mirrors job_market's shared-listings cache (same reasoning:
content doesn't depend on who's asking), with one addition the job feed
doesn't need — PROMPT_VERSION and the configured model name are part of the
cache key, so a future prompt or model change mints new rows under a new key
rather than either invalidating everything or silently mixing old and new
content under one key. Unlike job listings, there is no TTL: an explanation
of a concept doesn't go stale the way a job posting does.
"""

import json

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.llm import llm_client
from app.models.interview_prep import PrepQuestion, PrepQuestionUserState
from app.modules.job_market.services import normalise_query

# Bump this when PREP_SYSTEM_PROMPT or PREP_QUESTION_TOOL_SCHEMA changes in a
# way that should produce different content — old rows stay cached under
# their own version rather than being silently served as if regenerated.
PROMPT_VERSION = "v1"

CATEGORY_LABELS = {
    "hr": "HR",
    "technical": "Technical",
    "behavioral": "Behavioral",
    "screening": "Screening",
    "scenario": "Scenario",
}

CATEGORY_FRAMING = {
    "hr": "HR and culture-fit questions — about motivation, work style, and fit, not technical depth.",
    "technical": "Technical questions that test hands-on knowledge and problem-solving in the role's domain.",
    "behavioral": "Behavioral questions about past experience, best answered with a structured story (e.g. STAR).",
    # Deliberately distinct from the separate /screening-prep feature, which
    # is tailored to one specific job description. These are general
    # recruiter-call-style questions for the role, not JD-grounded.
    "screening": "General recruiter-screen-style questions — early-stage, broad, filtering for basic fit.",
    "scenario": "Scenario / situational questions that pose a hypothetical problem and ask how the candidate would handle it.",
}

PREP_SYSTEM_PROMPT = (
    "You are an interview coach teaching a candidate to genuinely understand interview concepts — "
    "you are not conducting an interview and you are not grading anyone. For every question, explain "
    "it the way a great mentor would: what it's really asking, why it's asked, what a strong answer "
    "looks like, and how to actually get better at it. Assume the reader may be encountering the "
    "underlying concept for the first time. Never assume prior context; every field must stand on its "
    "own without unexplained jargon."
)

PREP_QUESTION_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "text": {"type": "string"},
                    "estimated_answer_time": {
                        "type": "string",
                        "description": "A short human estimate, e.g. '2-3 minutes'.",
                    },
                    "ideal_answer": {"type": "string"},
                    "concept_explanation": {
                        "type": "string",
                        "description": "A thorough explanation of the underlying concept.",
                    },
                    "beginner_explanation": {
                        "type": "string",
                        "description": "The same concept explained as simply as possible, no jargon.",
                    },
                    "real_world_example": {"type": "string"},
                    "interviewer_intent": {
                        "type": "string",
                        "description": "Plainly stated: what is the interviewer actually testing with this question.",
                    },
                    "interview_tips": {"type": "array", "items": {"type": "string"}},
                    "common_mistakes": {"type": "array", "items": {"type": "string"}},
                    "important_keywords": {"type": "array", "items": {"type": "string"}},
                    "follow_up_questions": {"type": "array", "items": {"type": "string"}},
                },
                "required": [
                    "difficulty", "text", "estimated_answer_time", "ideal_answer",
                    "concept_explanation", "beginner_explanation", "real_world_example",
                    "interviewer_intent", "interview_tips", "common_mistakes",
                    "important_keywords", "follow_up_questions",
                ],
            },
        },
    },
    "required": ["questions"],
}

# Two per difficulty tier per call — one Claude call populates all three
# difficulties for a (role, category) pair at once, rather than three
# separate calls. See get_prep_questions: a cache miss on any one difficulty
# regenerates all three together for exactly this reason.
QUESTIONS_PER_DIFFICULTY = 2


def build_cache_key(role: str, category: str, difficulty: str) -> str:
    """Role + category + difficulty + prompt/model version, collapsed to one
    stable string. Role reuses job_market's normalisation rather than a
    second implementation of the same idea — "Backend Engineer" and "backend
    eng" should hit the same cache entry here for the same reason they
    already do in the job feed."""
    normalised_role = normalise_query(role) or "general"
    return f"{normalised_role}|{category}|{difficulty}|{PROMPT_VERSION}|{settings.ANTHROPIC_MODEL}"


def _generate_batch(db: Session, role: str, category: str) -> list[PrepQuestion]:
    """One Claude call, all three difficulties, three cache rows written.
    Falls back to nothing (raises) rather than a fabricated question — a
    teaching tool with a wrong or generic answer is worse than an empty
    state the UI can explain and let the user retry."""
    user_prompt = (
        f"Generate interview preparation content for the role \"{role}\".\n"
        f"Category: {CATEGORY_LABELS[category]}. {CATEGORY_FRAMING[category]}\n"
        f"Produce exactly {QUESTIONS_PER_DIFFICULTY} questions for EACH difficulty "
        f"(easy, medium, hard) — {QUESTIONS_PER_DIFFICULTY * 3} questions total."
    )
    result = llm_client.complete_tool_json(
        PREP_SYSTEM_PROMPT, user_prompt, "prep_questions", PREP_QUESTION_TOOL_SCHEMA, max_tokens=4000
    )

    model_version = settings.ANTHROPIC_MODEL
    rows: list[PrepQuestion] = []
    for q in result.get("questions", []):
        difficulty = q.get("difficulty")
        if difficulty not in ("easy", "medium", "hard"):
            continue
        row = PrepQuestion(
            cache_key=build_cache_key(role, category, difficulty),
            role=role,
            category=category,
            difficulty=difficulty,
            prompt_version=PROMPT_VERSION,
            model_version=model_version,
            text=q["text"],
            estimated_answer_time=q.get("estimated_answer_time", ""),
            ideal_answer=q.get("ideal_answer", ""),
            concept_explanation=q.get("concept_explanation", ""),
            beginner_explanation=q.get("beginner_explanation", ""),
            real_world_example=q.get("real_world_example", ""),
            interviewer_intent=q.get("interviewer_intent", ""),
            interview_tips=json.dumps(q.get("interview_tips", [])),
            common_mistakes=json.dumps(q.get("common_mistakes", [])),
            important_keywords=json.dumps(q.get("important_keywords", [])),
            follow_up_questions=json.dumps(q.get("follow_up_questions", [])),
        )
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def get_prep_questions(db: Session, role: str, category: str) -> list[PrepQuestion]:
    """Cache-first across all three difficulties for one (role, category).

    Checked as a full triplet rather than per-difficulty: if any of the
    three is missing (a partial prior failure, or genuinely new), all three
    are regenerated together. Simpler than a partial-fill path, and the cost
    difference between generating one difficulty and three in the same call
    is negligible — this is a deliberate simplicity-over-micro-optimisation
    choice, not an oversight.
    """
    keys = [build_cache_key(role, category, d) for d in ("easy", "medium", "hard")]
    cached = db.query(PrepQuestion).filter(PrepQuestion.cache_key.in_(keys)).all()
    if len(cached) >= len(keys):
        return cached
    return _generate_batch(db, role, category)


def attach_user_state(db: Session, user_id: str, questions: list[PrepQuestion]) -> list[dict]:
    """Every question gets its bookmark/completed/notes state inline, the
    same "shared cache row + per-user overlay" shape job_market.matching
    already established for match scores — one lookup, not N."""
    ids = [q.id for q in questions]
    states = {
        s.prep_question_id: s
        for s in db.query(PrepQuestionUserState).filter(
            PrepQuestionUserState.user_id == user_id,
            PrepQuestionUserState.prep_question_id.in_(ids),
        )
    }

    def serialize(q: PrepQuestion) -> dict:
        state = states.get(q.id)
        return {
            "id": q.id,
            "category": q.category,
            "difficulty": q.difficulty,
            "text": q.text,
            "estimated_answer_time": q.estimated_answer_time,
            "ideal_answer": q.ideal_answer,
            "concept_explanation": q.concept_explanation,
            "beginner_explanation": q.beginner_explanation,
            "real_world_example": q.real_world_example,
            "interviewer_intent": q.interviewer_intent,
            "interview_tips": json.loads(q.interview_tips or "[]"),
            "common_mistakes": json.loads(q.common_mistakes or "[]"),
            "important_keywords": json.loads(q.important_keywords or "[]"),
            "follow_up_questions": json.loads(q.follow_up_questions or "[]"),
            "user_state": {
                "bookmarked": state.bookmarked if state else False,
                "completed": state.completed if state else False,
                "notes": state.notes if state else None,
            },
        }

    return [serialize(q) for q in questions]


def dashboard_progress(db: Session, user_id: str) -> dict:
    """Prep progress for the Career Dashboard. A raw count, not a percentage
    — there is no fixed denominator ("out of how many, across every role a
    user could ever explore" is unbounded), so a completion percentage would
    have to invent one."""
    completed_count = (
        db.query(PrepQuestionUserState)
        .filter(PrepQuestionUserState.user_id == user_id, PrepQuestionUserState.completed.is_(True))
        .count()
    )
    bookmarked_count = (
        db.query(PrepQuestionUserState)
        .filter(PrepQuestionUserState.user_id == user_id, PrepQuestionUserState.bookmarked.is_(True))
        .count()
    )
    return {"completed_count": completed_count, "bookmarked_count": bookmarked_count}


def upsert_user_state(db: Session, user_id: str, prep_question_id: int, payload: dict) -> PrepQuestionUserState | None:
    """`payload` is already exclude_unset — an omitted field is left alone,
    not reset to a default. Returns None when the question itself doesn't
    exist, so the router can 404 rather than silently create orphaned state."""
    question = db.query(PrepQuestion).filter(PrepQuestion.id == prep_question_id).first()
    if not question:
        return None

    state = (
        db.query(PrepQuestionUserState)
        .filter(
            PrepQuestionUserState.user_id == user_id,
            PrepQuestionUserState.prep_question_id == prep_question_id,
        )
        .first()
    )
    if not state:
        state = PrepQuestionUserState(user_id=user_id, prep_question_id=prep_question_id)
        db.add(state)

    for field, value in payload.items():
        setattr(state, field, value)
    db.commit()
    db.refresh(state)
    return state
