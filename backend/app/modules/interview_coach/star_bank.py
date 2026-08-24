"""STAR story evaluation.

Reuses the bullet analyser's verb list and metric patterns rather than
redefining them (app/modules/resume_analyzer/quality.py). Two divergent
definitions of "a strong verb" would let the same sentence pass in a resume
bullet and fail in a STAR story, which is the kind of inconsistency users
notice and can't explain.
"""

import re

from app.modules.resume_analyzer.quality import _METRIC_RE, ACTION_VERBS, WEAK_OPENERS

# Below this a section is a fragment, not an answer. Calibrated to spoken
# delivery: ~20 words of Action is roughly 8 seconds, which is the floor for
# describing what you actually did rather than naming it.
MIN_ACTION_WORDS = 20
MIN_RESULT_WORDS = 10
MIN_SITUATION_WORDS = 10

# Each component is worth an equal share. No base score: a blank story has
# demonstrated nothing, and starting at 40% would tell a candidate their empty
# answer was nearly halfway acceptable.
COMPONENT_WEIGHT = 25.0


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9']+", text or "")


def _verbs_in(text: str) -> list[str]:
    """Strong verbs anywhere in the text, not just the first word.

    Unlike a resume bullet, a STAR Action is several sentences, so the verb
    that matters ("I architected...") is rarely the opening token.
    """
    found = {w.lower() for w in _words(text)} & ACTION_VERBS
    return sorted(found)


def evaluate_star_story(situation: str, task: str, action: str, result: str) -> dict:
    """Score a STAR story 0-100 across its four components.

    Scoring is a checklist, not a judgement of substance: it can tell whether
    the Result cites a figure, not whether the figure is impressive or true.
    """
    situation_words = len(_words(situation))
    task_words = len(_words(task))
    action_words = len(_words(action))
    result_words = len(_words(result))

    strong_verbs = _verbs_in(action)
    weak_openers = sorted({w.lower() for w in _words(action)} & WEAK_OPENERS)
    metrics = [m.group(0).strip() for m in _METRIC_RE.finditer(result or "")]

    has_situation = situation_words >= MIN_SITUATION_WORDS
    has_task = task_words > 0
    # Action needs both length and a real verb: 30 words of "I was involved in
    # the project" describes nothing.
    has_action = action_words >= MIN_ACTION_WORDS and bool(strong_verbs)
    has_result = result_words >= MIN_RESULT_WORDS and bool(metrics)

    score = COMPONENT_WEIGHT * sum([has_situation, has_task, has_action, has_result])

    feedback: list[str] = []
    if not has_situation:
        feedback.append(
            f"Set the scene — the Situation is {situation_words} words; aim for at least "
            f"{MIN_SITUATION_WORDS} so the interviewer knows what was at stake."
        )
    if not has_task:
        feedback.append("Say what you specifically were responsible for, not what the team was.")
    if action_words < MIN_ACTION_WORDS:
        feedback.append(
            f"The Action is {action_words} words. This is the half of the answer interviewers "
            f"score you on — give at least {MIN_ACTION_WORDS}."
        )
    elif not strong_verbs:
        feedback.append(
            "The Action describes involvement rather than decisions. Lead with what you did: "
            "built, designed, migrated, led."
        )
    if weak_openers:
        feedback.append(
            f'The Action leans on passive phrasing ({", ".join(weak_openers)}). Replace it with '
            "the specific thing you did."
        )
    if not metrics:
        feedback.append(
            "The Result has no figure in it. Add the number, percentage, or timeframe — it's what "
            "makes the outcome verifiable."
        )
    elif result_words < MIN_RESULT_WORDS:
        feedback.append("Expand the Result: state the metric and why it mattered.")
    if not feedback:
        feedback.append("Complete STAR structure with a measurable outcome.")

    return {
        "score": round(score, 1),
        "has_situation": has_situation,
        "has_task": has_task,
        "has_action": has_action,
        "has_result": has_result,
        "has_strong_verbs": bool(strong_verbs),
        "has_quantified_result": bool(metrics),
        "strong_verbs": strong_verbs,
        "weak_phrases": weak_openers,
        "metrics": metrics[:5],
        "word_counts": {
            "situation": situation_words,
            "task": task_words,
            "action": action_words,
            "result": result_words,
        },
        "feedback": feedback,
    }
