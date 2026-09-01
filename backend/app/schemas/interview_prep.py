from typing import List, Literal, Optional

from pydantic import BaseModel

PrepCategory = Literal["hr", "technical", "behavioral", "screening", "scenario"]
PrepDifficulty = Literal["easy", "medium", "hard"]


class PrepQuestionsRequestSchema(BaseModel):
    role: str
    category: PrepCategory


class PrepQuestionUserStateSchema(BaseModel):
    bookmarked: bool = False
    completed: bool = False
    notes: Optional[str] = None


class PrepQuestionSchema(BaseModel):
    id: int
    category: PrepCategory
    difficulty: PrepDifficulty
    text: str
    estimated_answer_time: str
    ideal_answer: str
    concept_explanation: str
    beginner_explanation: str
    real_world_example: str
    #: What the interviewer is actually testing with this question — stated
    #: outright rather than left for the user to infer.
    interviewer_intent: str
    interview_tips: List[str]
    common_mistakes: List[str]
    important_keywords: List[str]
    follow_up_questions: List[str]
    #: None only when the caller isn't authenticated against this row yet —
    #: in practice always present, since every question is returned with the
    #: current user's state attached.
    user_state: Optional[PrepQuestionUserStateSchema] = None


class PrepQuestionsResponseSchema(BaseModel):
    role: str
    category: PrepCategory
    questions: List[PrepQuestionSchema]


class PrepQuestionStateUpdateSchema(BaseModel):
    """All optional and applied with exclude_unset — updating just `notes`
    must not silently reset `bookmarked`/`completed` to their defaults."""

    bookmarked: Optional[bool] = None
    completed: Optional[bool] = None
    notes: Optional[str] = None
