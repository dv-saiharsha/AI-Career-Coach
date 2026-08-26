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

    # Enrichment. All optional and all None until a posting has been through
    # Claude — a card with no data must render as "unknown", never as a
    # negative finding.
    #
    # h1bSponsorship reports what the posting SAYS, not what the employer will
    # do, and h1bEvidence carries the sentence it was read from so a candidate
    # can judge the claim rather than trust a badge.
    # Best-effort brand icon. May 404 — the domain is guessed from the
    # company name — so the card must render a fallback on error.
    companyLogo: Optional[str] = None
    # Which of JOB_DOMAINS this role belongs to. None for on-demand searches
    # outside the warm set.
    domain: Optional[str] = None
    h1bSponsorship: Optional[
        Literal["explicitly_sponsored", "no_sponsorship", "unmentioned"]
    ] = None
    h1bEvidence: Optional[str] = None
    experienceLevel: Optional[Literal["entry", "mid", "senior", "lead"]] = None
    employmentType: Optional[
        Literal["full_time", "part_time", "contract", "internship"]
    ] = None


class FilterCountsSchema(BaseModel):
    """Counts from the *unfiltered* feed, so a pill can show what it would
    match and disable itself at zero rather than leading to an empty grid."""

    h1b: dict[str, int] = {}
    experience: dict[str, int] = {}
    employment: dict[str, int] = {}
    # How much of the feed has never been classified. Surfaced so the UI can
    # say so outright instead of implying the filters cover everything.
    unenriched: int = 0


class JobFeedSchema(BaseModel):
    # None when the cache is cold and no listing has ever been fetched.
    lastUpdated: Optional[str] = None
    jobs: List[JobListingSchema]
    filterCounts: Optional[FilterCountsSchema] = None
    # A background scrape for this query is in flight. The listings shown are
    # cached; fresher ones will exist on the next load.
    refreshing: bool = False


class WarmRefreshSchema(BaseModel):
    """Per-role row counts from a warm refresh — a billed operation."""

    refreshed: dict[str, int]
    total: int
