// Mirrors backend/app/schemas/resume.py's ResumeHistoryItemSchema,
// backend/app/schemas/interview.py's InterviewHistoryItemSchema, and
// backend/app/schemas/application.py's ActivityItemSchema — the three
// endpoints the History page merges client-side (there is no combined
// history endpoint on the backend). Cover letters are deliberately not a
// fourth source: POST /cover-letter/generate has no persistence at all
// (confirmed in the Cover Letter Generator phase) — there is no real history
// to show for them.

export interface ResumeHistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

export type PrepCategory = 'hr' | 'technical' | 'behavioral' | 'screening' | 'scenario'

export interface InterviewHistoryItem {
  id: number
  role: string
  seniority: string
  category: PrepCategory | null
  status: string
  created_at: string
  // 0-10 scale (see dashboard.ts's note on DashboardInterviewSchema).
  average_score: number | null
  answered_count: number
  question_count: number
}

export interface ApplicationActivityItem {
  application_id: number
  job_title: string
  company: string
  from_status: string | null
  to_status: string
  changed_at: string
}

export type HistoryEntry =
  | ({ type: 'resume' } & ResumeHistoryItem)
  | ({ type: 'interview' } & InterviewHistoryItem)
  | ({ type: 'application' } & ApplicationActivityItem)
