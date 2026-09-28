// Types mirroring backend/app/schemas/application.py exactly. Read from disk
// at build time — do not hand-guess field names against memory of the old
// (deleted) Next.js frontend; that version's stage list and shapes are
// stale relative to the Milestone 8 pipeline expansion below.

/** Every pipeline stage the backend's CHECK constraint / Literal accepts.
 *  'viewed' is a passive, automatic signal (opening a job's detail pane) —
 *  never a manual drag-drop or dropdown target, per the model's own
 *  comments — so it is intentionally excluded from BOARD_STAGES /
 *  MANUAL_STAGES below even though it is a valid ApplicationStatus. */
export type ApplicationStatus =
  | 'viewed'
  | 'saved'
  | 'applied'
  | 'recruiter_contacted'
  | 'recruiter_screening'
  | 'online_assessment'
  | 'technical_interview'
  | 'manager_interview'
  | 'final_interview'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'

/** The twelve real stages, in board/lifecycle order (excludes 'viewed'). */
export const MANUAL_STAGES: readonly ApplicationStatus[] = [
  'saved',
  'applied',
  'recruiter_contacted',
  'recruiter_screening',
  'online_assessment',
  'technical_interview',
  'manager_interview',
  'final_interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]

export const STAGE_LABELS: Record<ApplicationStatus, string> = {
  viewed: 'Viewed',
  saved: 'Saved',
  applied: 'Applied',
  recruiter_contacted: 'Recruiter Contacted',
  recruiter_screening: 'Recruiter Screening',
  online_assessment: 'Online Assessment',
  technical_interview: 'Technical Interview',
  manager_interview: 'Manager Interview',
  final_interview: 'Final Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

/** Kanban column grouping. The model has twelve stages; a board with twelve
 *  mostly-empty columns is unusable, so this groups them into five columns
 *  for display while every persisted status is still one of the twelve
 *  above. `entry` is the stage a card takes when dropped into a column from
 *  outside it (see applicationsService.stageForColumn). */
export interface StageColumn {
  id: string
  label: string
  entry: ApplicationStatus
  members: readonly ApplicationStatus[]
}

export const STAGE_COLUMNS: readonly StageColumn[] = [
  { id: 'saved', label: 'Saved', entry: 'saved', members: ['saved'] },
  {
    id: 'applied',
    label: 'Applied',
    entry: 'applied',
    members: ['applied', 'recruiter_contacted'],
  },
  {
    id: 'interviewing',
    label: 'Interviewing',
    entry: 'recruiter_screening',
    members: [
      'recruiter_screening',
      'online_assessment',
      'technical_interview',
      'manager_interview',
      'final_interview',
    ],
  },
  { id: 'offer', label: 'Offer', entry: 'offer', members: ['offer', 'accepted'] },
  {
    id: 'closed',
    label: 'Closed',
    entry: 'rejected',
    members: ['rejected', 'withdrawn'],
  },
]

export interface ApplicationRecord {
  id: number
  job_title: string
  company: string
  location?: string | null
  salary_range?: string | null
  status: ApplicationStatus
  job_url?: string | null
  job_description?: string | null
  tailored_resume_id?: number | null
  notes?: string | null
  recruiter_name?: string | null
  recruiter_email?: string | null
  match_score?: number | null
  applied_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface PipelineResponse {
  pipeline: Record<string, ApplicationRecord[]>
  total: number
}

export interface StatusHistoryEntry {
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  changed_at: string
}

export interface ActivityItem extends StatusHistoryEntry {
  application_id: number
  job_title: string
  company: string
}

export interface ResumeSummary {
  analysis_id: number
  filename: string
  ats_score: number
  band: string
  scanned_at: string
}

export interface JobMatchSummary {
  overall_match?: number | null
  band?: string | null
  matching_skills: string[]
  missing_skills: string[]
  explanation: string
}

export interface InterviewSummary {
  session_id: number
  overall_score: number
  readiness_band: string
  topics_to_improve: string[]
  completed_at: string
}

export interface ApplicationDetail {
  application: ApplicationRecord
  status_history: StatusHistoryEntry[]
  resume?: ResumeSummary | null
  job_match?: JobMatchSummary | null
  interview?: InterviewSummary | null
  has_in_progress_interview: boolean
}

export interface ApplicationCreateInput {
  job_title: string
  company: string
  location?: string
  salary_range?: string
  status?: ApplicationStatus
  job_url?: string
  // Create-only: ApplicationUpdateSchema on the backend has no
  // job_description field, so once set here it can't be edited later — only
  // read back in the detail view. It's what powers the cross-engine Job
  // Match summary (services.py's _job_match_summary needs it to compare
  // against a resume), so it's worth collecting at creation time even though
  // nothing downstream can change it afterward.
  job_description?: string
  notes?: string
  recruiter_name?: string
  recruiter_email?: string
}

export interface ApplicationUpdateInput {
  job_title?: string
  company?: string
  location?: string | null
  salary_range?: string | null
  status?: ApplicationStatus
  job_url?: string | null
  notes?: string | null
  recruiter_name?: string | null
  recruiter_email?: string | null
}
