import { http as apiClient } from './http'
import type { ScoreBand } from './scoreBands'

// Auth (session, login/register/logout) lives entirely in AuthContext now,
// backed by Supabase. The bearer token is attached by lib/http, which also
// owns the base URL — this file only describes endpoints and their shapes.

export interface KeywordFrequency {
  keyword: string
  present: boolean
  frequency: number
  /**
   * Matched by implication, not stated. The candidate's other skills entail
   * it (PyTorch → deep learning), but a literal ATS keyword search still
   * won't find it — so it's shown differently from a stated match.
   */
  implied?: boolean
}

export interface BulletFeedback {
  bullet: string
  /** 0-100, with a real zero floor — no verb and no metric scores 0. */
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
  /** What to change — kept beside the issue rather than flattened away. */
  detail: string
}

/**
 * Structural readiness, independent of content. A resume can name every
 * keyword a job asks for and still fail here: a two-column layout or an
 * image-only export is unreadable to a parser however well it's written.
 */
export interface ParsingReadiness {
  readiness_score: number
  /**
   * Three-valued. null means the check could not run (no PDF, or a DOCX
   * PyMuPDF can't open) — reporting that as single-column would be a claim
   * with no evidence behind it.
   */
  is_single_column: boolean | null
  detected_headers: string[]
  formatting_warnings: FormattingWarning[]
  column_check_skipped_reason: string | null
  extracted_characters: number
}

/** Explains the score; never competes with it. ats_score stays the model's. */
export interface Diagnostics {
  taxonomy_matched_skills: string[]
  taxonomy_missing_skills: string[]
  implied_skills: string[]
  bullet_impact_rating: number
  quantified_metrics_ratio: number
  strong_verb_ratio: number
  bullet_feedback: BulletFeedback[]
  domain_gaps: Record<string, string[]>
  /** Absent on scans stored before layout checking existed. */
  parsing_readiness?: ParsingReadiness | null
}

export interface AnalysisResult {
  id: number
  ats_score: number
  missing_skills: string[]
  matched_skills: string[]
  extracted_skills: string[]
  keyword_analysis: KeywordFrequency[]
  suggestions: string[]
  created_at: string
  /** Absent on scans stored before diagnostics existed. */
  diagnostics?: Diagnostics | null
}

export const analyzeResume = async (
  formData: FormData,
  onUploadProgress?: (percent: number) => void,
): Promise<AnalysisResult> => {
  const response = await apiClient.post<AnalysisResult>('/resume/analyze', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (!onUploadProgress) return
      const total = evt.total ?? evt.loaded
      onUploadProgress(total ? Math.round((evt.loaded / total) * 100) : 100)
    },
  })
  return response.data
}

/** What resume the account already has, if any. */
export interface ResumeOnFile {
  has_resume: boolean
  /** False for rows stored before the file bytes were retained. */
  can_rescan: boolean
  analysis_id?: number
  filename?: string
  ats_score?: number | null
  band?: string
  scanned_at?: string | null
  scanned_against?: string | null
  size_bytes?: number | null
}

export const getResumeOnFile = async (): Promise<ResumeOnFile> => {
  const response = await apiClient.get<ResumeOnFile>('/resume/on-file')
  return response.data
}

/**
 * Score the stored resume against a new posting, with no upload.
 *
 * The whole point is that there is no FormData here — the bytes are already
 * on the server. Re-uploading an unchanged CV to score it against a second
 * job was work the product was inventing for people, and it stored another
 * copy of identical bytes each time.
 */
export const rescanResume = async (jobDescription: string): Promise<AnalysisResult> => {
  const response = await apiClient.post<AnalysisResult>('/resume/rescan', {
    job_description: jobDescription,
  })
  return response.data
}

/** Mirrors backend OptimizeEditSchema exactly. */
export interface OptimizeEdit {
  edit: string
  label: string
  rationale: string
  adds: string[]
  applied: boolean
  requires_review: boolean
  score_after: number | null
  delta: number | null
  potential_score: number | null
  reason: string | null
}

/** Mirrors backend OptimizePlanSchema — see resume_builder/optimizer.py for
 *  why this stops at ~85 rather than promising 95+. */
export interface OptimizePlan {
  available: boolean
  reason: string | null
  baseline_score: number | null
  projected_score: number | null
  target_band: number[]
  in_band: boolean
  beyond_meaningful: boolean
  integrity: {
    checked: boolean
    stuffed: boolean
    reason?: string
    signals: { signal: string; detail: string }[]
  }
  edits: OptimizeEdit[]
  note: string | null
}

/**
 * A scored, honest plan against the resume already on file for this scan.
 *
 * Replaces a client-side formula this UI used to show — matched keywords
 * over total, times 100 — which was never connected to the trained model
 * that actually produces ats_score. It could show "92% projected" for an
 * edit the real model would score at 60, because it measured keyword count,
 * not what the model responds to. This calls the model directly instead.
 */
export const getOptimizePlan = async (
  analysisId: number,
  jobDescription: string,
): Promise<OptimizePlan> => {
  const response = await apiClient.post<OptimizePlan>(
    `/resume-builder/optimize-plan/${analysisId}`,
    { job_description: jobDescription },
  )
  return response.data
}

export interface ResumeHistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

export const getResumeHistory = async (): Promise<ResumeHistoryItem[]> => {
  const response = await apiClient.get<ResumeHistoryItem[]>('/resume/history')
  return response.data
}

export const downloadResumeReport = async (analysisId: number, filename = 'resume-report.pdf') => {
  const response = await apiClient.get<Blob>(`/resume/report/${analysisId}`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/** Opens the candidate's own uploaded file in a new tab, unaltered.
 *  Distinct from downloadResumeReport, which is the generated feedback PDF. */
export const viewOriginalResume = async (analysisId: number) => {
  const response = await apiClient.get<Blob>(`/resume/file/${analysisId}`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(response.data)
  window.open(url, '_blank', 'noopener,noreferrer')
  // Revoked on a delay rather than immediately: the new tab needs the blob to
  // still be alive when it loads, and revoking synchronously races that.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
}

/** Deletes the scan and clears it from the profile if it was the primary. */
export const deleteResumeAnalysis = async (analysisId: number): Promise<void> => {
  await apiClient.delete(`/resume/${analysisId}`)
}

export type PrepCategory = 'hr' | 'technical' | 'behavioral' | 'screening' | 'scenario'
export type PrepDifficulty = 'easy' | 'medium' | 'hard'

export interface InterviewQuestion {
  id: number
  text: string
  type: string
  sequence_order: number
}

export const generateInterviewQuestions = async (payload: {
  role: string
  seniority: string
  category: PrepCategory
}): Promise<{ session_id: number; role: string; seniority: string; category: PrepCategory; questions: InterviewQuestion[] }> => {
  const response = await apiClient.post<{ session_id: number; role: string; seniority: string; category: PrepCategory; questions: InterviewQuestion[] }>('/interview/questions', payload)
  return response.data
}

// The seven dimensions every Mock Interview answer is scored on — mirrors
// evaluation.py's DIMENSION_LABELS exactly, so a dimension key never has to
// be prettified twice under two different rules.
export const DIMENSION_LABELS: Record<string, string> = {
  technical_accuracy: 'Technical Accuracy',
  completeness: 'Completeness',
  communication: 'Communication',
  structure: 'Structure',
  problem_solving: 'Problem Solving',
  relevance: 'Relevance',
  practical_thinking: 'Practical Thinking',
}

export interface InterviewFeedback {
  score: number
  dimension_scores: Record<string, number>
  strengths: string[]
  weaknesses: string[]
  missing_points: string[]
  learning_suggestions: string[]
  /** The candidate's own answer, rewritten to fix the gaps found above. */
  sample_answer?: string | null
  voice_metrics?: VoiceMetrics | null
}

export const evaluateInterviewAnswer = async (payload: {
  question_id: number
  answer_text: string
  voice_metrics?: VoiceMetrics | null
}): Promise<InterviewFeedback> => {
  const response = await apiClient.post<InterviewFeedback>('/interview/evaluate', payload)
  return response.data
}

// ── Voice Interview ─────────────────────────────────────────────────────
//
// Voice is an input method, not a second interview system: the accepted
// transcript flows into evaluateInterviewAnswer above exactly like a typed
// answer. This is the one new endpoint — pure transformation, touches no
// session/question/answer row. No audio is ever stored past this call.

/** Every field independently optional — omitted, not fabricated, when
 *  Deepgram's response couldn't support it for that recording. */
export interface VoiceMetrics {
  speaking_duration_seconds?: number | null
  average_confidence?: number | null
  speaking_rate_wpm?: number | null
  long_pause_count?: number | null
  filler_word_count?: number | null
}

export interface TranscribeResult {
  transcript: string
  voice_metrics: VoiceMetrics
}

export const transcribeInterviewAnswer = async (
  audioBlob: Blob,
  filename: string,
  onUploadProgress?: (percent: number) => void,
): Promise<TranscribeResult> => {
  const formData = new FormData()
  formData.append('audio', audioBlob, filename)
  const response = await apiClient.post<TranscribeResult>('/interview/transcribe', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (!onUploadProgress) return
      const total = evt.total ?? evt.loaded
      onUploadProgress(total ? Math.round((evt.loaded / total) * 100) : 100)
    },
  })
  return response.data
}

// ── Mock Interview session lifecycle (the Interview Engine) ────────────────
//
// A session persists every answer the moment it's submitted, so "Continue
// Later" and surviving a refresh both just mean: re-fetch the active session
// and rehydrate local state from it — there is no separate resume endpoint.

export interface ActiveAnswer extends InterviewFeedback {
  answer_text: string
}

export interface ActiveQuestion extends InterviewQuestion {
  answer: ActiveAnswer | null
}

export interface ActiveSession {
  session_id: number
  role: string
  seniority: string
  category: PrepCategory
  status: 'in_progress' | 'completed' | 'abandoned'
  questions: ActiveQuestion[]
}

/** Null when the user has no interview in progress. */
export const getActiveInterviewSession = async (): Promise<ActiveSession | null> => {
  const response = await apiClient.get<ActiveSession | null>('/interview/sessions/active')
  return response.data
}

/** Powers Restart Interview — abandon the current attempt, then call
 *  generateInterviewQuestions again for a fresh one. */
export const abandonInterviewSession = async (sessionId: number): Promise<void> => {
  await apiClient.post(`/interview/sessions/${sessionId}/abandon`)
}

export interface QuestionFeedback extends InterviewFeedback {
  question_id: number
  question_text: string
  answer_text: string
}

export interface CategoryPerformance {
  key: string
  label: string
  average_score: number
}

// NextAction is declared once, further down alongside ResumeReview — the
// same {key,label,description,href,priority} shape Resume Review already
// established, reused here rather than a second copy for this module.

export interface SessionReport {
  session_id: number
  role: string
  seniority: string
  category: PrepCategory
  overall_score: number
  readiness_band: ScoreBand
  performance_summary: string
  question_feedback: QuestionFeedback[]
  category_performance: CategoryPerformance[]
  strongest_skills: string[]
  weakest_skills: string[]
  topics_to_improve: string[]
  practice_plan: string[]
  next_actions: NextAction[]
}

export const getInterviewSessionReport = async (sessionId: number): Promise<SessionReport> => {
  const response = await apiClient.get<SessionReport>(`/interview/sessions/${sessionId}/report`)
  return response.data
}

export interface ModelAnswer {
  ideal_answer: string
  example: string
  plain_explanation: string
  key_points: string[]
}

export const getInterviewModelAnswer = async (questionId: number): Promise<ModelAnswer> => {
  const response = await apiClient.post<ModelAnswer>('/interview/model-answer', { question_id: questionId })
  return response.data
}

export const generateImprovedResume = async (
  analysisId: number,
  fullName: string,
  selectedSkills: string[],
  /** Overrides the default download name. The tailor flow passes the
   *  backend's FAANG-convention filename so the file a recruiter receives is
   *  named LASTNAME_FIRSTNAME_RESUME_ROLE_COMPANY.pdf. */
  filename?: string,
): Promise<void> => {
  const response = await apiClient.post<Blob>(
    `/resume/generate/${analysisId}`,
    { full_name: fullName, skills_to_add: selectedSkills },
    { responseType: 'blob' },
  )
  const safeName = fullName.trim().toLowerCase().replace(/\s+/g, '-') || 'resume'
  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `resume-${safeName}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export interface ScreeningQuestion {
  id: string
  type: string
  question: string
  /**
   * A scaffold with [bracketed placeholders], not a script to read verbatim.
   * The backend prompt forbids asserting achievements on the candidate's
   * behalf, so the UI must present this as something to fill in.
   */
  answer_template: string
  key_signal: string
  what_to_avoid: string
}

export interface InterviewTip {
  title: string
  rule: string
}

export interface ScreeningPrep {
  job_title: string
  company: string
  screening_questions: ScreeningQuestion[]
  general_interview_tips: InterviewTip[]
}

export const generateScreeningPrep = async (payload: {
  job_title: string
  company?: string
  jd_text?: string
  resume_analysis_id?: number | null
}): Promise<ScreeningPrep> => {
  const response = await apiClient.post<ScreeningPrep>('/interview/screening-prep', payload)
  return response.data
}

export interface InterviewHistoryItem {
  id: number
  role: string
  seniority: string
  /** Null for sessions created before the Mock Interview category scheme existed. */
  category: PrepCategory | null
  status: 'in_progress' | 'completed' | 'abandoned'
  created_at: string
  average_score: number | null
  answered_count: number
  question_count: number
}

export const getInterviewHistory = async (): Promise<InterviewHistoryItem[]> => {
  const response = await apiClient.get<InterviewHistoryItem[]>('/interview/history')
  return response.data
}

// ── Interview Preparation (teaching, not testing) ──────────────────────────
//
// Distinct from the drills flow above: nothing here is gated behind an
// attempt. A question's full content — answer, explanations, tips — is
// returned the moment it's fetched. Shared cache server-side (generated once
// per role+category, not per user); only bookmark/completed/notes are
// user-specific.

export interface PrepQuestionUserState {
  bookmarked: boolean
  completed: boolean
  notes: string | null
}

export interface PrepQuestion {
  id: number
  category: PrepCategory
  difficulty: PrepDifficulty
  text: string
  estimated_answer_time: string
  ideal_answer: string
  concept_explanation: string
  beginner_explanation: string
  real_world_example: string
  /** What the interviewer is actually testing — stated outright. */
  interviewer_intent: string
  interview_tips: string[]
  common_mistakes: string[]
  important_keywords: string[]
  follow_up_questions: string[]
  user_state: PrepQuestionUserState | null
}

export interface PrepQuestionsResponse {
  role: string
  category: PrepCategory
  questions: PrepQuestion[]
}

export const getPrepQuestions = async (role: string, category: PrepCategory): Promise<PrepQuestionsResponse> => {
  const response = await apiClient.get<PrepQuestionsResponse>('/interview/prep/questions', { params: { role, category } })
  return response.data
}

export interface PrepQuestionStateUpdate {
  bookmarked?: boolean
  completed?: boolean
  notes?: string | null
}

export const updatePrepQuestionState = async (
  questionId: number,
  payload: PrepQuestionStateUpdate,
): Promise<PrepQuestionUserState> => {
  const response = await apiClient.patch<PrepQuestionUserState>(`/interview/prep/questions/${questionId}/state`, payload)
  return response.data
}

// ── Job market ───────────────────────────────────────────────────────────

export type WorkMode = 'Remote' | 'Hybrid' | 'On-site'

export interface JobListing {
  id: string
  title: string
  company: string
  location: string
  workMode: WorkMode
  salaryRange: string
  /** Full posting text. Null for rows cached before the column existed. */
  description: string | null
  skills: string[]
  /** Days since the employer posted it — not since we indexed it. */
  postedDaysAgo: number
  applyUrl: string

  /**
   * What the posting SAYS about sponsorship — never a prediction of what the
   * employer will do. null means nobody has classified this posting yet,
   * which is different from "no sponsorship" and must render differently.
   */
  h1bSponsorship?: 'explicitly_sponsored' | 'no_sponsorship' | 'unmentioned' | null
  /** The sentence the classification was read from, so it can be judged. */
  h1bEvidence?: string | null
  experienceLevel?: 'entry' | 'mid' | 'senior' | 'lead' | null
  employmentType?: 'full_time' | 'part_time' | 'contract' | 'internship' | null
  /** Brand icon. May 404 — the backend guesses the domain from the company
   *  name — so the card must render a monogram fallback on error. */
  companyLogo?: string | null
  /** Which JOB_DOMAINS group this role belongs to. Null for on-demand
   *  searches outside the warm set. */
  domain?: string | null
  /** null when the caller has no primary resume on file — matching is
   *  skipped entirely in that case, not computed against a placeholder. */
  match?: JobFeedMatch | null
}

export interface SkillsMatchDetail {
  score: number
  band: ScoreBand
  matchingSkills: string[]
  missingSkills: string[]
  skillCategories: Record<string, string[]>
  /** Ranked by how many OTHER listings in the same feed also need them —
   *  the skill most worth learning is the one that unlocks the most of
   *  what's currently on screen, not just this one posting. */
  prioritySkills: string[]
  learningRecommendations: string[]
}

/**
 * One listing's match against the caller's primary resume.
 *
 * Named distinctly from `JobMatch` (Resume Review's single resume-vs-one-
 * pasted-JD score) — this is feed-scoped and richer, not the same concept
 * reused under one name for two different shapes.
 *
 * `overallMatch` is Resume Match's own score, never blended with Skills
 * Match — each dimension stays inspectable on its own rather than
 * disappearing into a weighted average nobody can unpack.
 */
export interface JobFeedMatch {
  overallMatch: number | null
  band: ScoreBand | null
  resumeMatch: { score: number; band: ScoreBand } | null
  skillsMatch: SkillsMatchDetail | null
  explanation: string
  generatedBy: 'deterministic' | 'llm'
}

export interface JobFilterCounts {
  h1b: Record<string, number>
  experience: Record<string, number>
  employment: Record<string, number>
  /** Rows never classified — surfaced so the UI can say the filters are partial. */
  unenriched: number
}

export interface JobFilters {
  h1b?: string | null
  experience?: string | null
  employment?: string | null
}

export interface JobFeed {
  /** ISO timestamp of the newest cached listing, or null on a cold cache. */
  lastUpdated: string | null
  jobs: JobListing[]
  /** Counts from the unfiltered feed, for pill labels. */
  filterCounts?: JobFilterCounts | null
  /**
   * A background scrape for this query is in flight. The listings shown are
   * cached; fresher ones will exist on the next load. The request itself
   * never waits on the scraper — that used to block for minutes.
   */
  refreshing?: boolean
  /** When the hourly board sweep next runs. Null when no scheduler is
   *  running in that process — the UI then says nothing rather than
   *  implying a cadence nobody is keeping. */
  next_sync_at?: string | null
}

/**
 * Job feed. Reads cache only and returns immediately; a query with no cached
 * results queues a scrape server-side rather than making the caller wait.
 */
export const getJobs = async (q?: string, filters?: JobFilters): Promise<JobFeed> => {
  // Undefined keys are dropped by lib/http, so an unset filter never reaches the
  // backend as an empty string it would have to special-case.
  const params: Record<string, string> = {}
  if (q) params.q = q
  if (filters?.h1b) params.h1b = filters.h1b
  if (filters?.experience) params.experience = filters.experience
  if (filters?.employment) params.employment = filters.employment

  const response = await apiClient.get<JobFeed>('/jobs', {
    params: Object.keys(params).length ? params : undefined,
  })
  return response.data
}

// ── User profile, onboarding, and dashboard metrics ──────────────────────
//
// None of these take a user id. Identity comes from the Supabase JWT that the
// request interceptor above attaches, and the backend reads it from the
// verified token — passing an id from the client would let any caller read
// any account by changing a string.

export interface UserProfile {
  onboarding_completed: boolean
  target_roles: string[]
  primary_resume_filename: string | null
  primary_resume_analysis_id: number | null
  bio: string | null
  /** Named current_title, not current_role — the latter is a reserved SQL keyword. */
  current_title: string | null
  seniority: string | null
  /** Single aspirational role. Distinct from target_roles, which drives the job feed. */
  primary_target_role: string | null
  avatar_url: string | null
}

/**
 * Partial profile update. Omitted keys are left untouched server-side; an
 * empty string clears the field to NULL. That distinction is what lets the
 * avatar delete flow null `avatar_url` without a bio-only save wiping it.
 */
export interface ProfileUpdate {
  bio?: string
  current_title?: string
  seniority?: string
  primary_target_role?: string
  avatar_url?: string
  avatar_path?: string
  /** Set by the dashboard resume reminder when upload was skipped at onboarding. */
  primary_resume_analysis_id?: number | null
  primary_resume_filename?: string | null
  /**
   * The roles the job feed is built from.
   *
   * Omit the key to leave them untouched — the backend treats an absent
   * field as "no change", so editing a bio does not wipe the feed. Sending
   * fewer than three distinct roles is rejected with a 422.
   */
  target_roles?: string[]
}

export const updateUserProfile = async (patch: ProfileUpdate): Promise<UserProfile> => {
  const response = await apiClient.patch<UserProfile>('/user/profile', patch)
  return response.data
}

export interface UserStats {
  resumes_analyzed: number
  interview_sessions: number
  /** null, not 0, when there is nothing to average — a new user has no score. */
  avg_ats_score: number | null
  latest_ats_score: number | null
  latest_interview_score: number | null
}

export interface ActivityItem {
  id: number
  kind: 'resume' | 'interview'
  title: string
  score: number | null
  created_at: string
}

export const getUserProfile = async (): Promise<UserProfile> => {
  const response = await apiClient.get<UserProfile>('/user/profile')
  return response.data
}

export interface OnboardingPayload {
  target_roles: string[]
  primary_resume_analysis_id?: number | null
  primary_resume_filename?: string | null
}

export const completeOnboarding = async (payload: OnboardingPayload): Promise<UserProfile> => {
  const response = await apiClient.post<UserProfile>('/user/onboarding', payload)
  return response.data
}

/** Marks onboarding done without roles. A separate endpoint because
 *  /user/onboarding enforces a 3-5 role bound that an empty list fails. */
export const skipOnboarding = async (): Promise<UserProfile> => {
  const response = await apiClient.post<UserProfile>('/user/onboarding/skip')
  return response.data
}

export const getUserStats = async (): Promise<UserStats> => {
  const response = await apiClient.get<UserStats>('/user/stats')
  return response.data
}

export const getUserActivity = async (): Promise<ActivityItem[]> => {
  const response = await apiClient.get<{ items?: ActivityItem[] }>('/user/activity')
  return response.data.items ?? []
}

// ── Resume Builder: structured single-page LaTeX resume + honest re-score ──
//
// ats_score and semantic_match both come straight through from the backend's
// trained model / tfidf_cosine (see resume_builder/services.py) — nothing is
// recomputed client-side.

export interface BuilderExperienceEntry {
  title: string
  company: string
  dates: string
  bullets: string[]
}

export interface BuilderEducationEntry {
  degree: string
  institution: string
  dates: string
}

export interface BulletSuggestion {
  experience_index: number
  original: string
  suggested: string
  reason: string
}

export interface StageFixesResult {
  missing_keywords: string[]
  bullet_suggestions: BulletSuggestion[]
}

export const stageResumeFixes = async (
  analysisId: number,
  experiences?: BuilderExperienceEntry[],
): Promise<StageFixesResult> => {
  const response = await apiClient.post<StageFixesResult>(`/resume-builder/stage-fixes/${analysisId}`, {
    experiences: experiences?.length ? experiences : undefined,
  })
  return response.data
}

export interface BulletEvaluation {
  bullet: string
  /** 0-3: strong verb, metric, tool context. A count, not a percentage. */
  grade: number
  has_strong_verb: boolean
  has_weak_opener: boolean
  has_metric: boolean
  has_tool_context: boolean
  metrics: string[]
  suggestions: string[]
}

export interface BulletReport {
  bullet_count: number
  quantified_ratio: number
  strong_verb_ratio: number
  weak_opener_count: number
  average_grade: number
  bullets: BulletEvaluation[]
}

export interface SkillContext {
  skill: string
  found: boolean
  sections: string[]
  occurrences: number
  /** Best section the skill appears in, halved when it looks stuffed. */
  weight: number
  stuffed: boolean
}

export interface RoleRecency {
  title: string
  company: string
  dates: string
  /** null when no year parsed — unknown, never treated as old. */
  end_year: number | null
  recency_credit: number
}

/**
 * Diagnostics only. Deliberately carries no score: ats_score stays with the
 * trained model, and this explains *why* a resume reads weak instead.
 */
export interface QualityReport {
  bullets: BulletReport
  skill_contexts: SkillContext[]
  role_recency: RoleRecency[]
  domain_gaps: Record<string, string[]>
  /**
   * Present on stored scans too. is_single_column is null when the row has no
   * stored PDF — header and extractability feedback still compute, only the
   * column verdict is unknown.
   */
  parsing_readiness?: ParsingReadiness | null
}

/** Free — pure text analysis, no LLM call, so it's safe to call on every scan. */
export const getQualityReport = async (analysisId: number): Promise<QualityReport> => {
  const response = await apiClient.post<QualityReport>(`/resume-builder/quality-report/${analysisId}`)
  return response.data
}

export interface ReviewCategory {
  key: string
  label: string
  score: number | null
  band: ScoreBand
  /** high | medium | low | none — ranked by recoverable weight, not raw score. */
  priority: 'high' | 'medium' | 'low' | 'none'
  /** What this dimension measures. */
  explanation: string
  /** What *this* resume did — the score can be argued with. */
  reason: string
  improvements: string[]
  available: boolean
}

export interface ResumeHealth {
  score: number | null
  band: ScoreBand
  weight_applied: number
  skipped: string[]
}

export interface JobMatch {
  score: number
  band: ScoreBand
  source: string
}

export interface BulletImprovement {
  bullet: string
  grade: number
  has_strong_verb: boolean
  has_metric: boolean
  has_tool_context: boolean
  suggestions: string[]
}

export interface NextAction {
  key: string
  label: string
  description: string
  href: string
  priority: 'high' | 'medium' | 'low' | 'none'
}

export interface ResumeReview {
  analysis_id: number | null
  resume_filename: string | null
  /** general | job_specific — derived server-side from whether a job description exists. */
  mode: 'general' | 'job_specific'
  resume_health: ResumeHealth
  /** Present only in job_specific mode — the trained model's own score, never re-derived. */
  job_match: JobMatch | null
  categories: ReviewCategory[]
  missing_skills: string[]
  matched_skills: string[]
  missing_keywords: string[]
  bullet_improvements: BulletImprovement[]
  next_actions: NextAction[]
  generated_by: 'deterministic' | 'llm'
}

/** Job-specific review (Mode B) for an existing scan. Free, no write —
 *  parallels getQualityReport's cost profile. */
export const getResumeReview = async (analysisId: number): Promise<ResumeReview> => {
  const response = await apiClient.get<ResumeReview>(`/resume/review/${analysisId}`)
  return response.data
}

export interface CompileResumeRequest {
  job_description: string
  candidate_name: string
  location?: string
  email?: string
  phone?: string
  linkedin?: string
  summary?: string
  technical_skills?: string[]
  tools_skills?: string[]
  experiences?: BuilderExperienceEntry[]
  education?: BuilderEducationEntry[]
}

export interface CompileResumeResult {
  ats_score: number
  semantic_match: number
  keyword_matched_count: number
  keyword_total_count: number
  page_count: number
  pdf_base64: string
}

export const compileResume = async (payload: CompileResumeRequest): Promise<CompileResumeResult> => {
  const response = await apiClient.post<CompileResumeResult>('/resume-builder/compile-and-score', payload)
  return response.data
}

export const downloadCompiledResumePdf = (pdfBase64: string, candidateName: string) => {
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  const url = window.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const safeName = candidateName.trim().toLowerCase().replace(/\s+/g, '-') || 'resume'
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeName}-ats-optimized.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// ── Application pipeline ─────────────────────────────────────────────────
//
// No user id is ever sent. Identity comes from the Supabase JWT the request
// interceptor attaches, and the backend reads it from the verified token —
// passing an id from the client would let any caller read or move another
// account's applications by editing a string.

// Expanded in Milestone 8 from the original 5 stages (saved/applied/
// interviewing/offer/rejected) into the real shape of a hiring pipeline.
export const APPLICATION_STAGES = [
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
] as const
export type ApplicationStatus = (typeof APPLICATION_STAGES)[number]

export interface JobApplication {
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
  /** Lazily computed elsewhere (the Dashboard); read-only here. 0-100. */
  match_score: number | null
  /** Set the first time the card reaches "applied", never rewritten after. */
  applied_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Pipeline {
  /** Every stage key is always present, so an empty column still renders. */
  pipeline: Record<ApplicationStatus, JobApplication[]>
  total: number
}

export interface CreateApplicationPayload {
  job_title: string
  company: string
  location?: string | null
  salary_range?: string | null
  status?: ApplicationStatus
  job_url?: string | null
  job_description?: string | null
  tailored_resume_id?: number | null
  notes?: string | null
  recruiter_name?: string | null
  recruiter_email?: string | null
}

export const getApplicationPipeline = async (): Promise<Pipeline> => {
  const response = await apiClient.get<Pipeline>('/applications/pipeline')
  return response.data
}

export const createApplication = async (
  payload: CreateApplicationPayload,
): Promise<JobApplication> => {
  const response = await apiClient.post<JobApplication>('/applications', payload)
  return response.data
}

export const updateApplicationStatus = async (
  applicationId: number,
  status: ApplicationStatus,
): Promise<JobApplication> => {
  const response = await apiClient.patch<JobApplication>(`/applications/${applicationId}/status`, { status })
  return response.data
}

/** Partial — omitted keys are left untouched server-side. */
export const updateApplication = async (
  applicationId: number,
  patch: Partial<Omit<JobApplication, 'id' | 'created_at' | 'updated_at' | 'applied_at'>>,
): Promise<JobApplication> => {
  const response = await apiClient.patch<JobApplication>(`/applications/${applicationId}`, patch)
  return response.data
}

export const deleteApplication = async (applicationId: number): Promise<void> => {
  await apiClient.delete(`/applications/${applicationId}`)
}

// -- Milestone 8: status history, activity feed, cross-engine detail -------
//
// Everything below is read-only aggregation the backend already computed
// from the Resume, Job Matching, and Interview engines — see
// applications/services.py's get_application_detail. No new scoring logic
// lives on this side either.

export interface StatusHistoryEntry {
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  changed_at: string
}

// Named distinctly from the user-level ActivityItem above (resume scans /
// interview sessions) — this is an application status-change event, a
// different concept that happened to share the obvious name.
export interface ApplicationActivityItem extends StatusHistoryEntry {
  application_id: number
  job_title: string
  company: string
}

export interface ResumeSummary {
  analysis_id: number
  filename: string
  ats_score: number
  band: ScoreBand
  scanned_at: string
}

export interface JobMatchSummary {
  overall_match: number | null
  band: ScoreBand | null
  matching_skills: string[]
  missing_skills: string[]
  explanation: string
}

export interface InterviewSummary {
  session_id: number
  overall_score: number
  readiness_band: ScoreBand
  topics_to_improve: string[]
  completed_at: string
}

export interface ApplicationDetail {
  application: JobApplication
  status_history: StatusHistoryEntry[]
  resume: ResumeSummary | null
  job_match: JobMatchSummary | null
  interview: InterviewSummary | null
  has_in_progress_interview: boolean
}

export const getApplicationDetail = async (applicationId: number): Promise<ApplicationDetail> => {
  const response = await apiClient.get<ApplicationDetail>(`/applications/${applicationId}`)
  return response.data
}

/** Every status change across the whole pipeline, newest first — powers the
 *  Timeline view. */
export const getApplicationActivity = async (): Promise<ApplicationActivityItem[]> => {
  const response = await apiClient.get<ApplicationActivityItem[]>('/applications/activity')
  return response.data
}

// ── Offer comparison ─────────────────────────────────────────────────────

export interface JobOffer {
  id: number
  company: string
  role_title: string
  application_id: number | null
  base_salary: number
  annual_bonus: number
  signing_bonus: number
  equity_value_annual: number
  location: string | null
  is_remote: boolean
  notes: string | null
  /** Includes the signing bonus — year one only. */
  total_first_year: number
  /** Excludes the signing bonus — what the offer is worth every year after. */
  recurring_annual: number
  /** User-entered. null means not supplied, distinct from 0 (no income tax). */
  estimated_tax_rate: number | null
  /** User-entered. 1.15 = 15% more expensive. null means no adjustment. */
  col_index: number | null
  /** recurring x (1 - tax) / col. Equals recurring_annual when unadjusted. */
  net_adjusted_comp: number
  /** False when nothing was applied — the UI says so rather than implying
   * the raw figure was somehow verified as net. */
  is_adjusted: boolean
  created_at: string | null
  updated_at: string | null
}

export interface OfferList {
  offers: JobOffer[]
  count: number
}

export interface CreateOfferPayload {
  company: string
  role_title: string
  base_salary: number
  annual_bonus?: number
  signing_bonus?: number
  equity_value_annual?: number
  location?: string | null
  is_remote?: boolean
  notes?: string | null
  application_id?: number | null
  estimated_tax_rate?: number | null
  col_index?: number | null
}

export const getOffers = async (): Promise<OfferList> => {
  const response = await apiClient.get<OfferList>('/offers')
  return response.data
}

export const createOffer = async (payload: CreateOfferPayload): Promise<JobOffer> => {
  const response = await apiClient.post<JobOffer>('/offers', payload)
  return response.data
}

export const deleteOffer = async (offerId: number): Promise<void> => {
  await apiClient.delete(`/offers/${offerId}`)
}

// ── Analytics ────────────────────────────────────────────────────────────

export interface AtsHistoryPoint {
  id: number
  date: string | null
  score: number
  label: string
}

export interface QuantifiedHistoryPoint {
  id: number
  date: string | null
  label: string
  quantified_ratio: number
  impact_rating: number
}

export interface Funnel {
  /** Cards currently at each stage. */
  by_stage: Record<string, number>
  total_tracked: number
  /** "Reached at least this stage" — differs from by_stage because status
   * records where a card is now, not where it has been. */
  reached_applied: number
  reached_interviewing: number
  reached_offer: number
  /** null, not 0, when nothing has been applied to yet. */
  interview_rate: number | null
  offer_rate: number | null
}

export interface AnalyticsSummary {
  ats_history: AtsHistoryPoint[]
  quantified_history: QuantifiedHistoryPoint[]
  funnel: Funnel
  scan_count: number
  best_score: number | null
  latest_score: number | null
  /** null with fewer than two scans — one point is not a trend. */
  score_delta: number | null
}

export const getAnalyticsSummary = async (): Promise<AnalyticsSummary> => {
  const response = await apiClient.get<AnalyticsSummary>('/analytics/summary')
  return response.data
}

// ── Dashboard overview ───────────────────────────────────────────────────

export interface FreshJob {
  id: string
  title: string
  company: string
  location: string
  work_mode: string
  /** From posted_at (when the employer listed it), not fetched_at. */
  posted_label: string
  h1b_sponsorship?: string | null
  h1b_evidence?: string | null
  experience_level?: string | null
  apply_url: string
}

/** A real Federal Register document. Nothing is authored by ApplyCenter. */
export interface PipelineMetrics {
  /** Counts only stages meaning an application was sent — "saved" is a bookmark. */
  total_applied: number
  by_stage: Record<string, number>
  /** null, not 0, when nothing has been scored — "0% match" reads as a bad
   *  resume, where no measurement is simply no measurement. */
  average_match_score: number | null
  /** How much of the pipeline the average covers, so a figure from one
   *  application isn't mistaken for one from twenty. */
  scored_applications: number
  total_applications: number
}

export interface DashboardOverview {
  metrics: PipelineMetrics
  fresh_jobs: FreshJob[]
  /** Names the window actually used, so the UI cannot imply everything is hours old. */
  fresh_window: string
  latest_ats_score?: number | null
  scored_against?: string | null
  /** False when the Federal Register could not be reached. */
}

export const getDashboardOverview = async (): Promise<DashboardOverview> => {
  const response = await apiClient.get<DashboardOverview>('/dashboard/overview')
  return response.data
}

// ── Career Dashboard (Milestone 9) ──────────────────────────────────────
//
// One request, composing what every other engine already computes — see
// backend/app/modules/dashboard/services.py's home(). Nothing here is a
// new score; each field traces back to an existing endpoint's own logic.

export interface DashboardResume {
  resumes_analyzed: number
  avg_ats_score: number | null
  latest_ats_score: number | null
  latest_band: ScoreBand
  latest_filename: string | null
  suggested_improvements: string[]
}

export interface DashboardApplications {
  total: number
  active: number
  offers: number
  rejections: number
  success_rate: number | null
}

export interface DashboardInterviewReport {
  session_id: number
  role: string
  category: string | null
  overall_score: number | null
  readiness_band: ScoreBand | null
  completed_at: string | null
}

export interface DashboardInterview {
  completed_sessions: number
  average_score: number | null
  voice_answers_count: number
  latest_report: DashboardInterviewReport | null
  prep_completed_count: number
}

export interface DashboardJobs {
  top_matches: JobListing[]
  /** Freshest cached listings, populated even with no resume on file. */
  latest: JobListing[]
  missing_skills: string[]
  recruiter_perspective: string | null
}

export interface DashboardActivity {
  recent_activity: ActivityItem[]
  upcoming_interviews: JobApplication[]
  recent_applications: JobApplication[]
}

export interface DashboardAnalytics {
  ats_history: { id: number; date: string | null; score: number; label: string }[]
  weekly_progress: { period: string; score: number }[]
  monthly_progress: { period: string; score: number }[]
  funnel: {
    by_stage: Record<string, number>
    total_tracked: number
    reached_applied: number
    reached_interviewing: number
    reached_offer: number
    interview_rate: number | null
    offer_rate: number | null
  }
}

export interface DashboardHome {
  resume: DashboardResume
  applications: DashboardApplications
  interview: DashboardInterview
  jobs: DashboardJobs
  activity: DashboardActivity
  analytics: DashboardAnalytics
  next_actions: NextAction[]
}

export const getDashboardHome = async (): Promise<DashboardHome> => {
  const response = await apiClient.get<DashboardHome>('/dashboard/home')
  return response.data
}

// -- Notifications (Milestone 10) --------------------------------------------

export type NotificationCategory =
  | 'resume'
  | 'jobs'
  | 'interview'
  | 'application'
  | 'career_coach'
  | 'analytics'

export type NotificationPriority = 'high' | 'medium' | 'low'

export interface AppNotification {
  id: number
  type: string
  category: NotificationCategory
  priority: NotificationPriority
  title: string
  message: string
  href: string | null
  occurrence_count: number
  read_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationList {
  notifications: AppNotification[]
  unread_count: number
}

export const getNotifications = async (): Promise<NotificationList> => {
  const response = await apiClient.get<NotificationList>('/notifications')
  return response.data
}

export const getUnreadNotificationCount = async (): Promise<number> => {
  const response = await apiClient.get<{ unread_count: number }>('/notifications/unread-count')
  return response.data.unread_count
}

export const markNotificationRead = async (id: number): Promise<AppNotification> => {
  const response = await apiClient.post<AppNotification>(`/notifications/${id}/read`)
  return response.data
}

export const markAllNotificationsRead = async (): Promise<number> => {
  const response = await apiClient.post<{ updated: number }>('/notifications/read-all')
  return response.data.updated
}

export const archiveNotification = async (id: number): Promise<AppNotification> => {
  const response = await apiClient.post<AppNotification>(`/notifications/${id}/archive`)
  return response.data
}

export default apiClient

// ── FAANG-convention tailoring ───────────────────────────────────────────

export interface TailorBulletSuggestion {
  experience_index: number
  original: string
  suggested: string
  reason: string
}

/**
 * A tailoring proposal for one resume against one posting.
 *
 * Read-only: requesting this writes nothing. The stored resume is untouched
 * until the user accepts and rebuilds, which is what makes the acceptance
 * gate meaningful rather than cosmetic.
 */
export interface TailorPreview {
  job_id: number
  job_title: string
  company: string
  analysis_id: number
  /** LASTNAME_FIRSTNAME_RESUME_ROLE_COMPANY.pdf */
  download_filename: string
  original_resume_text: string
  /** This resume against THIS posting, from the trained model. Null when no
   *  model is on disk — never a placeholder figure. */
  current_score: number | null
  semantic_match: number | null
  /** Named by the posting, neither stated nor implied by the resume. */
  missing_keywords: string[]
  /** Implied by the resume but never written down — safe to add, because the
   *  candidate already has them. */
  state_explicitly: string[]
  bullet_suggestions: TailorBulletSuggestion[]
  has_job_description: boolean
}

/**
 * Note the absence of a projected score. The API deliberately returns none: a
 * number for a resume that does not exist yet cannot be measured, and quoting
 * one would be a promise rather than a result. The real score is recomputed
 * after the accepted version is built.
 *
 * Free unless `include_rewrites` is set, which spends one Claude call.
 */
export const getTailorPreview = async (payload: {
  job_id: number
  analysis_id: number
  full_name?: string
  include_rewrites?: boolean
}): Promise<TailorPreview> => {
  const response = await apiClient.post<TailorPreview>('/resume-builder/tailor-preview', payload)
  return response.data
}

// ── Builder autofill ─────────────────────────────────────────────────────

/**
 * Structured fields read back out of an uploaded resume.
 *
 * Every field is nullable because every field is a heuristic. `null` means
 * "could not determine" and must render as an empty box — deliberately not a
 * plausible-looking default, since nobody re-checks a field that already
 * looks filled.
 */
export interface ResumeAutofill {
  name: string | null
  email: string | null
  phone: string | null
  linkedin: string | null
  location: string | null
  summary: string | null
  experiences: BuilderExperienceEntry[]
  education: BuilderEducationEntry[]
  /** Fields from an unambiguous match rather than a positional guess. */
  confident_fields: string[]
  parsed_experience_count: number
  parsed_education_count: number
}

/** Free — regex and section splitting, no LLM call. Writes nothing. */
export const getResumeAutofill = async (analysisId: number): Promise<ResumeAutofill> => {
  const response = await apiClient.get<ResumeAutofill>(`/resume-builder/autofill/${analysisId}`)
  return response.data
}

// ── Score breakdown ──────────────────────────────────────────────────────

export interface RubricMetric {
  key: string
  label: string
  /** Points this metric contributes to the rubric total. */
  weight: number
  /** Null when the metric's inputs were unavailable — its weight is removed
   *  from the denominator rather than scored as zero. */
  score: number | null
  band: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'NEEDS WORK' | 'WEAK' | 'NOT CHECKED'
}

export interface ParseCheck {
  key: string
  name: string
  /** Three-valued: null means the check could not run, which is a different
   *  finding from failure and must render differently. */
  passed: boolean | null
  detail: string
  why: string
}

/**
 * Two scores, each labelled by what produced it.
 *
 * `model_score` is the trained GradientBoostingRegressor's prediction and
 * stays authoritative across the product. `rubric_total` is a weighted sum of
 * measurable document properties. Neither is derived from the other, and the
 * metric bars explain the rubric — not the model, which is not a weighted sum
 * of these seven things.
 */
/**
 * One measured reason the model score may not mean what it looks like.
 *
 * The trained model scores a verbatim copy of the job posting 88 and a real
 * resume with quantified achievements 49, so a high number is evidence of
 * keyword overlap until something checks for repetition. These are those
 * checks, counted server-side in resume_analyzer/integrity.py.
 */
export interface IntegritySignal {
  signal: 'keyword_density' | 'max_repetition' | 'verbatim_overlap' | 'lexical_diversity'
  value: number
  limit: number
  detail: string
}

export interface ScoreIntegrity {
  /** False when the document was too short to judge — which is not "clean". */
  checked: boolean
  stuffed: boolean
  signals: IntegritySignal[]
  reason?: string
  measurements?: Record<string, number>
}

export interface ScoreBreakdown {
  analysis_id: number
  resume_filename: string
  model_score: number
  /** Whether model_score can be believed for this document. */
  score_integrity: ScoreIntegrity | null
  rubric_total: number | null
  /** What the rubric total is out of. Below 100 when a check could not run. */
  weight_applied: number
  skipped: string[]
  metrics: RubricMetric[]
  parse_checks: ParseCheck[]
  missing_keywords: string[]
  matched_keywords: string[]
}

/** Free — no LLM call, no rescoring. Writes nothing. */
export const getScoreBreakdown = async (analysisId: number): Promise<ScoreBreakdown> => {
  const response = await apiClient.get<ScoreBreakdown>(`/resume/breakdown/${analysisId}`)
  return response.data
}

// ── Cover letter ─────────────────────────────────────────────────────────

export type CoverLetterTone = 'professional' | 'confident' | 'concise'

export interface CoverLetter {
  job_id: number
  analysis_id: number
  job_title: string
  company: string
  tone: CoverLetterTone
  /** LASTNAME_FIRSTNAME_COVER_LETTER_ROLE_COMPANY.pdf */
  download_filename: string
  paragraphs: string[]
  /** Resume quotes the model says each claim rests on. */
  grounded_in: string[]
  /**
   * Figures asserted in the letter that don't appear in the resume. A report,
   * not a rejection — an empty list means no unmatched figures were found,
   * NOT that the letter has been verified true.
   */
  unsupported_claims: string[]
  /** base64. Null when this server has no LaTeX toolchain; the text is still
   *  returned, since the Claude call has already been paid for. */
  pdf_base64: string | null
}

/** Costs one Claude call (~$0.017). Never fire this on page load. */
export const generateCoverLetter = async (payload: {
  job_id: number
  analysis_id: number
  full_name?: string
  phone?: string
  linkedin?: string
  tone?: CoverLetterTone
}): Promise<CoverLetter> => {
  const response = await apiClient.post<CoverLetter>('/cover-letter/generate', payload)
  return response.data
}

/** Builds a blob URL from base64 — there is no file hosting, so the PDF never
 *  has a server-side URL to link to. Revoke it when the preview unmounts. */
export const pdfBlobUrl = (pdfBase64: string): string => {
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

export interface QuickTailorResult {
  pdf_base64: string
  tex_source: string
  page_count: number
  target_pages: number
  fits: boolean
  adjustments: string[]
  ats_score: number
  filename: string
}

/**
 * A finished, page-fitted FAANG-format resume built from a scan already on
 * file. The server compiles and measures to hit the page count rather than
 * assuming the template does — so `page_count` is what came out, which is
 * not always `target_pages`, and `adjustments` says what was cut to get
 * there.
 */
export const buildQuickTailoredResume = async (
  analysisId: number,
  payload: { full_name: string; job_description: string; target_pages: 1 | 2 },
): Promise<QuickTailorResult> => {
  const response = await apiClient.post<QuickTailorResult>(
    `/resume-builder/quick-tailor/${analysisId}`,
    payload,
  )
  return response.data
}

/** Save a base64 PDF the server built. Same mechanics as the builder's own
 *  download, kept here so the tailor path does not import from a panel. */
export const savePdfFromBase64 = (pdfBase64: string, filename: string) => {
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  const url = window.URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/** The Overleaf-ready source as a .tex file. */
export const saveTexSource = (tex: string, filename: string) => {
  const url = window.URL.createObjectURL(new Blob([tex], { type: 'application/x-tex' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/* ── Export and erasure ───────────────────────────────────────────────────
 *
 * The landing page promises "Nothing was shared" and that a CV is read to
 * score it "and that is all". These two calls are what let someone verify
 * the first and act on it.
 */

export interface AccountDeletion {
  /** Per table, so the result can be checked against the export rather than
   *  taken on trust. */
  deleted: Record<string, number>
  /** Whether the Supabase identity went too. False means the data is gone
   *  but signing in still works — which the user has to be told, because it
   *  is not what "delete my account" implies. */
  sign_in_disabled: boolean
}

/**
 * Downloads everything the product holds about the caller as a JSON file.
 *
 * Fetched as a blob and saved client-side rather than pointed at with a
 * plain link: the endpoint needs an Authorization header, and a bare <a
 * href> cannot carry one — it would open an unauthenticated request and
 * return 401.
 */
export const downloadMyData = async (): Promise<void> => {
  const response = await apiClient.get<unknown>('/user/export')
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(response.data, null, 2)], {
    type: 'application/json',
  })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `applycenter-my-data-${stamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * Irreversible. The confirm parameter is required by the API and is
 * deliberately not defaulted here — a caller has to type it, so this cannot
 * be invoked by accident from a stray click handler.
 */
export const deleteMyAccount = async (confirm: string): Promise<AccountDeletion> => {
  const response = await apiClient.delete<AccountDeletion>('/user/account', {
    params: { confirm },
  })
  return response.data
}
