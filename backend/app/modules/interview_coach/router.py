import json

from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.ratelimit import RateLimit
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.interview_prep import PrepQuestion
from app.models.resume import ResumeAnalysis
from app.modules.interview_coach import engine, prep, reports, story_services, voice
from app.modules.interview_coach.evaluation import evaluate_answer
from app.modules.interview_coach.reverse_questions import generate_reverse_questions
from app.modules.interview_coach.services import generate_screening_prep, model_answer
from app.modules.interview_coach.star_bank import evaluate_star_story
from app.schemas.interview import (
    ActiveSessionSchema,
    EvaluationRequestSchema,
    FeedbackSchema,
    InterviewHistoryItemSchema,
    ModelAnswerRequestSchema,
    ModelAnswerSchema,
    QuestionRequestSchema,
    QuestionsResponseSchema,
    ScreeningPrepRequestSchema,
    ScreeningPrepSchema,
    SessionReportSchema,
    TranscribeResponseSchema,
)
from app.schemas.interview_prep import (
    PrepCategory,
    PrepQuestionsResponseSchema,
    PrepQuestionStateUpdateSchema,
    PrepQuestionUserStateSchema,
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

HOUR = 3600

router = APIRouter()

# /evaluate calls Claude, /transcribe calls Deepgram — both real per-call
# cost with no other ceiling on them (a scored question set is naturally
# small per session, but nothing stops a scripted account from calling
# either directly, repeatedly). Generous enough for several full practice
# sessions in a sitting.
MAX_EVALUATIONS_PER_WINDOW = 100
MAX_TRANSCRIPTIONS_PER_WINDOW = 100
INTERVIEW_RATE_WINDOW_SECONDS = 3600

# Read fully into memory before sending to Deepgram — bounded for the same
# reason resume_analyzer's upload cap is: no size floor on the request
# otherwise, and a voice answer has no legitimate reason to be this large.
MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024


@router.post("/questions", response_model=QuestionsResponseSchema)
def create_questions(
    req: QuestionRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_questions", 20, HOUR, "Too many question sets requested. Try again in a while.")),
):
    """Starts a new Mock Interview session, sourcing its questions from the
    same shared Interview Preparation cache the "Learn concepts" tab uses —
    see engine.start_session. Any session this user still had in progress is
    abandoned; its answers stay in history, just no longer resumable."""
    try:
        session = engine.start_session(db, current_user.id, req.role, req.seniority, req.category)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    questions = engine.session_questions(db, session.id)
    return {
        "session_id": session.id,
        "role": session.role,
        "seniority": session.seniority,
        "category": session.category,
        "questions": [
            {"id": q.id, "text": q.text, "type": q.question_type, "sequence_order": q.sequence_order}
            for q in questions
        ],
    }


@router.get("/sessions/active", response_model=ActiveSessionSchema | None)
def get_active_session(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(get_current_user)):
    """Powers both "detect a resumable session" and the Resume Interview
    action itself — resuming is just re-fetching this, since every answer
    was already persisted the moment it was submitted."""
    session = engine.get_active_session(db, current_user.id)
    if not session:
        return None
    return _serialize_active_session(db, session)


@router.post("/sessions/{session_id}/abandon", status_code=204)
def abandon_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Powers Restart Interview: mark the current attempt abandoned, then
    the client calls POST /questions again for a fresh one. Idempotent — a
    session that is already completed or abandoned is left as-is rather
    than erroring, so a stale client retry can't fail."""
    if engine.get_owned_session(db, current_user.id, session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    engine.abandon_session(db, current_user.id, session_id)  # no-op if already completed/abandoned


@router.get("/sessions/{session_id}/report", response_model=SessionReportSchema)
def get_session_report(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_report", 20, HOUR, "Too many reports requested. Try again in a while.")),
):
    session = engine.get_owned_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "completed":
        raise HTTPException(status_code=400, detail="This interview session is still in progress.")
    if session.performance_summary is None:
        # Report generation was attempted at session-completion time; retry
        # here covers the rare case where that first attempt failed.
        reports.generate_session_report(db, session)
    return reports.build_report_payload(db, session)


def _serialize_active_session(db: Session, session: InterviewSession) -> dict:
    questions = engine.session_questions(db, session.id)
    q_ids = [q.id for q in questions]
    answers = {
        a.question_id: a
        for a in (db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(q_ids)).all() if q_ids else [])
    }

    def serialize_question(q: InterviewQuestion) -> dict:
        payload = {"id": q.id, "text": q.text, "type": q.question_type, "sequence_order": q.sequence_order, "answer": None}
        a = answers.get(q.id)
        if a:
            payload["answer"] = {
                "answer_text": a.answer_text,
                "score": a.score,
                "dimension_scores": json.loads(a.dimension_scores) if a.dimension_scores else {},
                "strengths": json.loads(a.strengths) if a.strengths else [],
                "weaknesses": json.loads(a.weaknesses) if a.weaknesses else [],
                "missing_points": json.loads(a.missing_points) if a.missing_points else [],
                "learning_suggestions": json.loads(a.learning_suggestions) if a.learning_suggestions else [],
                "sample_answer": a.sample_answer,
                "voice_metrics": json.loads(a.voice_metrics) if a.voice_metrics else None,
            }
        return payload

    return {
        "session_id": session.id,
        "role": session.role,
        "seniority": session.seniority,
        "category": session.category,
        "status": session.status,
        "questions": [serialize_question(q) for q in questions],
    }


# FastAPI runs a `def` handler in a threadpool and an `async def` handler on
# the event loop itself. The handlers below are async only because they need
# `await upload.read()`, and the work after that is synchronous and slow —
# the blocking Anthropic client, PDF text extraction, the scikit-learn model.
# Left on the loop, one scan stops every other request on the worker for its
# whole duration; run_in_threadpool puts it exactly where FastAPI would have
# put it had the handler been `def`. See tests/test_event_loop_blocking.py.
@router.post("/transcribe", response_model=TranscribeResponseSchema)
async def transcribe_answer(
    audio: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_transcribe", MAX_TRANSCRIPTIONS_PER_WINDOW, INTERVIEW_RATE_WINDOW_SECONDS, "Too many transcription requests. Try again in a while.")),
):
    """Voice Interview's one new endpoint. Pure transformation — audio in,
    transcript + voice_metrics out — and touches no session/question/answer
    row. The audio bytes exist only for the duration of this request: they
    are read into memory, sent to Deepgram, and discarded when this handler
    returns. Nothing is written to disk or the database.

    The returned transcript is not itself an answer. It becomes one only if
    the user accepts it (or their edited version of it) and submits it
    through the existing /evaluate below, exactly like a typed answer.
    """
    content = await audio.read()
    if len(content) > MAX_AUDIO_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too large.")
    try:
        result = await run_in_threadpool(
            voice.transcribe, content, audio.content_type or "application/octet-stream"
        )
    except voice.TranscriptionError as exc:
        status = 503 if "not configured" in str(exc) or "unavailable" in str(exc) else 422
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return result


@router.post("/evaluate", response_model=FeedbackSchema)
def evaluate(
    req: EvaluationRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_evaluate", MAX_EVALUATIONS_PER_WINDOW, INTERVIEW_RATE_WINDOW_SECONDS, "Too many answers submitted. Try again in a while.")),
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

    grounding = None
    if question.prep_question_id:
        prep_question = db.query(PrepQuestion).filter(PrepQuestion.id == question.prep_question_id).first()
        if prep_question:
            grounding = f"Ideal answer: {prep_question.ideal_answer}\nConcept: {prep_question.concept_explanation}"

    # voice_metrics never reaches evaluate_answer — scoring is identical
    # regardless of how the answer text was produced.
    result = evaluate_answer(question.text, question.question_type, req.answer_text, grounding)

    voice_metrics = req.voice_metrics.model_dump(exclude_none=True) if req.voice_metrics else None
    answer = InterviewAnswer(
        question_id=question.id,
        answer_text=req.answer_text,
        score=result["overall_score"],
        dimension_scores=json.dumps(result["dimension_scores"]),
        strengths=json.dumps(result["strengths"]),
        weaknesses=json.dumps(result["weaknesses"]),
        missing_points=json.dumps(result["missing_points"]),
        learning_suggestions=json.dumps(result["learning_suggestions"]),
        sample_answer=result.get("improved_answer"),
        voice_metrics=json.dumps(voice_metrics) if voice_metrics else None,
    )
    db.add(answer)
    db.commit()

    if session.category:
        engine.maybe_complete_session(db, session)

    return {
        "score": result["overall_score"],
        "dimension_scores": result["dimension_scores"],
        "strengths": result["strengths"],
        "weaknesses": result["weaknesses"],
        "missing_points": result["missing_points"],
        "learning_suggestions": result["learning_suggestions"],
        "sample_answer": result.get("improved_answer"),
        "voice_metrics": voice_metrics,
    }


@router.post("/model-answer", response_model=ModelAnswerSchema)
def get_model_answer(
    req: ModelAnswerRequestSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_model_answer", 30, HOUR, "Too many model answers requested. Try again in a while.")),
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

    # Reuse Interview Prep's already-generated content instead of a second
    # LLM call whenever this question was sourced from that cache.
    if question.prep_question_id:
        prep_question = db.query(PrepQuestion).filter(PrepQuestion.id == question.prep_question_id).first()
        if prep_question:
            return {
                "ideal_answer": prep_question.ideal_answer,
                "example": prep_question.real_world_example,
                "plain_explanation": prep_question.beginner_explanation,
                "key_points": json.loads(prep_question.interview_tips or "[]"),
            }

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
        # Sessions created before this milestone have no category and never
        # got a real status written — display their status from what
        # actually happened rather than the column's generic default.
        status = s.status
        if s.category is None:
            status = "completed" if questions and len(answers) >= len(questions) else "abandoned"
        out.append(
            {
                "id": s.id,
                "role": s.role,
                "seniority": s.seniority,
                "category": s.category,
                "status": status,
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
    _limit: None = Depends(RateLimit("interview_screening_prep", 15, HOUR, "Too many screening preps. Try again in a while.")),
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


# -- Interview Preparation (teaching, not testing) ------------------------


@router.get("/prep/questions", response_model=PrepQuestionsResponseSchema)
def get_prep_questions(
    role: str,
    category: PrepCategory,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    _limit: None = Depends(RateLimit("interview_prep", 30, HOUR, "Too many prep requests. Try again in a while.")),
):
    """Cache-first across all three difficulties for this role + category —
    generated once for everyone, not per user. Every field is returned
    immediately; nothing is gated behind an attempt, because this teaches
    rather than tests.

    Unlike question generation elsewhere in this module, there is no
    offline/seed fallback here: a fabricated "concept explanation" or
    "common mistakes" list would actively mislead someone using this to
    learn, which is a worse failure mode than a clear "try again" state.
    """
    try:
        questions = prep.get_prep_questions(db, role, category)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    serialized = prep.attach_user_state(db, current_user.id, questions)
    return {"role": role, "category": category, "questions": serialized}


@router.patch("/prep/questions/{prep_question_id}/state", response_model=PrepQuestionUserStateSchema)
def update_prep_question_state(
    prep_question_id: int,
    payload: PrepQuestionStateUpdateSchema,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Bookmark / completed / notes — the one part of Interview Prep that is
    genuinely user-specific, kept in its own table rather than the shared
    question cache."""
    state = prep.upsert_user_state(
        db, current_user.id, prep_question_id, payload.model_dump(exclude_unset=True)
    )
    if state is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"bookmarked": state.bookmarked, "completed": state.completed, "notes": state.notes}
