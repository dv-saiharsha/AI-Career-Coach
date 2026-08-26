from typing import List, Optional

from pydantic import BaseModel


class FreshJobSchema(BaseModel):
    id: str
    title: str
    company: str
    location: str
    work_mode: str
    # Derived from posted_at (when the employer listed it), not fetched_at
    # (when we scraped it) — the latter would call every row hours old.
    posted_label: str
    h1b_sponsorship: Optional[str] = None
    h1b_evidence: Optional[str] = None
    experience_level: Optional[str] = None
    apply_url: str


class NewsArticleSchema(BaseModel):
    """A real Federal Register document. Nothing here is authored by ApplyCenter."""

    id: str
    title: str
    # The issuing agency's own abstract, verbatim. None when it published none.
    summary: Optional[str] = None
    type: str
    agency: str
    # The document's real publication date — never the current time.
    published_at: Optional[str] = None
    url: Optional[str] = None


class PipelineMetricsSchema(BaseModel):
    """Headline numbers for the pipeline."""

    # Counts only stages that mean an application was sent — "saved" is a
    # bookmark, and including it would inflate what a user reads as
    # "how many jobs have I applied to".
    total_applied: int
    by_stage: dict[str, int] = {}
    # None, not 0.0, when nothing has been scored yet: "0% match" reads as a
    # terrible resume, where no measurement is simply no measurement.
    average_match_score: Optional[float] = None
    # How much of the pipeline the average is actually based on, so a figure
    # drawn from one application is not mistaken for one drawn from twenty.
    scored_applications: int = 0
    total_applications: int = 0


class DashboardOverviewSchema(BaseModel):
    metrics: PipelineMetricsSchema
    fresh_jobs: List[FreshJobSchema] = []
    # Names the window actually used, so the UI can't imply everything shown
    # is hours old when the query had to widen to fill the panel.
    fresh_window: str
    # The user's latest resume score. One figure for the page, not a
    # per-card match invented for listings never scored against.
    latest_ats_score: Optional[float] = None
    scored_against: Optional[str] = None
    news: List[NewsArticleSchema] = []
    # False when the Federal Register could not be reached, so the UI says the
    # feed is unavailable rather than presenting stale items as current.
    news_reachable: bool = True
    news_cached: bool = False
