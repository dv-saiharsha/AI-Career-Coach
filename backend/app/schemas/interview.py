from typing import Dict, List, Optional

from pydantic import BaseModel

from app.schemas.interview_prep import PrepCategory
from app.schemas.resume_review import NextActionSchema


class QuestionRequestSchema(BaseModel):
    role: str
    seniority: str
    # Sources questions from the same shared Interview Preparation cache
    # used by the "Learn concepts" tab (see interview_coach/prep.py) — a
    # mock interview session is scored practice over content Prep already
    # generated, not a second question-generation path.
    category: PrepCategory


class InterviewQuestionSchema(BaseModel):
    id: int
    text: str
    type: str
    sequence_order: int = 0


class QuestionsResponseSchema(BaseModel):
    session_id: int
    role: str
    seniority: str
    category: PrepCategory
    questions: List[InterviewQuestionSchema]


class VoiceMetricsSchema(BaseModel):
    """Every field independently optional: interview_coach/voice.py omits
    whichever of these it couldn't derive reliably from Deepgram's response,
    rather than fabricating a value. Absent everywhere for a typed answer."""

    speaking_duration_seconds: Optional[float] = None
    average_confidence: Optional[float] = None
    speaking_rate_wpm: Optional[float] = None
    long_pause_count: Optional[int] = None
    filler_word_count: Optional[int] = None


class EvaluationRequestSchema(BaseModel):
    question_id: int
    answer_text: str
    # Present only when answer_text came from an accepted voice transcript.
    # Purely informational — never read by evaluate_answer's scoring.
    voice_metrics: Optional[VoiceMetricsSchema] = None


# 0-10 per dimension. Kept as a plain dict (not a nested model) so the UI can
# iterate it generically alongside DIMENSION_LABELS without a schema change
# every time a dimension is renamed.
class FeedbackSchema(BaseModel):
    score: float
    dimension_scores: Dict[str, float] = {}
    strengths: List[str] = []
    weaknesses: List[str] = []
    missing_points: List[str] = []
    learning_suggestions: List[str] = []
    # The rewritten, improved version of the candidate's own answer — kept
    # under the same field name evaluate_answer has always used.
    sample_answer: Optional[str] = None
    voice_metrics: Optional[VoiceMetricsSchema] = None


class TranscribeResponseSchema(BaseModel):
    transcript: str
    voice_metrics: VoiceMetricsSchema


class ModelAnswerRequestSchema(BaseModel):
    question_id: int


class ModelAnswerSchema(BaseModel):
    ideal_answer: str
    example: str
    plain_explanation: str
    key_points: List[str] = []


class ScreeningPrepRequestSchema(BaseModel):
    job_title: str
    company: str = ""
    jd_text: str = ""
    # When set, the prep is grounded in that scan's stored resume text so the
    # placeholders name the candidate's real projects. Ownership is checked in
    # the router — an id alone is not authorisation.
    resume_analysis_id: Optional[int] = None


class ScreeningQuestionSchema(BaseModel):
    id: str
    type: str
    question: str
    # Named a template, not an "ideal answer": it is a scaffold with bracketed
    # placeholders the candidate fills from their own history. Presenting a
    # generated paragraph as a verbatim script would be coaching them to claim
    # achievements that aren't theirs.
    answer_template: str
    key_signal: str = ""
    what_to_avoid: str = ""


class InterviewTipSchema(BaseModel):
    title: str
    rule: str


class ScreeningPrepSchema(BaseModel):
    job_title: str
    company: str
    screening_questions: List[ScreeningQuestionSchema]
    general_interview_tips: List[InterviewTipSchema]


class InterviewHistoryItemSchema(BaseModel):
    id: int
    role: str
    seniority: str
    category: Optional[PrepCategory] = None
    status: str
    created_at: str
    average_score: Optional[float]
    answered_count: int
    question_count: int


# -- Mock Interview session lifecycle --------------------------------------


class ActiveAnswerSchema(FeedbackSchema):
    answer_text: str


class ActiveQuestionSchema(InterviewQuestionSchema):
    answer: Optional[ActiveAnswerSchema] = None


class ActiveSessionSchema(BaseModel):
    session_id: int
    role: str
    seniority: str
    category: PrepCategory
    status: str
    questions: List[ActiveQuestionSchema]


class QuestionFeedbackSchema(FeedbackSchema):
    question_id: int
    question_text: str
    answer_text: str


class CategoryPerformanceSchema(BaseModel):
    """One of the seven evaluation dimensions, averaged across every
    answered question in the session — not the interview's Prep category
    (a session only ever has one of those). Deterministic: computed from the
    dimension_scores already stored on each answer, never re-asked of Claude."""

    key: str
    label: str
    average_score: float


class SessionReportSchema(BaseModel):
    session_id: int
    role: str
    seniority: str
    category: PrepCategory
    overall_score: float
    readiness_band: str
    performance_summary: str
    question_feedback: List[QuestionFeedbackSchema]
    category_performance: List[CategoryPerformanceSchema]
    strongest_skills: List[str]
    weakest_skills: List[str]
    topics_to_improve: List[str]
    practice_plan: List[str]
    next_actions: List[NextActionSchema]
