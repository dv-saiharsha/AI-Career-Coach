"""The Interview Engine's evaluation pipeline — shared by Mock Interview
today and intended for Voice Interview later (which only needs to transcribe
audio to text and hand it to `evaluate_answer` unchanged).

Scores seven named dimensions rather than one opaque number, and every
strength/weakness/missing point/learning suggestion must explain WHY, not
just state a label — a score alone doesn't teach anyone how to improve.

When the question was sourced from Interview Preparation's cache (see
prep.py), that question's own `ideal_answer`/`concept_explanation` is passed
in as grounding so evaluation is judged against real reference material
instead of the model's unaided judgment — reusing content Prep already paid
to generate rather than asking Claude to invent an ideal answer a second
time.
"""

from app.core.llm import llm_client

DIMENSION_LABELS: dict[str, str] = {
    "technical_accuracy": "Technical Accuracy",
    "completeness": "Completeness",
    "communication": "Communication",
    "structure": "Structure",
    "problem_solving": "Problem Solving",
    "relevance": "Relevance",
    "practical_thinking": "Practical Thinking",
}

EVAL_SYSTEM_PROMPT = (
    "You are an expert interview coach evaluating a candidate's real interview answer across "
    "seven dimensions: technical accuracy, completeness, communication, structure, problem "
    "solving, relevance, and practical thinking. Score each dimension 0-10. "
    "For every strength, weakness, missing point, and learning suggestion you list, you MUST "
    "explain WHY it matters in the same sentence — never state a bare label like 'good "
    "structure' with no reasoning attached. Be specific to what the candidate actually wrote, "
    "not generic advice that could apply to any answer. If reference material is provided, use "
    "it to judge accuracy and completeness, but evaluate the candidate's own reasoning on its "
    "merits rather than penalizing different wording that says the same correct thing."
)

EVALUATION_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "dimension_scores": {
            "type": "object",
            "properties": {key: {"type": "number", "description": "0-10"} for key in DIMENSION_LABELS},
            "required": list(DIMENSION_LABELS),
        },
        "strengths": {
            "type": "array",
            "items": {"type": "string"},
            "description": "What the answer did well. Each entry states the strength AND why it matters.",
        },
        "weaknesses": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Where the answer fell short. Each entry states the gap AND why it hurts the answer.",
        },
        "missing_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Concrete points a strong answer would have included that this one omitted, with why each one matters to an interviewer.",
        },
        "learning_suggestions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific things to study or practice next, with why each would close a gap this answer showed.",
        },
        "improved_answer": {
            "type": "string",
            "description": "A rewritten version of the candidate's own answer that keeps their intent and voice but fixes the gaps found above.",
        },
    },
    "required": [
        "dimension_scores", "strengths", "weaknesses", "missing_points",
        "learning_suggestions", "improved_answer",
    ],
}


def _overall_score(dimension_scores: dict[str, float]) -> float:
    values = [float(dimension_scores.get(key, 0)) for key in DIMENSION_LABELS]
    return round(sum(values) / len(values), 1) if values else 0.0


def _evaluate_with_llm(question_text: str, category: str, answer_text: str, grounding: str | None) -> dict:
    user_prompt = (
        f"Question category: {category}\n"
        f"Question: {question_text}\n\n"
        f"Candidate's answer: {answer_text}\n"
    )
    if grounding:
        user_prompt += f"\nReference material for judging this question (do not reveal verbatim; use it to check accuracy):\n{grounding}\n"

    data = llm_client.complete_tool_json(
        EVAL_SYSTEM_PROMPT, user_prompt, "submit_evaluation", EVALUATION_TOOL_SCHEMA, max_tokens=2000
    )
    dimension_scores = {key: float(data.get("dimension_scores", {}).get(key, 0)) for key in DIMENSION_LABELS}
    return {
        "dimension_scores": dimension_scores,
        "overall_score": _overall_score(dimension_scores),
        "strengths": data.get("strengths", []),
        "weaknesses": data.get("weaknesses", []),
        "missing_points": data.get("missing_points", []),
        "learning_suggestions": data.get("learning_suggestions", []),
        "improved_answer": data.get("improved_answer"),
    }


def _evaluate_with_rules(answer_text: str) -> dict:
    """Used only when the LLM is unavailable — honest about being a rough,
    length-based estimate rather than a real seven-dimension read."""
    word_count = len(answer_text.split())
    base = 7.0 if word_count > 90 else 6.0 if word_count > 40 else 3.0
    dimension_scores = {key: base for key in DIMENSION_LABELS}
    return {
        "dimension_scores": dimension_scores,
        "overall_score": base,
        "strengths": ["The answer has reasonable length to work with."] if word_count > 40 else [],
        "weaknesses": [
            "Automatic scoring is limited without an AI connection, so this is a rough "
            "length-based estimate rather than a real seven-dimension evaluation."
        ],
        "missing_points": [],
        "learning_suggestions": [
            "Expand your answer with a concrete example and quantify the outcome where you can — "
            "this matters because specifics are what let an interviewer trust a claim."
        ],
        "improved_answer": None,
    }


def evaluate_answer(question_text: str, category: str, answer_text: str, grounding: str | None = None) -> dict:
    if llm_client.available:
        try:
            return _evaluate_with_llm(question_text, category, answer_text, grounding)
        except Exception:
            pass  # fall through to rule-based scoring
    return _evaluate_with_rules(answer_text)
