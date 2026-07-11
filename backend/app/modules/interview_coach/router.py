from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.user import User
from app.modules.interview_coach.services import evaluate_answer, generate_questions
from app.schemas.interview import (
    EvaluationRequestSchema,
    FeedbackSchema,
    InterviewHistoryItemSchema,
    QuestionRequestSchema,
    QuestionsResponseSchema,
)

router = APIRouter()


@router.post("/questions", response_model=QuestionsResponseSchema)
def create_questions(
    req: QuestionRequestSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw_questions = generate_questions(req.role, req.seniority)

    session = InterviewSession(user_id=current_user.id, role=req.role, seniority=req.seniority)
    db.add(session)
    db.flush()

    saved: list[InterviewQuestion] = []
    for q in raw_questions:
        row = InterviewQuestion(
            session_id=session.id,
            question_type=q.get("type", "technical"),
            text=q["text"],
        )
        db.add(row)
        db.flush()
        saved.append(row)
    db.commit()

    return {
        "session_id": session.id,
        "questions": [{"id": q.id, "text": q.text, "type": q.question_type} for q in saved],
    }


@router.post("/evaluate", response_model=FeedbackSchema)
def evaluate(
    req: EvaluationRequestSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    question = (
        db.query(InterviewQuestion)
        .join(InterviewSession, InterviewQuestion.session_id == InterviewSession.id)
        .filter(InterviewQuestion.id == req.question_id, InterviewSession.user_id == current_user.id)
        .first()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    result = evaluate_answer(question.text, question.question_type, req.answer_text)

    answer = InterviewAnswer(
        question_id=question.id,
        answer_text=req.answer_text,
        score=result["score"],
        feedback=result["feedback"],
        improvement_tips=result["improvement_tips"],
        sample_answer=result.get("sample_answer"),
    )
    db.add(answer)
    db.commit()

    return result


@router.get("/history", response_model=list[InterviewHistoryItemSchema])
def history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sessions = (
        db.query(InterviewSession)
        .filter(InterviewSession.user_id == current_user.id)
        .order_by(InterviewSession.created_at.desc())
        .all()
    )

    out = []
    for s in sessions:
        questions = db.query(InterviewQuestion).filter(InterviewQuestion.session_id == s.id).all()
        q_ids = [q.id for q in questions]
        answers = (
            db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(q_ids)).all() if q_ids else []
        )
        avg = round(sum(a.score for a in answers) / len(answers), 1) if answers else None
        out.append(
            {
                "id": s.id,
                "role": s.role,
                "seniority": s.seniority,
                "created_at": s.created_at.isoformat(),
                "average_score": avg,
                "answered_count": len(answers),
                "question_count": len(questions),
            }
        )
    return out
