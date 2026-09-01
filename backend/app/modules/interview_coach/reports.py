"""Final session report generation — the last stage of the Interview Engine.

One Claude call per completed session, not one per answer: every question's
score, strengths, weaknesses, and missing points are handed to the model
together so it can reason about the session as a whole (recurring gaps,
overall trajectory) rather than stitching together per-answer summaries that
were never aware of each other.

Dimension averages, strongest/weakest skills, and the overall score are
computed here in plain Python from the dimension_scores each answer already
stored — never re-derived by asking Claude to do arithmetic, and free to
compute on every read rather than only at generation time.
"""

import json

from sqlalchemy.orm import Session

from app.core.llm import llm_client
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.modules.interview_coach.evaluation import DIMENSION_LABELS
from app.modules.interview_coach.prep import CATEGORY_LABELS
from app.modules.resume_analyzer.rubric import band

REPORT_SYSTEM_PROMPT = (
    "You are an interview coach writing the closing report for a candidate's mock interview "
    "session. You are given every question asked, the candidate's answer, its score, and what "
    "was weak or missing about it. Write a performance summary that references concrete moments "
    "from the transcript rather than generic praise, and give a plain, honest read on their "
    "readiness for real interviews in this role and category. Topics to improve and the practice "
    "plan must be grounded in what this specific session actually showed, not generic interview "
    "advice that would apply to anyone."
)

REPORT_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "performance_summary": {
            "type": "string",
            "description": (
                "2-4 sentences: how the candidate did across the session, referencing specific "
                "answers, plus a plain-language read on their interview readiness."
            ),
        },
        "topics_to_improve": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific concepts or skills to study next, grounded in this session's weakest answers.",
        },
        "practice_plan": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 concrete, ordered next steps the candidate should actually do.",
        },
    },
    "required": ["performance_summary", "topics_to_improve", "practice_plan"],
}


def _dimension_averages(answers: list[InterviewAnswer]) -> dict[str, float]:
    sums = {key: 0.0 for key in DIMENSION_LABELS}
    counts = {key: 0 for key in DIMENSION_LABELS}
    for answer in answers:
        if not answer.dimension_scores:
            continue
        scores = json.loads(answer.dimension_scores)
        for key, value in scores.items():
            if key in sums:
                sums[key] += float(value)
                counts[key] += 1
    return {key: round(sums[key] / counts[key], 1) for key in DIMENSION_LABELS if counts[key]}


def _rank_dimensions(averages: dict[str, float], reverse: bool, limit: int = 3) -> list[str]:
    ordered = sorted(averages.items(), key=lambda kv: kv[1], reverse=reverse)
    return [DIMENSION_LABELS[key] for key, _ in ordered[:limit]]


def _fallback_summary(weakest: list[str]) -> dict:
    """Used only when the LLM is unavailable — an honest placeholder rather
    than a fabricated narrative about a transcript nothing has read."""
    focus = weakest[0] if weakest else "the areas scored lowest below"
    return {
        "performance_summary": (
            "A detailed narrative summary isn't available right now (the AI coach needs an API "
            "connection). Your per-question scores and dimension breakdown below are still exact — "
            f"start by reviewing {focus}."
        ),
        "topics_to_improve": weakest,
        "practice_plan": [
            "Re-read the weaknesses and missing points listed on each answered question.",
            f"Revisit Interview Preparation for this category and focus on {focus}.",
            "Retake this mock interview once you've addressed the gaps above.",
        ],
    }


def _next_actions(session: InterviewSession, weakest: list[str]) -> list[dict]:
    category_label = CATEGORY_LABELS.get(session.category or "", "Interview")
    return [
        {
            "key": "continue_prep",
            "label": "Continue Interview Preparation",
            "description": f"Review {category_label} concepts in depth before your next attempt.",
            "href": "/interview?mode=prep",
            "priority": "high" if weakest else "medium",
        },
        {
            "key": "practice_category",
            "label": f"Practice {category_label} Questions",
            "description": "Take another mock interview in this category to build on today's attempt.",
            "href": f"/interview?category={session.category}",
            "priority": "medium",
        },
        {
            "key": "review_resume",
            "label": "Review Resume",
            "description": "Make sure your resume backs up the strengths this interview showed.",
            "href": "/resume",
            "priority": "low",
        },
        {
            "key": "retry_mock",
            "label": "Practice Mock Interview Again",
            "description": "Take a fresh attempt once you've worked on the gaps above.",
            "href": "/interview",
            "priority": "low",
        },
    ]


def generate_session_report(db: Session, session: InterviewSession) -> None:
    """Populates and commits the session's report columns. Safe to call more
    than once (e.g. a retry after a prior failure) — it always recomputes
    from the answers on file rather than assuming a partial prior write."""
    questions = (
        db.query(InterviewQuestion)
        .filter(InterviewQuestion.session_id == session.id)
        .order_by(InterviewQuestion.sequence_order)
        .all()
    )
    q_ids = [q.id for q in questions]
    if not q_ids:
        return
    answers = db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(q_ids)).all()
    if not answers:
        return

    overall_score = round(sum(a.score for a in answers) / len(answers), 1)
    averages = _dimension_averages(answers)
    strongest = _rank_dimensions(averages, reverse=True)
    weakest = _rank_dimensions(averages, reverse=False)

    by_question = {q.id: q for q in questions}
    data = None
    if llm_client.available:
        transcript = "\n\n".join(
            f"Q{i + 1} ({by_question[a.question_id].question_type}): {by_question[a.question_id].text}\n"
            f"Candidate's answer: {a.answer_text}\n"
            f"Score: {a.score}/10\n"
            f"Weaknesses noted: {'; '.join(json.loads(a.weaknesses or '[]'))}\n"
            f"Missing points noted: {'; '.join(json.loads(a.missing_points or '[]'))}"
            for i, a in enumerate(answers)
        )
        user_prompt = (
            f"Role: {session.role}. Category: {CATEGORY_LABELS.get(session.category or '', session.category)}.\n"
            f"Overall score: {overall_score}/10. Strongest dimensions: {', '.join(strongest) or 'none'}. "
            f"Weakest dimensions: {', '.join(weakest) or 'none'}.\n\n"
            f"Transcript:\n{transcript}"
        )
        try:
            data = llm_client.complete_tool_json(
                REPORT_SYSTEM_PROMPT, user_prompt, "submit_report", REPORT_TOOL_SCHEMA, max_tokens=2000
            )
        except Exception:
            data = None
    if not data:
        data = _fallback_summary(weakest)

    session.overall_score = overall_score
    session.readiness_band = band(overall_score * 10)
    session.performance_summary = data.get("performance_summary", "")
    session.topics_to_improve = json.dumps(data.get("topics_to_improve") or weakest)
    session.practice_plan = json.dumps(data.get("practice_plan") or [])
    db.commit()
    db.refresh(session)


def build_report_payload(db: Session, session: InterviewSession) -> dict:
    """Assembles the full report response. The narrative fields
    (performance_summary/topics_to_improve/practice_plan) are read from the
    cached columns set once by generate_session_report; everything else here
    is cheap and deterministic, so it is recomputed fresh on every read."""
    questions = (
        db.query(InterviewQuestion)
        .filter(InterviewQuestion.session_id == session.id)
        .order_by(InterviewQuestion.sequence_order)
        .all()
    )
    q_ids = [q.id for q in questions]
    answers_by_question = {
        a.question_id: a
        for a in (db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(q_ids)).all() if q_ids else [])
    }

    averages = _dimension_averages(list(answers_by_question.values()))
    strongest = _rank_dimensions(averages, reverse=True)
    weakest = _rank_dimensions(averages, reverse=False)

    question_feedback = []
    for q in questions:
        a = answers_by_question.get(q.id)
        if not a:
            continue
        question_feedback.append(
            {
                "question_id": q.id,
                "question_text": q.text,
                "answer_text": a.answer_text,
                "score": a.score,
                "dimension_scores": json.loads(a.dimension_scores) if a.dimension_scores else {},
                "strengths": json.loads(a.strengths) if a.strengths else [],
                "weaknesses": json.loads(a.weaknesses) if a.weaknesses else [],
                "missing_points": json.loads(a.missing_points) if a.missing_points else [],
                "learning_suggestions": json.loads(a.learning_suggestions) if a.learning_suggestions else [],
                "sample_answer": a.sample_answer,
            }
        )

    return {
        "session_id": session.id,
        "role": session.role,
        "seniority": session.seniority,
        "category": session.category,
        "overall_score": session.overall_score or 0.0,
        "readiness_band": session.readiness_band or band(None),
        "performance_summary": session.performance_summary or "",
        "question_feedback": question_feedback,
        "category_performance": [
            {"key": key, "label": DIMENSION_LABELS[key], "average_score": averages[key]}
            for key in DIMENSION_LABELS
            if key in averages
        ],
        "strongest_skills": strongest,
        "weakest_skills": weakest,
        "topics_to_improve": json.loads(session.topics_to_improve) if session.topics_to_improve else weakest,
        "practice_plan": json.loads(session.practice_plan) if session.practice_plan else [],
        "next_actions": _next_actions(session, weakest),
    }
