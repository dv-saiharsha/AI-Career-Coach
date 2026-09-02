from typing import List, Optional

from pydantic import BaseModel, Field


class KeywordFrequency(BaseModel):
    keyword: str
    present: bool
    frequency: int
    # True when the resume never states this term but the candidate's other
    # skills entail it (PyTorch implying deep learning). Distinct from
    # `present`, because a recruiter's literal keyword search still won't find
    # it — the candidate should be told to write it down.
    implied: bool = False


class BulletFeedbackSchema(BaseModel):
    bullet: str
    # 0-100. Derived from how many X-Y-Z components are present, with a real
    # zero floor — a bullet with no verb and no metric scores 0, not 50.
    impact_rating: float
    has_strong_verb: bool
    has_weak_opener: bool
    has_metric: bool
    has_tool_context: bool
    metrics: List[str] = []
    suggestions: List[str] = []


class FormattingWarningSchema(BaseModel):
    severity: str
    issue: str
    # Kept alongside the issue rather than flattened into one string: the user
    # needs to know what to change, not just that something is wrong.
    detail: str


class ParsingReadinessSchema(BaseModel):
    """Structural readiness, independent of content.

    A resume can name every keyword a job asks for and still fail here — a
    two-column layout or an image-only export is unreadable to a parser no
    matter how well it's written.
    """

    readiness_score: float
    # Three-valued. None means the column check could not run (no PDF stored,
    # or a DOCX PyMuPDF cannot open) — reporting that as single-column would
    # be a claim with no evidence behind it.
    is_single_column: Optional[bool] = None
    detected_headers: List[str] = []
    formatting_warnings: List[FormattingWarningSchema] = []
    column_check_skipped_reason: Optional[str] = None
    extracted_characters: int = 0


class DiagnosticsSchema(BaseModel):
    """Explanatory metadata attached to a scan.

    Carries no score of its own. `ats_score` on the parent stays the trained
    model's prediction; these fields say *why* the resume reads the way it
    does, which a single number cannot.
    """

    # Taxonomy-aware, so a candidate isn't told to add a skill their other
    # skills already demonstrate.
    taxonomy_matched_skills: List[str] = []
    taxonomy_missing_skills: List[str] = []
    implied_skills: List[str] = []
    # 0-100 across all bullets.
    bullet_impact_rating: float = 0.0
    quantified_metrics_ratio: float = 0.0
    strong_verb_ratio: float = 0.0
    bullet_feedback: List[BulletFeedbackSchema] = []
    # Missing skills bucketed by domain, so a gap reads as "3 Cloud
    # Infrastructure skills" rather than an unordered bag of words.
    domain_gaps: dict[str, List[str]] = {}
    # Optional so scans stored before layout checking existed still
    # deserialize on history reads instead of 500-ing.
    parsing_readiness: Optional[ParsingReadinessSchema] = None


class AnalysisResultSchema(BaseModel):
    id: int
    ats_score: float
    missing_skills: List[str]
    matched_skills: List[str]
    extracted_skills: List[str]
    keyword_analysis: List[KeywordFrequency]
    suggestions: List[str]
    created_at: str
    # Optional so a stored scan from before diagnostics existed still
    # deserializes instead of 500-ing on history reads.
    diagnostics: DiagnosticsSchema | None = None


class ResumeHistoryItemSchema(BaseModel):
    id: int
    resume_filename: str
    ats_score: float
    created_at: str


class GenerateResumeRequestSchema(BaseModel):
    full_name: str
    skills_to_add: List[str] = []


class RubricMetricSchema(BaseModel):
    key: str
    label: str
    # Points this metric contributes to the rubric total.
    weight: int
    # None when the metric's inputs were unavailable. Its weight is then
    # removed from the denominator rather than scored as zero — a check nobody
    # could run is not a failure.
    score: Optional[float] = None
    band: str


class ParseCheckSchema(BaseModel):
    key: str
    name: str
    # Three-valued. None means the check could not run (commonly: no PDF was
    # stored, so column geometry cannot be measured). "Could not check" and
    # "failed" are different findings and must render differently.
    passed: Optional[bool] = None
    detail: str
    why: str


class ScoreBreakdownSchema(BaseModel):
    """A deterministic breakdown alongside the trained model's score.

    Two numbers, each labelled by what produced it. `model_score` is the
    GradientBoostingRegressor's prediction and remains the authoritative
    figure used everywhere else. `rubric_total` is this module's weighted sum
    of measurable properties.

    They are not expected to agree exactly, and neither is derived from the
    other. The rubric's value is that it can be inspected and argued with; the
    model's is that it learned from scored examples.
    """

    analysis_id: int
    resume_filename: str
    model_score: float
    # Whether model_score can be believed for this document. The trained model
    # gives a verbatim copy of the posting 88 and a real resume with quantified
    # achievements 49, so a high score is evidence of keyword overlap and
    # nothing more until something checks for repetition. Shipped beside the
    # number rather than folded into it — see resume_analyzer/integrity.py.
    score_integrity: Optional[dict] = None
    rubric_total: Optional[float] = None
    # What the rubric total is out of. Below 100 when some check could not
    # run; a UI printing "/100" regardless would overstate its coverage.
    weight_applied: int
    skipped: List[str] = []
    metrics: List[RubricMetricSchema] = []
    parse_checks: List[ParseCheckSchema] = []
    missing_keywords: List[str] = []
    matched_keywords: List[str] = []


class RescanRequest(BaseModel):
    """Re-score the resume already on file against a different posting.

    No file field: the whole point is that the bytes are already stored. The
    length cap matches what /analyze accepts through its Form(...), so the two
    paths cannot disagree about what counts as a job description.
    """

    job_description: str = Field(min_length=1, max_length=20000)
