import json
import random
import re
from pathlib import Path

from app.core.llm import llm_client, parse_json_response

SEED_DIR = Path(__file__).resolve().parents[4] / "data" / "seed_questions"

QUESTION_SYSTEM_PROMPT = (
    "You are an expert technical interviewer across software, data, and product roles. "
    "You generate realistic, role-specific interview questions. "
    "Always respond with a single JSON object and nothing else — no markdown fences, no prose."
)

EVAL_SYSTEM_PROMPT = (
    "You are grading a candidate's interview answer against a fixed rubric: technical accuracy, "
    "communication clarity, and structure (e.g. STAR for behavioral answers). Be specific and "
    "constructive, not generic. "
    "Always respond with a single JSON object and nothing else — no markdown fences, no prose."
)


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
        "roughly half technical and half behavioral. Respond with JSON only, matching exactly:\n"
        '{"questions": [{"type": "technical" | "behavioral", "text": string}]}'
    )
    raw = llm_client.complete_json(QUESTION_SYSTEM_PROMPT, user_prompt)
    data = parse_json_response(raw)
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
        "Score the answer from 0-10 and respond with JSON only, matching exactly:\n"
        '{"score": number, "feedback": string, "improvement_tips": string, "sample_answer": string}'
    )
    raw = llm_client.complete_json(EVAL_SYSTEM_PROMPT, user_prompt)
    data = parse_json_response(raw)
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
