from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.resume import ResumeAnalysis
from app.modules.interview_coach import story_services
from app.modules.interview_coach.reverse_questions import generate_reverse_questions
from app.modules.interview_coach.services import (
    evaluate_answer,
    generate_questions,
    generate_screening_prep,
    model_answer,
)
from app.modules.interview_coach.star_bank import evaluate_star_story
from app.schemas.interview import (
    EvaluationRequestSchema,
    FeedbackSchema,
    InterviewHistoryItemSchema,
    ModelAnswerRequestSchema,
    ModelAnswerSchema,
    QuestionRequestSchema,
    QuestionsResponseSchema,
    ScreeningPrepRequestSchema,
    ScreeningPrepSchema,
)
from app.schemas.story import (
    EvaluateStarRequestSchema,
    ReverseQuestionsRequestSchema,
    ReverseQuestionsResponseSchema,
    StarEvaluationSchema,
    StarStoryCreateSchema,
    StarStoryListSchema,
    StarStorySchema,
    StarStoryUpdateSchema,
)

router = APIRouter()


@router.post("/questions", response_model=QuestionsResponseSchema)
def create_questions(
    req: QuestionRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
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
    current_user: AuthenticatedUser = Depends(get_current_user),
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


@router.post("/model-answer", response_model=ModelAnswerSchema)
def get_model_answer(
    req: ModelAnswerRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    row = (
        db.query(InterviewQuestion, InterviewSession)
        .join(InterviewSession, InterviewQuestion.session_id == InterviewSession.id)
        .filter(InterviewQuestion.id == req.question_id, InterviewSession.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    question, session = row
    return model_answer(question.text, question.question_type, session.role, session.seniority)


@router.get("/history", response_model=list[InterviewHistoryItemSchema])
def history(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)):
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


@router.post("/screening-prep", response_model=ScreeningPrepSchema)
def screening_prep(
    payload: ScreeningPrepRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Screening-call questions with answer templates tailored to the JD.

    When resume_analysis_id is supplied the prep is grounded in that scan's
    stored resume text. Ownership is re-checked here rather than trusted from
    the request: an id alone is not authorisation, and without this filter any
    caller could ground their prep in someone else's resume.
    """
    resume_text = None
    if payload.resume_analysis_id is not None:
        record = (
            db.query(ResumeAnalysis)
            .filter(
                ResumeAnalysis.id == payload.resume_analysis_id,
                ResumeAnalysis.user_id == current_user.id,
            )
            .first()
        )
        if not record:
            raise HTTPException(status_code=404, detail="Analysis not found")
        resume_text = record.resume_text

    return generate_screening_prep(
        payload.job_title, payload.company, payload.jd_text, resume_text
    )


# -- STAR story bank ------------------------------------------------------


@router.get("/stories", response_model=StarStoryListSchema)
def list_stories(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return story_services.list_stories(db, current_user.id)


@router.post("/stories", response_model=StarStorySchema, status_code=201)
def create_story(
    payload: StarStoryCreateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return story_services.create_story(db, current_user.id, payload.model_dump())


@router.patch("/stories/{story_id}", response_model=StarStorySchema)
def update_story(
    story_id: int,
    payload: StarStoryUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    # exclude_unset so an omitted field stays untouched rather than being
    # overwritten with the schema default.
    updated = story_services.update_story(
        db, current_user.id, story_id, payload.model_dump(exclude_unset=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Story not found")
    return updated


@router.delete("/stories/{story_id}", status_code=204)
def delete_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    if not story_services.delete_story(db, current_user.id, story_id):
        raise HTTPException(status_code=404, detail="Story not found")


@router.post("/stories/evaluate", response_model=StarEvaluationSchema)
def evaluate_story(
    payload: EvaluateStarRequestSchema,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Score a draft without saving it. Pure text analysis, no LLM call, so
    the UI can call this on a debounced keystroke for free."""
    return evaluate_star_story(payload.situation, payload.task, payload.action, payload.result)


@router.post("/reverse-questions", response_model=ReverseQuestionsResponseSchema)
def reverse_questions(
    payload: ReverseQuestionsRequestSchema,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Questions for the candidate to ask. Deterministic and free — no LLM."""
    return {
        "questions": generate_reverse_questions(
            payload.job_title, payload.company, payload.jd_text
        )
    }
