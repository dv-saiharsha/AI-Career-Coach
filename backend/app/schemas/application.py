from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Literal rather than str: an invalid stage is rejected by FastAPI as a 422
# with the allowed values listed, instead of reaching the database and failing
# on the CHECK constraint as an opaque 500.
ApplicationStatus = Literal[
    "saved",
    "applied",
    "recruiter_contacted",
    "recruiter_screening",
    "online_assessment",
    "technical_interview",
    "manager_interview",
    "final_interview",
    "offer",
    "accepted",
    "rejected",
    "withdrawn",
]


class ApplicationCreateSchema(BaseModel):
    job_title: str = Field(min_length=1)
    company: str = Field(min_length=1)
    location: Optional[str] = None
    salary_range: Optional[str] = None
    status: ApplicationStatus = "saved"
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    tailored_resume_id: Optional[int] = None
    notes: Optional[str] = None
    recruiter_name: Optional[str] = None
    recruiter_email: Optional[str] = None


class ApplicationUpdateSchema(BaseModel):
    """Partial update. Every field optional — omitted keys are left untouched
    server-side so a notes-only save can't blank the status."""

    job_title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    salary_range: Optional[str] = None
    status: Optional[ApplicationStatus] = None
    job_url: Optional[str] = None
    notes: Optional[str] = None
    tailored_resume_id: Optional[int] = None
    recruiter_name: Optional[str] = None
    recruiter_email: Optional[str] = None


class ApplicationStatusUpdateSchema(BaseModel):
    status: ApplicationStatus


class ApplicationSchema(BaseModel):
    id: int
    job_title: str
    company: str
    location: Optional[str] = None
    salary_range: Optional[str] = None
    status: ApplicationStatus
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    tailored_resume_id: Optional[int] = None
    notes: Optional[str] = None
    recruiter_name: Optional[str] = None
    recruiter_email: Optional[str] = None
    # Already computed lazily elsewhere (dashboard/services.py) against the
    # trained model; exposed here read-only so the List view's Match column
    # doesn't need its own fetch for a number that already exists on the row.
    match_score: Optional[float] = None
    applied_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PipelineSchema(BaseModel):
    """Applications pre-grouped by stage.

    Grouped server-side so the board renders straight from the response, and
    so every stage key is always present — a column with no cards still has to
    draw, and an absent key would make it disappear.
    """

    pipeline: Dict[str, List[ApplicationSchema]]
    total: int


class StatusHistoryEntrySchema(BaseModel):
    from_status: Optional[ApplicationStatus] = None
    to_status: ApplicationStatus
    changed_at: str


class ActivityItemSchema(StatusHistoryEntrySchema):
    """A status-history entry with enough of the parent application attached
    to render in a feed spanning every application, not just one."""

    application_id: int
    job_title: str
    company: str


# -- Cross-engine detail view -----------------------------------------------
#
# Everything below is read-only aggregation over data other engines already
# compute — see applications/services.py's get_application_detail. Nothing
# here is a new scoring model or a new source of truth.


class ResumeSummarySchema(BaseModel):
    """The resume this application was tailored from, if any."""

    analysis_id: int
    filename: str
    ats_score: float
    band: str
    scanned_at: str


class JobMatchSummarySchema(BaseModel):
    """Reuses job_market.matching.build_job_match verbatim — same shape the
    job feed already returns, just computed against this application's own
    stored job_description instead of a live listing."""

    overall_match: Optional[float] = None
    band: Optional[str] = None
    matching_skills: List[str] = []
    missing_skills: List[str] = []
    explanation: str


class InterviewSummarySchema(BaseModel):
    """The most recent completed Mock/Voice Interview session whose role
    matches this application's job_title (normalised the same way the job
    feed normalises search queries) — a best-effort correlation, since no
    hard link exists between an application and an interview session."""

    session_id: int
    overall_score: float
    readiness_band: str
    topics_to_improve: List[str]
    completed_at: str


class ApplicationDetailSchema(BaseModel):
    application: ApplicationSchema
    status_history: List[StatusHistoryEntrySchema]
    resume: Optional[ResumeSummarySchema] = None
    job_match: Optional[JobMatchSummarySchema] = None
    interview: Optional[InterviewSummarySchema] = None
    has_in_progress_interview: bool = False
