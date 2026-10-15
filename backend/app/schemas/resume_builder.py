from typing import List, Literal, Optional

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
    # True when this skipped the Claude rewrite call because an identical
    # (user, analysis, job) preview was already cached — see resume_builder/cache.py.
    from_cache: bool = False


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
    # The sections autofill.py reads besides roles and degrees. Declared here
    # so the response model does not silently strip them.
    projects: List["TailoredProjectSchema"] = Field(default_factory=list)
    skill_groups: List["TailoredSkillGroupSchema"] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    awards: List[str] = Field(default_factory=list)
    publications: List[str] = Field(default_factory=list)
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
    # Free text, for callers with no job_id (e.g. a pasted JD). Ignored when
    # job_id is given — the listing's own description is used instead, so the
    # two can never silently disagree.
    job_description: str = Field(default="", max_length=20000)
    target_pages: int = Field(default=1, ge=1, le=2)
    # Optional: when given, the job's own description is resolved server-side
    # (same lookup tailor_preview already does) and this doubles as the cache
    # key alongside analysis_id — see resume_builder/cache.py.
    job_id: Optional[int] = None
    # Skills to add to the built resume — the caller's own accepted subset of
    # a tailor-preview's state_explicitly/missing_keywords. Never invented
    # here: this endpoint only places skills it was explicitly handed.
    accepted_skills: List[str] = Field(default_factory=list, max_length=40)
    # Bullet rewrites to apply, verbatim, from a prior tailor-preview's
    # bullet_suggestions. Matched by (experience_index, original) against the
    # resume on file; a suggestion that no longer matches is skipped rather
    # than applied to the wrong line.
    bullet_overrides: List[BulletSuggestionSchema] = Field(default_factory=list)


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
    # None when no trained model is on disk — never a placeholder figure.
    ats_score: Optional[int] = None
    filename: str
    # True when this skipped every tectonic compile because an identical
    # (user, analysis, job, target_pages) build was already cached.
    from_cache: bool = False


class ResumeJobMatchRequestSchema(BaseModel):
    job_id: Optional[int] = Field(default=None, ge=1)
    job_description: str = Field(default="", max_length=20000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)


class TailoredSkillGroupSchema(BaseModel):
    category: str = Field(default="Skills", max_length=80)
    items: List[str] = Field(default_factory=list, max_length=60)


class TailoredProjectSchema(BaseModel):
    name: str = Field(default="", max_length=180)
    tech: str = Field(default="", max_length=500)
    dates: str = Field(default="", max_length=80)
    bullets: List[str] = Field(default_factory=list, max_length=40)


class TailoredResumeContentSchema(BaseModel):
    candidate_name: str = Field(default="Candidate", max_length=120)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=80)
    location: str = Field(default="", max_length=160)
    linkedin: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=1500)
    technical_skills: List[str] = Field(default_factory=list, max_length=60)
    tools_skills: List[str] = Field(default_factory=list, max_length=60)
    skill_groups: List[TailoredSkillGroupSchema] = Field(default_factory=list, max_length=20)
    experiences: List[ExperienceEntry] = Field(default_factory=list, max_length=30)
    projects: List[TailoredProjectSchema] = Field(default_factory=list, max_length=30)
    education: List[EducationEntry] = Field(default_factory=list, max_length=20)
    certifications: List[str] = Field(default_factory=list, max_length=40)
    awards: List[str] = Field(default_factory=list, max_length=40)
    publications: List[str] = Field(default_factory=list, max_length=40)
    section_order: List[str] = Field(default_factory=list, max_length=12)
    section_titles: dict[str, str] = Field(default_factory=dict)


class SaveTailoredResumeRequestSchema(BaseModel):
    source_analysis_id: int = Field(ge=1)
    job_id: Optional[int] = Field(default=None, ge=1)
    job_description: str = Field(default="", max_length=20000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    target_pages: int = Field(default=1, ge=1, le=2)
    design: Literal["faang", "original"] = "faang"
    content: TailoredResumeContentSchema


class ScoreChangeSchema(BaseModel):
    delta: float
    direction: Literal["improved", "unchanged", "declined"]


class SavedTailoredResumeSchema(BaseModel):
    id: int
    source_analysis_id: Optional[int] = None
    job_id: Optional[int] = None
    job_title: str
    company: Optional[str] = None
    resume_filename: str
    score_before: Optional[float] = None
    score_after: Optional[float] = None
    score_change: Optional[ScoreChangeSchema] = None
    score_source: Optional[str] = None
    created_at: str
    download_url: str


class ReviewedPreviewSchema(BaseModel):
    """The candidate's edits compiled and re-scored, not saved."""

    pdf_base64: str
    page_count: int
    target_pages: int
    fits: bool
    adjustments: List[str] = Field(default_factory=list)
    filename: str
    score_before: Optional[float] = None
    score_after: Optional[float] = None
    score_change: Optional[ScoreChangeSchema] = None
    score_source: Optional[str] = None


# ── Tailor Resume (resume_builder/smart_tailor.py) ──────────────────────────


class SmartTailorRequestSchema(BaseModel):
    """One stored scan, one job: a listing (job_id) or pasted text.

    Exactly one of job_id / job_description is needed; job_id wins when both
    are sent, so the listing's stored text and the pasted text can never
    silently disagree.
    """

    job_id: Optional[int] = None
    job_description: str = Field(default="", max_length=20000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    full_name: str = Field(default="", max_length=120)
    # "faang": the clean single-column convention. "original": the candidate's
    # own section order and heading names, set in the same ATS-safe template.
    design: Literal["faang", "original"] = "faang"
    target_pages: int = Field(default=1, ge=1, le=2)
    # Skills the candidate states they have although the resume doesn't show
    # them. Their own claim, so they may be listed; never invented here.
    confirmed_skills: List[str] = Field(default_factory=list, max_length=15)


class RequirementMatchSchema(BaseModel):
    requirement: str
    key: str
    kind: str
    importance: Literal["critical", "high", "medium", "low"]
    required: bool
    jd_evidence: str = ""
    match: Literal["exact", "related", "transferable", "missing"]
    resume_evidence: Optional[str] = None
    via: Optional[str] = None
    demonstrated: bool = False
    section: Optional[str] = None
    buried: bool = False


class TransferableSchema(BaseModel):
    requirement: str
    via: Optional[str] = None
    evidence: Optional[str] = None


class MissingRequirementSchema(BaseModel):
    requirement: str
    importance: str
    kind: str


class KeywordStatusSchema(BaseModel):
    term: str
    importance: str
    supported: bool
    on_resume: bool


class TailorAnalysisSchema(BaseModel):
    job_title: str = ""
    company: str = ""
    seniority: str = "unknown"
    hiring_intent: str = ""
    # Importance-weighted share of requirements evidenced. Not the ATS score.
    coverage: int
    counts: dict[str, int]
    requirements: List[RequirementMatchSchema]
    strong_matches: List[str]
    transferable: List[TransferableSchema]
    missing: List[MissingRequirementSchema]
    keywords: List[KeywordStatusSchema]
    buried: List[str]
    listed_not_shown: List[str]
    low_value_bullets: List[str]
    years_experience: Optional[float] = None
    jd_analysis_source: str


class TailorChangeSchema(BaseModel):
    change: str
    reason: str


class BulletChangeSchema(BaseModel):
    entry: str
    original: str
    tailored: str
    status: Literal["rewritten", "reverted"]
    reasons: List[str] = Field(default_factory=list)


class TailorAiSchema(BaseModel):
    used: bool
    provider: Optional[str] = None
    rewrites_accepted: int = 0
    rewrites_reverted: int = 0
    note: Optional[str] = None


class TailoringSummarySchema(BaseModel):
    changes: List[TailorChangeSchema]
    bullet_changes: List[BulletChangeSchema]
    ai: TailorAiSchema


class TailoredResumeSchema(BaseModel):
    # The structured content that was compiled — what the PDF says, as data.
    content: dict
    section_titles: dict[str, str] = Field(default_factory=dict)
    text: str
    pdf_base64: str
    tex_source: str
    page_count: int
    target_pages: int
    fits: bool
    adjustments: List[str] = Field(default_factory=list)
    design: Literal["faang", "original"]
    filename: str


class ValidationCheckSchema(BaseModel):
    key: str
    label: str
    status: Literal["pass", "warn", "fail"]
    detail: str


class TailorValidationSchema(BaseModel):
    status: Literal["pass", "warn", "fail"]
    checks: List[ValidationCheckSchema]


class ShortlistOutlookSchema(BaseModel):
    """A band with its reasons — deliberately not a selection probability
    (resume_builder/outlook.py)."""

    band: Literal["strong", "competitive", "possible", "long_shot"]
    label: str
    drivers: List[str]
    basis: Literal["ats_and_coverage", "coverage_only"]
    note: str


class TailorScoresSchema(BaseModel):
    # The trained model's score, before and after. None when no model is on
    # disk — never a placeholder.
    before: Optional[float] = None
    after: Optional[float] = None
    change: Optional[ScoreChangeSchema] = None
    # "model": the trained ATS model. "keyword_fallback": no model installed,
    # so the share of the job's keywords covered (what a scan shows too).
    source: Optional[str] = None
    outlook_before: Optional[ShortlistOutlookSchema] = None
    outlook_after: Optional[ShortlistOutlookSchema] = None


class SmartTailorResponseSchema(BaseModel):
    analysis: TailorAnalysisSchema
    tailoring: TailoringSummarySchema
    resume: TailoredResumeSchema
    validation: TailorValidationSchema
    scores: TailorScoresSchema
    from_cache: bool = False


# Forward references (projects, skill groups) are defined further down.
AutofillSchema.model_rebuild()
