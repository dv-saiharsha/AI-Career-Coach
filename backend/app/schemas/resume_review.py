from typing import List, Optional

from pydantic import BaseModel


class ReviewCategorySchema(BaseModel):
    """One reviewed dimension of the resume.

    `score` is Optional rather than defaulting to 0 for the same reason the
    rubric skips unrunnable metrics: a check that could not run is not a
    check the resume failed. `available` states which of the two it is, so a
    client never has to infer it from a null.
    """

    key: str
    label: str
    score: Optional[float]
    band: str
    #: high | medium | low | none — ranked by recoverable weight, not raw score.
    priority: str
    #: What this dimension measures.
    explanation: str
    #: What *this* resume did, so the score can be argued with.
    reason: str
    improvements: List[str]
    available: bool


class ResumeHealthSchema(BaseModel):
    """The single user-facing headline score.

    Job-independent in both modes by design — see review.py's docstring.
    `weight_applied` is what the score is actually out of; a client printing
    "72/100" when only 55 points of checks ran overstates its own coverage.
    """

    score: Optional[float]
    band: str
    weight_applied: int
    skipped: List[str]


class JobMatchSchema(BaseModel):
    """The trained model's score, present only in job-specific mode.

    `source` is explicit because this is the one figure in the payload that
    is a learned prediction rather than a weighted rubric.
    """

    score: float
    band: str
    source: str


class BulletImprovementSchema(BaseModel):
    bullet: str
    grade: int
    has_strong_verb: bool
    has_metric: bool
    has_tool_context: bool
    suggestions: List[str]


class NextActionSchema(BaseModel):
    key: str
    label: str
    description: str
    href: str
    priority: str


class ResumeReviewSchema(BaseModel):
    analysis_id: Optional[int]
    resume_filename: Optional[str]
    #: general | job_specific — derived from whether a job description exists,
    #: never supplied by the caller.
    mode: str
    resume_health: ResumeHealthSchema
    job_match: Optional[JobMatchSchema]
    categories: List[ReviewCategorySchema]
    missing_skills: List[str]
    matched_skills: List[str]
    missing_keywords: List[str]
    bullet_improvements: List[BulletImprovementSchema]
    next_actions: List[NextActionSchema]
    #: deterministic | llm — whether any model call contributed to this payload.
    generated_by: str
