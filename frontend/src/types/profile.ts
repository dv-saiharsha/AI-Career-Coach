// Mirrors backend/app/schemas/profile.py exactly — field names and
// nullability match the FastAPI response/request models under
// backend/app/modules/user_profile/router.py (mounted at /api/user).

export interface ProfileSchema {
  onboarding_completed: boolean
  target_roles: string[]
  primary_resume_filename: string | null
  primary_resume_analysis_id: number | null
  bio: string | null
  current_title: string | null
  seniority: string | null
  primary_target_role: string | null
  avatar_url: string | null
}

// Partial update body for PATCH /user/profile. Every field is optional —
// only keys actually included are sent, matching the backend's
// exclude_unset semantics (an omitted field is left alone server-side).
export interface ProfileUpdatePayload {
  bio?: string
  current_title?: string
  seniority?: string
  primary_target_role?: string
  avatar_url?: string
  avatar_path?: string
  primary_resume_analysis_id?: number
  primary_resume_filename?: string
  target_roles?: string[]
}

export interface UserStatsSchema {
  resumes_analyzed: number
  interview_sessions: number
  avg_ats_score: number | null
  latest_ats_score: number | null
  latest_interview_score: number | null
}

export interface ActivityItemSchema {
  id: number
  kind: 'resume' | 'interview'
  title: string
  score: number | null
  created_at: string | null
}

export interface ActivityResponseSchema {
  items: ActivityItemSchema[]
}

export interface AccountDeletionResult {
  deleted: Record<string, number>
  sign_in_disabled: boolean
}

// Target roles are only ever writable within these bounds — mirrors
// MIN_TARGET_ROLES / MAX_TARGET_ROLES in backend/app/schemas/profile.py.
export const MIN_TARGET_ROLES = 3
export const MAX_TARGET_ROLES = 5
