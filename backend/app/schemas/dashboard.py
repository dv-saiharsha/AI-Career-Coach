from typing import List, Optional

from pydantic import BaseModel

from app.schemas.analytics import AtsHistoryPointSchema, FunnelSchema
from app.schemas.application import ApplicationSchema
from app.schemas.job import JobListingSchema
from app.schemas.profile import ActivityItemSchema
from app.schemas.resume_review import NextActionSchema


class FreshJobSchema(BaseModel):
    id: str
    title: str
    company: str
    location: str
    work_mode: str
    # Derived from posted_at (when the employer listed it), not fetched_at
    # (when we scraped it) — the latter would call every row hours old.
    posted_label: str
    # As the employer wrote it, or absent. Most postings do not state one.
    salary_range: Optional[str] = None
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


# ── Career Dashboard (Milestone 9) ──────────────────────────────────────────
#
# Every field below is produced by an existing engine's own function — see
# dashboard/services.py's home(). Nothing here introduces a new score.


class DashboardResumeSchema(BaseModel):
    resumes_analyzed: int
    avg_ats_score: Optional[float] = None
    latest_ats_score: Optional[float] = None
    latest_band: str
    latest_filename: Optional[str] = None
    #: The latest scan's own stored missing_skills, capped — not recomputed.
    suggested_improvements: List[str] = []


class DashboardApplicationsSchema(BaseModel):
    total: int
    active: int
    offers: int
    rejections: int
    success_rate: Optional[float] = None


class DashboardInterviewReportSchema(BaseModel):
    session_id: int
    role: str
    category: Optional[str] = None
    overall_score: Optional[float] = None
    readiness_band: Optional[str] = None
    completed_at: Optional[str] = None


class DashboardInterviewSchema(BaseModel):
    completed_sessions: int
    average_score: Optional[float] = None
    voice_answers_count: int = 0
    latest_report: Optional[DashboardInterviewReportSchema] = None
    prep_completed_count: int = 0


class DashboardJobsSchema(BaseModel):
    top_matches: List[JobListingSchema] = []
    missing_skills: List[str] = []
    recruiter_perspective: Optional[str] = None


class DashboardActivitySchema(BaseModel):
    recent_activity: List[ActivityItemSchema] = []
    upcoming_interviews: List[ApplicationSchema] = []
    recent_applications: List[ApplicationSchema] = []


class DashboardAnalyticsSchema(BaseModel):
    ats_history: List[AtsHistoryPointSchema] = []
    weekly_progress: List[dict] = []
    monthly_progress: List[dict] = []
    funnel: FunnelSchema


class DashboardHomeSchema(BaseModel):
    resume: DashboardResumeSchema
    applications: DashboardApplicationsSchema
    interview: DashboardInterviewSchema
    jobs: DashboardJobsSchema
    activity: DashboardActivitySchema
    analytics: DashboardAnalyticsSchema
    next_actions: List[NextActionSchema] = []
