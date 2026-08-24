from typing import List, Literal, Optional

from pydantic import BaseModel


class JobListingSchema(BaseModel):
    """Mirrors the JobListing interface in frontend/src/lib/jobsData.ts.

    Field names are camelCase on purpose — this is the one payload the
    frontend consumes without a mapping layer, and jobsData.ts already
    declares this exact shape.
    """

    id: str
    title: str
    company: str
    location: str
    workMode: Literal["Remote", "Hybrid", "On-site"]
    salaryRange: str
    # None for rows cached before the column existed, or where the source
    # returned no body. The drawer renders a fallback rather than an empty pane.
    description: Optional[str] = None
    skills: List[str]
    postedDaysAgo: int
    applyUrl: str


class JobFeedSchema(BaseModel):
    # None when the cache is cold and no listing has ever been fetched.
    lastUpdated: Optional[str] = None
    jobs: List[JobListingSchema]


class WarmRefreshSchema(BaseModel):
    """Per-role row counts from a warm refresh — a billed operation."""

    refreshed: dict[str, int]
    total: int
