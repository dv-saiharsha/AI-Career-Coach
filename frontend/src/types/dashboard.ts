// Mirrors backend/app/schemas/dashboard.py + the schemas it composes
// (analytics.py, job.py, application.py, profile.py, resume_review.py).
// Field names are kept exactly as the API returns them (snake_case, except
// JobListingSchema/JobMatchSchema which the backend itself documents as
// camelCase) so this file stays a faithful contract, not a guess.

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

export interface ApplicationSchema {
  id: number
  job_title: string
  company: string
  location: string | null
  salary_range: string | null
  status: ApplicationStatus
  job_url: string | null
  job_description: string | null
  tailored_resume_id: number | null
  notes: string | null
  recruiter_name: string | null
  recruiter_email: string | null
  match_score: number | null
  applied_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ResumeMatchDetailSchema {
  score: number
  band: string
}

export interface SkillsMatchDetailSchema {
  score: number
  band: string
  matchingSkills: string[]
  missingSkills: string[]
  skillCategories: Record<string, string[]>
  prioritySkills: string[]
  learningRecommendations: string[]
}

export interface JobMatchSchema {
  overallMatch: number | null
  band: string | null
  resumeMatch: ResumeMatchDetailSchema | null
  skillsMatch: SkillsMatchDetailSchema | null
  explanation: string
  generatedBy: string
}

export interface JobListingSchema {
  id: string
  title: string
  company: string
  location: string
  workMode: 'Remote' | 'Hybrid' | 'On-site'
  salaryRange: string
  description?: string | null
  skills: string[]
  postedDaysAgo: number
  applyUrl: string
  companyLogo?: string | null
  domain?: string | null
  h1bSponsorship?: 'explicitly_sponsored' | 'no_sponsorship' | 'unmentioned' | null
  h1bEvidence?: string | null
  experienceLevel?: 'entry' | 'mid' | 'senior' | 'lead' | null
  employmentType?: 'full_time' | 'part_time' | 'contract' | 'internship' | null
  match?: JobMatchSchema | null
}

export interface ActivityItemSchema {
  id: number
  kind: 'resume' | 'interview'
  title: string
  score: number | null
  created_at: string | null
}

export interface NextActionSchema {
  key: string
  label: string
  description: string
  href: string
  priority: string
}

export interface AtsHistoryPointSchema {
  id: number
  date: string | null
  score: number
  label: string
}

export interface FunnelSchema {
  by_stage: Record<string, number>
  total_tracked: number
  reached_applied: number
  reached_interviewing: number
  reached_offer: number
  interview_rate: number | null
  offer_rate: number | null
}

/** progress_buckets() output — a scan's score, grouped into an ISO week
 * ("2026-W12") or a calendar month ("2026-03") bucket, keeping only the
 * last score recorded in that bucket. */
export interface ProgressBucketPoint {
  period: string
  score: number
}

export interface DashboardResumeSchema {
  resumes_analyzed: number
  avg_ats_score: number | null
  latest_ats_score: number | null
  best_ats_score: number | null
  latest_band: string
  latest_filename: string | null
  suggested_improvements: string[]
}

export interface DashboardApplicationsSchema {
  total: number
  active: number
  offers: number
  rejections: number
  success_rate: number | null
}

/** Interview scores throughout this schema (average_score, overall_score)
 * are on a 0-10 scale, NOT 0-100 — see interview_coach/reports.py, which
 * derives readiness_band via band(overall_score * 10). */
export interface DashboardInterviewReportSchema {
  session_id: number
  role: string
  category: string | null
  overall_score: number | null
  readiness_band: string | null
  completed_at: string | null
}

export interface DashboardInterviewSchema {
  completed_sessions: number
  average_score: number | null
  voice_answers_count: number
  latest_report: DashboardInterviewReportSchema | null
  prep_completed_count: number
}

export interface DashboardJobsSchema {
  top_matches: JobListingSchema[]
  latest: JobListingSchema[]
  missing_skills: string[]
  recruiter_perspective: string | null
}

export interface DashboardActivitySchema {
  recent_activity: ActivityItemSchema[]
  upcoming_interviews: ApplicationSchema[]
  recent_applications: ApplicationSchema[]
}

export interface DashboardAnalyticsSchema {
  ats_history: AtsHistoryPointSchema[]
  weekly_progress: ProgressBucketPoint[]
  monthly_progress: ProgressBucketPoint[]
  funnel: FunnelSchema
}

export interface DashboardHomeSchema {
  resume: DashboardResumeSchema
  applications: DashboardApplicationsSchema
  interview: DashboardInterviewSchema
  jobs: DashboardJobsSchema
  activity: DashboardActivitySchema
  analytics: DashboardAnalyticsSchema
  next_actions: NextActionSchema[]
}
