from typing import List, Optional

from pydantic import BaseModel


class RoadmapRequestSchema(BaseModel):
    """All fields optional — the router fills blanks from the stored profile,
    so the page can request a roadmap with no input at all."""

    current_role: Optional[str] = None
    target_role: Optional[str] = None
    seniority: Optional[str] = None


class MilestoneSchema(BaseModel):
    id: str
    title: str
    summary: str = ""
    typical_duration: str = ""
    have_skills: List[str] = []
    gap_skills: List[str] = []


class RoadmapSchema(BaseModel):
    current_role: str
    target_role: str
    # False when the generic scaffold was served instead of a tailored path.
    # The UI says so rather than presenting both as equally authoritative.
    tailored: bool
    milestones: List[MilestoneSchema]


class SalaryBenchmarkSchema(BaseModel):
    role: str
    # How many cached postings backed this. Zero means we have no data, and
    # every band below is null — never a fabricated range.
    sample_size: int
    p25: Optional[int] = None
    median: Optional[int] = None
    p75: Optional[int] = None
    low: Optional[int] = None
    high: Optional[int] = None


class CounterOfferRequestSchema(BaseModel):
    role: str
    company: str = ""
    current_offer: str = ""
    target_offer: str = ""


class CounterOfferSchema(BaseModel):
    email: str
    benchmark: SalaryBenchmarkSchema
