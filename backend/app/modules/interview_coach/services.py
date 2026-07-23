import json
import random
import re
from pathlib import Path

from app.core.llm import llm_client

SEED_DIR = Path(__file__).resolve().parents[4] / "data" / "seed_questions"

QUESTION_SYSTEM_PROMPT = (
    "You are an expert technical interviewer across software, data, and product roles. "
    "You generate realistic, role-specific interview questions."
)

EVAL_SYSTEM_PROMPT = (
    "You are grading a candidate's interview answer against a fixed rubric: technical accuracy, "
    "communication clarity, and structure (e.g. STAR for behavioral answers). Be specific and "
    "constructive, not generic."
)

MODEL_ANSWER_SYSTEM_PROMPT = (
    "You are an expert interview coach. Given an interview question, you produce a model answer "
    "that would impress an interviewer, PLUS a concrete worked example, PLUS a plain-language "
    "explanation a complete beginner could follow. Avoid unexplained jargon — when you must use a "
    "technical term, define it in simple words. The goal is that someone new to the field finishes "
    "reading and both understands the concept and knows how to answer the question well."
)

QUESTIONS_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["technical", "behavioral"]},
                    "text": {"type": "string"},
                },
                "required": ["type", "text"],
            },
        },
    },
    "required": ["questions"],
}

EVALUATION_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "number", "description": "0-10"},
        "feedback": {"type": "string"},
        "improvement_tips": {"type": "string"},
        "sample_answer": {"type": "string"},
    },
    "required": ["score", "feedback", "improvement_tips", "sample_answer"],
}

MODEL_ANSWER_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "ideal_answer": {
            "type": "string",
            "description": "The answer a strong candidate would give — clear, structured, interview-ready.",
        },
        "example": {
            "type": "string",
            "description": "A concrete, specific worked example that illustrates the ideal answer.",
        },
        "plain_explanation": {
            "type": "string",
            "description": "A beginner-friendly explanation of the underlying concept, no unexplained jargon.",
        },
        "key_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 short bullet points an interviewer wants to hear.",
        },
    },
    "required": ["ideal_answer", "example", "plain_explanation", "key_points"],
}


def _slugify(role: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", role.strip().lower()).strip("-")
    return slug or "generic"


def load_seed_questions(role: str) -> list[dict]:
    slug = _slugify(role)
    path = SEED_DIR / f"{slug}.json"
    if not path.exists():
        path = SEED_DIR / "generic.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("questions", [])


def _generate_with_llm(role: str, seniority: str, count: int) -> list[dict]:
    user_prompt = (
        f"Generate {count} interview questions for a {seniority} {role} candidate, "
        "roughly half technical and half behavioral."
    )
    data = llm_client.complete_tool_json(
        QUESTION_SYSTEM_PROMPT, user_prompt, "submit_questions", QUESTIONS_TOOL_SCHEMA
    )
    questions = data.get("questions") or []
    cleaned = [q for q in questions if q.get("text")]
    return cleaned[:count]


def generate_questions(role: str, seniority: str, count: int = 4) -> list[dict]:
    if llm_client.available:
        try:
            questions = _generate_with_llm(role, seniority, count)
            if questions:
                return questions
        except Exception:
            pass  # fall through to seed dataset

    seed = load_seed_questions(role)
    random.shuffle(seed)
    if seed:
        return seed[:count]
    return [{"type": "behavioral", "text": f"Tell me about a challenging project relevant to the {role} role."}]


def _evaluate_with_llm(question_text: str, question_type: str, answer_text: str) -> dict:
    user_prompt = (
        f"Question ({question_type}): {question_text}\n\n"
        f"Candidate answer: {answer_text}\n\n"
        "Score the answer from 0-10."
    )
    data = llm_client.complete_tool_json(EVAL_SYSTEM_PROMPT, user_prompt, "submit_evaluation", EVALUATION_TOOL_SCHEMA)
    data["score"] = float(data.get("score", 0))
    return data


def _evaluate_with_rules(answer_text: str) -> dict:
    word_count = len(answer_text.split())
    if word_count > 90:
        score, tips = 7.0, "Good depth — sharpen the ending with a measurable result."
    elif word_count > 40:
        score, tips = 6.0, "Good length — add a specific example and quantify the outcome."
    else:
        score, tips = 3.0, "Expand your answer with a concrete example, and quantify the result if you can."
    return {
        "score": score,
        "feedback": (
            "Automatic scoring is limited without an LLM connection — this is a rough estimate "
            "based on answer length and structure."
        ),
        "improvement_tips": tips,
        "sample_answer": None,
    }


def evaluate_answer(question_text: str, question_type: str, answer_text: str) -> dict:
    if llm_client.available:
        try:
            return _evaluate_with_llm(question_text, question_type, answer_text)
        except Exception:
            pass  # fall through to rule-based scoring
    return _evaluate_with_rules(answer_text)


def _model_answer_with_llm(question_text: str, question_type: str, role: str, seniority: str) -> dict:
    user_prompt = (
        f"Role: {seniority} {role}\n"
        f"Question ({question_type}): {question_text}\n\n"
        "Give the model answer, a concrete example, a plain-language explanation for a beginner, "
        "and the key points an interviewer wants to hear."
    )
    data = llm_client.complete_tool_json(
        MODEL_ANSWER_SYSTEM_PROMPT, user_prompt, "submit_model_answer", MODEL_ANSWER_TOOL_SCHEMA, max_tokens=2000
    )
    # The model occasionally omits a field despite the schema marking it required;
    # default every field so a partial response is still a valid, useful answer
    # rather than a 500 from response-schema validation.
    data.setdefault("ideal_answer", "")
    data.setdefault("example", "")
    data.setdefault("plain_explanation", "")
    data.setdefault("key_points", [])
    return data


def _model_answer_fallback(question_text: str, question_type: str) -> dict:
    """Used when the LLM is unavailable — honest about being a generic template
    rather than a tailored model answer, so it never pretends to be more than it is."""
    if question_type == "behavioral":
        structure = (
            "Use the STAR structure: describe the Situation, the Task you owned, the Action you took, "
            "and the measurable Result. Keep it to one real story and end on the outcome."
        )
    else:
        structure = (
            "Start with a one-sentence direct answer, then explain the 'why' behind it, then give a "
            "concrete example from real experience, and close with a tradeoff or edge case you'd watch for."
        )
    return {
        "ideal_answer": (
            "A model answer isn't available offline right now (the AI coach needs an API connection). "
            f"General guidance for this {question_type} question: {structure}"
        ),
        "example": (
            "Example shape: \"When I faced X, I decided to do Y because Z, which led to a measurable "
            "result of W.\" Replace X/Y/Z/W with a real situation from your own experience."
        ),
        "plain_explanation": (
            "Interviewers aren't just checking whether you know the answer — they're checking whether "
            "you can explain your thinking clearly and back it with a real example. Structure and a "
            "concrete story matter as much as being technically correct."
        ),
        "key_points": [
            "Answer the question directly first",
            "Explain your reasoning",
            "Give one concrete, real example",
            "Mention a tradeoff or what you'd watch out for",
        ],
    }


def model_answer(question_text: str, question_type: str, role: str, seniority: str) -> dict:
    if llm_client.available:
        try:
            return _model_answer_with_llm(question_text, question_type, role, seniority)
        except Exception:
            pass  # fall through to the generic template
    return _model_answer_fallback(question_text, question_type)
