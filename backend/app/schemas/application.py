from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Literal rather than str: an invalid stage is rejected by FastAPI as a 422
# with the allowed values listed, instead of reaching the database and failing
# on the CHECK constraint as an opaque 500.
ApplicationStatus = Literal["saved", "applied", "interviewing", "offer", "rejected"]


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
