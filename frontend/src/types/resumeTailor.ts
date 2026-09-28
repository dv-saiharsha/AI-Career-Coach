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
