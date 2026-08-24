from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class StarStoryCreateSchema(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    # Every component defaults to empty so a story can be saved half-written
    # and finished later — requiring all four would make the bank useless for
    # drafting, which is when people actually use it.
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    tags: Optional[str] = None


class StarStoryUpdateSchema(BaseModel):
    """Partial. Omitted keys are left untouched."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    situation: Optional[str] = None
    task: Optional[str] = None
    action: Optional[str] = None
    result: Optional[str] = None
    tags: Optional[str] = None


class StarEvaluationSchema(BaseModel):
    """0-100 across the four components, 25 each.

    No base score: a blank story scores 0. Starting at 40 would tell a
    candidate an empty answer was nearly halfway acceptable.
    """

    score: float
    has_situation: bool
    has_task: bool
    has_action: bool
    has_result: bool
    has_strong_verbs: bool
    has_quantified_result: bool
    strong_verbs: List[str] = []
    weak_phrases: List[str] = []
    metrics: List[str] = []
    word_counts: Dict[str, int] = {}
    feedback: List[str] = []


class StarStorySchema(BaseModel):
    id: int
    title: str
    situation: str
    task: str
    action: str
    result: str
    tags: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    evaluation: StarEvaluationSchema


class StarStoryListSchema(BaseModel):
    stories: List[StarStorySchema]
    count: int


class EvaluateStarRequestSchema(BaseModel):
    """Ad-hoc evaluation without saving — for live feedback as the user types."""

    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""


class ReverseQuestionSchema(BaseModel):
    category: str
    question: str
    # Why it's worth asking. The candidate should understand the question
    # before using it, not read it off a card.
    purpose: str


class ReverseQuestionsRequestSchema(BaseModel):
    job_title: str = ""
    company: str = ""
    jd_text: str = ""


class ReverseQuestionsResponseSchema(BaseModel):
    questions: List[ReverseQuestionSchema]
