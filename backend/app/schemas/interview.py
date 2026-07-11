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


class InterviewHistoryItemSchema(BaseModel):
    id: int
    role: str
    seniority: str
    created_at: str
    average_score: Optional[float]
    answered_count: int
    question_count: int
