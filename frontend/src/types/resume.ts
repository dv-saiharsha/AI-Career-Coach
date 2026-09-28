/* Wire types for the Resume Analyzer module, kept field-for-field with the
   backend Pydantic schemas (backend/app/schemas/resume.py). Deliberately
   separate from the legacy mock shapes in '@/types' (ResumeAnalysis,
   ATSBreakdown, etc.) — those describe data the real API does not return
   (flat percentage breakdowns, prioritized skill objects with fabricated
   recommendations), and nothing here should be reconciled with them. */

export interface KeywordFrequency {
  keyword: string
  present: boolean
  frequency: number
  /** True when the resume never states this term but the candidate's other
   *  skills entail it. A recruiter's literal keyword search still won't find
   *  it, so this is flagged distinctly from `present`. */
  implied: boolean
}

export interface BulletFeedback {
  bullet: string
  /** 0-100, with a real zero floor. */
  impact_rating: number
  has_strong_verb: boolean
  has_weak_opener: boolean
  has_metric: boolean
  has_tool_context: boolean
  metrics: string[]
  suggestions: string[]
}

export interface FormattingWarning {
  severity: string
  issue: string
  detail: string
}

export interface ParsingReadiness {
  readiness_score: number
  /** Three-valued: null means the column check could not run at all. */
  is_single_column: boolean | null
  detected_headers: string[]
  formatting_warnings: FormattingWarning[]
  column_check_skipped_reason: string | null
  extracted_characters: number
}

export interface ResumeDiagnostics {
  taxonomy_matched_skills: string[]
  taxonomy_missing_skills: string[]
  implied_skills: string[]
  bullet_impact_rating: number
  quantified_metrics_ratio: number
  strong_verb_ratio: number
  bullet_feedback: BulletFeedback[]
  /** Missing skills bucketed by domain, e.g. { "Cloud Infrastructure": [...] }. */
  domain_gaps: Record<string, string[]>
  parsing_readiness: ParsingReadiness | null
}

/** Returned by POST /resume/analyze and POST /resume/rescan.
 *
 * IMPORTANT: this full payload is not persisted anywhere retrievable by id —
 * only ats_score, filename and created_at survive into /resume/history and
 * /resume/on-file, and only a subset (matched/missing skills, via different
 * field names) survives into /resume/breakdown/{id}. See resumeService.ts's
 * module-level cache for how the frontend copes with that.
 */
export interface AnalysisResult {
  id: number
  ats_score: number
  missing_skills: string[]
  matched_skills: string[]
  extracted_skills: string[]
  keyword_analysis: KeywordFrequency[]
  suggestions: string[]
  created_at: string
  diagnostics: ResumeDiagnostics | null
}

export interface ResumeHistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

export interface RubricMetric {
  key: string
  label: string
  /** Points this metric contributes to the rubric total. */
  weight: number
  /** null means this metric's inputs were unavailable — not a zero. */
  score: number | null
  band: string
}

export interface ParseCheck {
  key: string
  name: string
  /** Three-valued: null means "could not check", distinct from "failed". */
  passed: boolean | null
  detail: string
  why: string
}

export interface ScoreIntegritySignal {
  signal: string
  value: number
  limit: number
  detail: string
}

/** Shape produced by resume_analyzer/integrity.py's assess(). The backend
 *  schema types this as a loose `dict`, so treat unknown fields defensively. */
export interface ScoreIntegrity {
  checked: boolean
  reason?: string
  stuffed: boolean
  signals: ScoreIntegritySignal[]
  measurements?: {
    keyword_density: number
    max_repetition: number
    verbatim_overlap: number
    lexical_diversity: number
  }
}

export interface ScoreBreakdown {
  analysis_id: number
  resume_filename: string
  model_score: number
  score_integrity: ScoreIntegrity | null
  rubric_total: number | null
  /** What rubric_total is actually out of — below 100 when a metric was skipped. */
  weight_applied: number
  skipped: string[]
  metrics: RubricMetric[]
  parse_checks: ParseCheck[]
  missing_keywords: string[]
  matched_keywords: string[]
}

export interface ResumeOnFile {
  has_resume: boolean
  analysis_id?: number
  filename?: string
  ats_score?: number | null
  band?: string
  scanned_at?: string
  scanned_against?: string | null
  size_bytes?: number | null
  can_rescan?: boolean
}

/** The scan stages the backend actually reports progress for, in order
 *  (resume_analyzer/services.py SCAN_STAGES). Named here rather than as
 *  ad-hoc strings so the UI's checklist can't silently drift from them. */
export const SCAN_STAGES = ['extracting', 'checking', 'analyzing', 'reconciling', 'diagnostics'] as const
export type ScanStage = (typeof SCAN_STAGES)[number]
