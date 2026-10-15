// Wire types for the Resume Builder / Tailor module, kept field-for-field
// with backend/app/schemas/resume_builder.py.

export interface BulletSuggestion {
  experience_index: number
  original: string
  suggested: string
  reason: string
}

export interface TailorHandoff {
  job_id: number
  job_title: string
  company: string
  analysis_id: number
  resume_filename: string | null
  /** This resume scored against THIS posting. Null when no trained model is
   *  on disk — never a placeholder. */
  targeted_ats_score: number | null
  semantic_match: number | null
  /** What the original scan scored, against whatever JD it used originally —
   *  not the same baseline as targeted_ats_score. */
  original_ats_score: number | null
  missing_keywords: string[]
  /** Implied by the resume but never written down. */
  state_explicitly: string[]
  gaps_by_domain: Record<string, string[]>
  has_job_description: boolean
}

export interface TailorPreview {
  job_id: number
  job_title: string
  company: string
  analysis_id: number
  download_filename: string
  original_resume_text: string
  current_score: number | null
  semantic_match: number | null
  missing_keywords: string[]
  state_explicitly: string[]
  bullet_suggestions: BulletSuggestion[]
  has_job_description: boolean
  from_cache: boolean
}

export interface QuickTailorResult {
  pdf_base64: string
  tex_source: string
  page_count: number
  target_pages: number
  fits: boolean
  adjustments: string[]
  ats_score: number | null
  filename: string
  from_cache: boolean
}

// ── Tailor Resume (POST /resume-builder/smart-tailor/{analysisId}) ─────────

export type TailorDesign = 'faang' | 'original'
export type Importance = 'critical' | 'high' | 'medium' | 'low'
export type MatchLevel = 'exact' | 'related' | 'transferable' | 'missing'
export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface RequirementMatch {
  requirement: string
  key: string
  kind: 'skill' | 'education' | 'certification' | 'experience'
  importance: Importance
  required: boolean
  jd_evidence: string
  match: MatchLevel
  /** The resume line that is the evidence, verbatim. */
  resume_evidence: string | null
  /** The resume term a related/transferable match rests on. */
  via: string | null
  demonstrated: boolean
  section: string | null
  buried: boolean
}

export interface TailorAnalysis {
  job_title: string
  company: string
  seniority: string
  hiring_intent: string
  /** Importance-weighted share of requirements evidenced — not the ATS score. */
  coverage: number
  counts: Record<MatchLevel, number>
  requirements: RequirementMatch[]
  strong_matches: string[]
  transferable: { requirement: string; via: string | null; evidence: string | null }[]
  missing: { requirement: string; importance: Importance; kind: string }[]
  keywords: { term: string; importance: Importance; supported: boolean; on_resume: boolean }[]
  buried: string[]
  listed_not_shown: string[]
  low_value_bullets: string[]
  years_experience: number | null
  jd_analysis_source: string
}

export interface SmartTailorResult {
  analysis: TailorAnalysis
  tailoring: {
    changes: { change: string; reason: string }[]
    bullet_changes: { entry: string; original: string; tailored: string; status: 'rewritten' | 'reverted'; reasons: string[] }[]
    ai: { used: boolean; provider: string | null; rewrites_accepted: number; rewrites_reverted: number; note: string | null }
  }
  resume: {
    content: Record<string, unknown>
    section_titles: Record<string, string>
    text: string
    pdf_base64: string
    tex_source: string
    page_count: number
    target_pages: number
    fits: boolean
    adjustments: string[]
    design: TailorDesign
    filename: string
  }
  validation: { status: CheckStatus; checks: { key: string; label: string; status: CheckStatus; detail: string }[] }
  /** The trained model's score. Null when no model is installed — never a placeholder. */
  scores: {
    before: number | null
    after: number | null
    change: ScoreChange | null
    /** "model": the trained ATS model; "keyword_fallback": no model installed,
     *  so the share of the job's keywords the resume covers (as a scan shows). */
    source: ScoreSource | null
    outlook_before: ShortlistOutlook | null
    outlook_after: ShortlistOutlook | null
  }
  from_cache: boolean
}

export type ScoreSource = 'model' | 'keyword_fallback'

/** Same job, same model; moves under one point are "unchanged". */
export interface ScoreChange {
  delta: number
  direction: 'improved' | 'unchanged' | 'declined'
}

/** A band with the reasons behind it — deliberately not a selection
 *  probability (backend resume_builder/outlook.py). */
export interface ShortlistOutlook {
  band: 'strong' | 'competitive' | 'possible' | 'long_shot'
  label: string
  drivers: string[]
  basis: 'ats_and_coverage' | 'coverage_only'
  note: string
}

export interface ReviewedPreview {
  pdf_base64: string
  page_count: number
  target_pages: number
  fits: boolean
  adjustments: string[]
  filename: string
  score_before: number | null
  score_after: number | null
  score_change: ScoreChange | null
  score_source: ScoreSource | null
}

export interface ResumeJobMatch {
  analysis_id: number
  resume_filename: string
  job_title: string
  company: string
  score: number | null
  score_available: boolean
  score_source: ScoreSource | null
  score_label: string
  requirement_coverage: number
  outlook: ShortlistOutlook
  matched_requirements: RequirementMatch[]
  transferable_requirements: RequirementMatch[]
  missing_requirements: RequirementMatch[]
  recommendations: { requirement: string; importance: Importance; message: string }[]
  diagnostics: {
    bullets: { bullet_count: number; quantified_ratio: number; strong_verb_ratio: number; bullets: unknown[] }
    skill_contexts: { skill: string; found: boolean; sections: string[]; occurrences: number; weight: number; stuffed: boolean }[]
    domain_gaps: Record<string, string[]>
    parsing_readiness: {
      readiness_score: number
      is_single_column: boolean | null
      detected_headers: string[]
      formatting_warnings: { severity: string; issue: string; detail: string }[]
      column_check_skipped_reason: string | null
      extracted_characters: number
    } | null
  }
  jd_analysis_source: string
}

export interface TailoredResumeContent {
  candidate_name: string
  email: string
  phone: string
  location: string
  linkedin: string
  summary: string
  technical_skills: string[]
  tools_skills: string[]
  skill_groups: { category: string; items: string[] }[]
  experiences: { title: string; company: string; dates: string; bullets: string[] }[]
  projects: { name: string; tech: string; dates: string; bullets: string[] }[]
  education: { degree: string; institution: string; dates: string }[]
  certifications: string[]
  awards: string[]
  publications: string[]
  section_order: string[]
  section_titles: Record<string, string>
}

export interface SavedTailoredResume {
  id: number
  source_analysis_id: number | null
  job_id: number | null
  job_title: string
  company: string | null
  resume_filename: string
  score_before: number | null
  score_after: number | null
  score_change: ScoreChange | null
  score_source: ScoreSource | null
  created_at: string
  download_url: string
}

export interface ResumeAutofill {
  name: string | null
  email: string | null
  phone: string | null
  linkedin: string | null
  location: string | null
  summary: string | null
  experiences: { title: string; company: string; dates: string; bullets: string[] }[]
  education: { degree: string; institution: string; dates: string }[]
  projects?: { name: string; tech: string; dates: string; bullets: string[] }[]
  skill_groups?: { category: string; items: string[] }[]
  certifications?: string[]
  awards?: string[]
  publications?: string[]
  confident_fields: string[]
  parsed_experience_count: number
  parsed_education_count: number
}
