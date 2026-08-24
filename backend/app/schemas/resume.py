from typing import List, Optional

from pydantic import BaseModel


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
