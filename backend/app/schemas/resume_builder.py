from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.resume import ParsingReadinessSchema


class ExperienceEntry(BaseModel):
    title: str
    company: str
    dates: str
    bullets: List[str] = Field(default_factory=list)


class EducationEntry(BaseModel):
    degree: str
    institution: str
    dates: str


class CompileResumeRequestSchema(BaseModel):
    """Structured, accepted content for the one-page LaTeX resume.

    Typed nested models rather than Dict[str, Any] — a request missing
    `title` on an experience entry 422s with a clear field-level error
    instead of raising an unhandled KeyError mid-compile.
    """

    job_description: str
    candidate_name: str
    location: str = ""
    email: str = ""
    phone: str = ""
    linkedin: str = ""
    summary: str = ""
    technical_skills: List[str] = Field(default_factory=list)
    tools_skills: List[str] = Field(default_factory=list)
    experiences: List[ExperienceEntry] = Field(default_factory=list)
    education: List[EducationEntry] = Field(default_factory=list)


class CompileResumeResponseSchema(BaseModel):
    # Sole numeric score, from the trained model (ml/inference.predict_score) —
    # not a hand-weighted formula. See resume_builder/services.py for why.
    ats_score: int
    # tfidf_cosine from ml/features.py, surfaced as its own figure rather than
    # folded into ats_score — a real computed similarity, not a stand-in
    # labelled "semantic" for something that was never actually computed.
    semantic_match: float
    keyword_matched_count: int
    keyword_total_count: int
    page_count: int
    pdf_base64: str


class BulletSuggestionSchema(BaseModel):
    experience_index: int
    original: str
    suggested: str
    reason: str


class StageFixesResponseSchema(BaseModel):
    missing_keywords: List[str]
    bullet_suggestions: List[BulletSuggestionSchema]


class BulletEvaluationSchema(BaseModel):
    bullet: str
    # 0-3: how many of the X-Y-Z components are present. Kept as a count
    # rather than a percentage — a 3-point checklist rendered as "67%" implies
    # a precision it doesn't have.
    grade: int
    has_strong_verb: bool
    has_weak_opener: bool
    has_metric: bool
    has_tool_context: bool
    metrics: List[str] = []
    suggestions: List[str] = []


class BulletReportSchema(BaseModel):
    bullet_count: int
    quantified_ratio: float
    strong_verb_ratio: float
    weak_opener_count: int
    average_grade: float
    # Mean of the per-bullet 0-100 ratings. Declared here because pydantic
    # drops any key the schema doesn't name: the services layer computed this
    # and it was being silently stripped out of the response.
    impact_rating: float = 0.0
    bullets: List[BulletEvaluationSchema] = []


class SkillContextSchema(BaseModel):
    skill: str
    found: bool
    sections: List[str] = []
    occurrences: int
    # Best context the skill appears in, halved when it looks stuffed.
    weight: float
    stuffed: bool


class RoleRecencySchema(BaseModel):
    title: str
    company: str
    dates: str
    # None when no year could be parsed — treated as unknown, never as old.
    end_year: Optional[int] = None
    recency_credit: float


class QualityReportSchema(BaseModel):
    """Diagnostics only. ats_score is unchanged and still comes from the
    trained model — nothing here feeds into it."""

    bullets: BulletReportSchema
    skill_contexts: List[SkillContextSchema] = []
    role_recency: List[RoleRecencySchema] = []
    domain_gaps: dict[str, List[str]] = {}
    # Reuses the analyzer's schema so the stored-scan and live-scan payloads
    # describe readiness identically — one frontend card renders both.
    # Optional so a caller passing only text still validates.
    parsing_readiness: Optional[ParsingReadinessSchema] = None


class QualityReportRequestSchema(BaseModel):
    resume_text: str = ""
    job_description: str = ""
    experiences: List[ExperienceEntry] = Field(default_factory=list)


class TailorHandoffRequestSchema(BaseModel):
    job_id: int
    analysis_id: int


class TailorHandoffSchema(BaseModel):
    """Gap analysis for one resume against one listing.

    Reports what to change; does not change it. Bullets are never written on
    the candidate's behalf — a resume claiming skills its owner cannot defend
    in an interview is worse for them than an honest gap.
    """

    job_id: int
    job_title: str
    company: str
    analysis_id: int
    resume_filename: Optional[str] = None
    # This resume scored against THIS posting. None when no trained model is
    # on disk — never a placeholder.
    targeted_ats_score: Optional[float] = None
    semantic_match: Optional[float] = None
    # What the original scan scored, against whatever JD it used. Shown beside
    # the targeted score so the delta is visible.
    original_ats_score: Optional[float] = None
    # Named by the posting, neither stated nor implied by the resume.
    missing_keywords: List[str] = []
    # Implied by the resume but never written down. A keyword search still
    # misses these, and saying them is far easier than acquiring them.
    state_explicitly: List[str] = []
    gaps_by_domain: dict[str, List[str]] = {}
    # False when the cached listing carries no body text, in which case the
    # gap list is necessarily empty rather than meaningfully clean.
    has_job_description: bool = True


class TailorPreviewRequestSchema(BaseModel):
    job_id: int
    analysis_id: int
    # The backend has no name: AuthenticatedUser carries only id and email,
    # and the display name lives in Supabase user_metadata, which the client
    # holds. Sent from there rather than guessed from the email local-part.
    full_name: str = ""
    # Gates the one paid step. Opening a preview is free; asking for bullet
    # rewrites spends a Claude call and has to be deliberate.
    include_rewrites: bool = False


class TailorPreviewSchema(BaseModel):
    """A tailoring proposal. Nothing is written until the user accepts."""

    job_id: int
    job_title: str
    company: str
    analysis_id: int
    # LASTNAME_FIRSTNAME_RESUME_ROLE_COMPANY.pdf
    download_filename: str
    original_resume_text: str
    # This resume against THIS posting, from the trained model. None when no
    # model is on disk — never a placeholder figure.
    current_score: Optional[float] = None
    semantic_match: Optional[float] = None
    # There is deliberately no projected_score. A score for a resume that does
    # not exist yet cannot be measured, and quoting one would be a promise
    # rather than a result — it is recomputed for real after compilation.
    missing_keywords: List[str] = []
    state_explicitly: List[str] = []
    bullet_suggestions: List[BulletSuggestionSchema] = []
    has_job_description: bool = True


class StageFixesRequestSchema(BaseModel):
    """Which stored experience bullets to run rewrite suggestions against.

    Optional: omitting `experiences` returns missing_keywords only, with no
    LLM call — a cheap, always-available path when the user just wants the
    keyword list without spending a Claude call on rewrites.
    """

    experiences: Optional[List[ExperienceEntry]] = None


class AutofillSchema(BaseModel):
    """Structured fields read back out of an uploaded resume.

    Every field is optional because every field is a heuristic. None means
    "could not determine", which the UI renders as an empty box the user fills
    — deliberately not a plausible-looking default, since nobody re-checks a
    field that already looks filled.
    """

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    location: Optional[str] = None
    summary: Optional[str] = None
    experiences: List[ExperienceEntry] = Field(default_factory=list)
    education: List[EducationEntry] = Field(default_factory=list)
    # Which fields came from an unambiguous match rather than a positional
    # guess. The UI flags the rest for review instead of presenting all of it
    # with equal confidence.
    confident_fields: List[str] = Field(default_factory=list)
    # Lets the UI say "we couldn't read your roles" rather than showing an
    # empty form that looks like nothing was attempted.
    parsed_experience_count: int = 0
    parsed_education_count: int = 0


class OptimizePlanRequestSchema(BaseModel):
    """Score-aware plan against a job description you paste in directly,
    for a resume that has no stored analysis yet."""

    resume_text: str = Field(min_length=1)
    job_description: str = Field(min_length=1, max_length=20000)


class OptimizePlanByAnalysisRequestSchema(BaseModel):
    """Same plan against the resume already on file — no resume_text field,
    because there is nothing for the caller to supply: the stored scan is
    the resume, and accepting-then-ignoring a field is worse than the field
    not existing."""

    job_description: str = Field(min_length=1, max_length=20000)


class OptimizeEditSchema(BaseModel):
    """One proposed change and what the model does with it.

    `score_after`/`delta` are present only when `applied` is True — an edit
    that was skipped or held for review was never scored as installed, and a
    None here is the honest way to say that rather than a 0 that reads as a
    measured non-effect.
    """

    edit: str
    label: str
    rationale: str
    adds: List[str] = []
    applied: bool
    requires_review: bool = False
    score_after: Optional[float] = None
    delta: Optional[float] = None
    potential_score: Optional[float] = None
    reason: Optional[str] = None


class OptimizePlanSchema(BaseModel):
    """Mirrors resume_builder.optimizer.plan() exactly — see that module for
    why a model score can be pushed only this far, and only this honestly."""

    available: bool
    reason: Optional[str] = None
    baseline_score: Optional[float] = None
    projected_score: Optional[float] = None
    target_band: List[int] = []
    in_band: bool = False
    beyond_meaningful: bool = False
    integrity: dict = {}
    edits: List[OptimizeEditSchema] = []
    note: Optional[str] = None


class QuickTailorRequestSchema(BaseModel):
    """One page or two, and the name to put at the top.

    target_pages is constrained to 1 or 2 rather than left open: the two
    layouts this produces are a one-page resume for most candidates and a
    two-page one for people with enough history to fill it. A three-page
    resume is not a supported outcome — it is a resume nobody finishes
    reading.
    """

    full_name: str = Field(default="", max_length=120)
    job_description: str = Field(default="", max_length=20000)
    target_pages: int = Field(default=1, ge=1, le=2)


class QuickTailorResponseSchema(BaseModel):
    pdf_base64: str
    # The Overleaf-ready source, returned alongside the PDF so the candidate
    # can keep editing rather than being handed a file they cannot change.
    tex_source: str
    # What the compiler actually produced, which is not always what was
    # asked for — see resume_builder/fit.py.
    page_count: int
    target_pages: int
    fits: bool
    # Every trim, in the order applied, so a candidate whose oldest role was
    # dropped is told rather than left to notice.
    adjustments: List[str] = Field(default_factory=list)
    ats_score: int
    filename: str
