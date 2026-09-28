// Types for the AI Cover Letter Generator, matching the real backend contract
// in backend/app/schemas/cover_letter.py and the shapes the endpoints it
// depends on actually return (backend/app/schemas/job.py,
// backend/app/schemas/resume.py). Kept local to this feature rather than
// merged into src/types/index.ts, which is mock-data shaped and owned
// elsewhere.

export type CoverLetterTone = 'professional' | 'confident' | 'concise'

export const COVER_LETTER_TONES: { value: CoverLetterTone; label: string; hint: string }[] = [
  { value: 'professional', label: 'Professional', hint: 'Measured and plain. Standard business register.' },
  { value: 'confident', label: 'Confident', hint: 'Direct and assertive. Same facts, stated without hedging.' },
  { value: 'concise', label: 'Concise', hint: 'As short as the content allows. Three tight paragraphs.' },
]

/** POST /api/cover-letter/generate request body — GenerateCoverLetterRequestSchema. */
export interface GenerateCoverLetterRequest {
  job_id: number
  analysis_id: number
  full_name?: string
  phone?: string
  linkedin?: string
  tone?: CoverLetterTone
}

/** POST /api/cover-letter/generate response — CoverLetterSchema. */
export interface CoverLetterResult {
  job_id: number
  analysis_id: number
  job_title: string
  company: string
  tone: string
  download_filename: string
  paragraphs: string[]
  grounded_in: string[]
  unsupported_claims: string[]
  pdf_base64: string | null
}

/** One row from GET /api/jobs (JobFeedSchema.jobs[i]) — only the fields this
 * page reads. `id` arrives as a numeric string (str(row.id) server-side); the
 * generate call needs it back as an int. */
export interface JobOption {
  id: string
  title: string
  company: string
  location: string
  workMode: 'Remote' | 'Hybrid' | 'On-site'
  salaryRange: string
  description: string | null
  postedDaysAgo: number
}

/** One row from GET /api/resume/history — ResumeHistoryItemSchema. */
export interface ResumeScanOption {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}
