from typing import List, Optional

from pydantic import BaseModel


class QuestionRequestSchema(BaseModel):
    role: str
    seniority: str


class InterviewQuestionSchema(BaseModel):
    id: int
    text: str
    type: str


class QuestionsResponseSchema(BaseModel):
    session_id: int
    questions: List[InterviewQuestionSchema]


class EvaluationRequestSchema(BaseModel):
    question_id: int
    answer_text: str


class FeedbackSchema(BaseModel):
    score: float
    feedback: str
    improvement_tips: str
    sample_answer: Optional[str] = None


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
    created_at: str
    average_score: Optional[float]
    answered_count: int
    question_count: int
