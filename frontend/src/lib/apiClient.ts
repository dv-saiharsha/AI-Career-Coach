import axios from 'axios'
import { createClient } from './supabase/client'

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api',
})

// Auth (session, login/register/logout) lives entirely in AuthContext now,
// backed by Supabase — this file only attaches the current Supabase
// session's access token to requests against our own FastAPI backend.
apiClient.interceptors.request.use(async (config) => {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

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
  const response = await apiClient.post('/resume/analyze', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (!onUploadProgress) return
      const total = evt.total ?? evt.loaded
      onUploadProgress(total ? Math.round((evt.loaded / total) * 100) : 100)
    },
  })
  return response.data
}

export interface ResumeHistoryItem {
  id: number
  resume_filename: string
  ats_score: number
  created_at: string
}

export const getResumeHistory = async (): Promise<ResumeHistoryItem[]> => {
  const response = await apiClient.get('/resume/history')
  return response.data
}

export const downloadResumeReport = async (analysisId: number, filename = 'resume-report.pdf') => {
  const response = await apiClient.get(`/resume/report/${analysisId}`, { responseType: 'blob' })
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
  const response = await apiClient.get(`/resume/file/${analysisId}`, { responseType: 'blob' })
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

export interface InterviewQuestion {
  id: number
  text: string
  type: string
  difficulty?: 'easy' | 'medium' | 'hard'
  tags?: string[]
}

export const generateInterviewQuestions = async (payload: {
  role: string
  seniority: string
}): Promise<{ session_id: number; questions: InterviewQuestion[] }> => {
  const response = await apiClient.post('/interview/questions', payload)
  return response.data
}

export interface InterviewFeedback {
  score: number
  feedback: string
  improvement_tips: string
  sample_answer?: string | null
  key_points?: string[]
}

export const evaluateInterviewAnswer = async (payload: {
  question_id: number
  answer_text: string
}): Promise<InterviewFeedback> => {
  const response = await apiClient.post('/interview/evaluate', payload)
  return response.data
}

export interface ModelAnswer {
  ideal_answer: string
  example: string
  plain_explanation: string
  key_points: string[]
}

export const getInterviewModelAnswer = async (questionId: number): Promise<ModelAnswer> => {
  const response = await apiClient.post('/interview/model-answer', { question_id: questionId })
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
  const response = await apiClient.post(
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
  const response = await apiClient.post('/interview/screening-prep', payload)
  return response.data
}

export interface InterviewHistoryItem {
  id: number
  role: string
  seniority: string
  created_at: string
  average_score: number | null
  answered_count: number
  question_count: number
}

export const getInterviewHistory = async (): Promise<InterviewHistoryItem[]> => {
  const response = await apiClient.get('/interview/history')
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
}

/**
 * Job feed. Reads cache only and returns immediately; a query with no cached
 * results queues a scrape server-side rather than making the caller wait.
 */
export const getJobs = async (q?: string, filters?: JobFilters): Promise<JobFeed> => {
  // Undefined keys are dropped by axios, so an unset filter never reaches the
  // backend as an empty string it would have to special-case.
  const params: Record<string, string> = {}
  if (q) params.q = q
  if (filters?.h1b) params.h1b = filters.h1b
  if (filters?.experience) params.experience = filters.experience
  if (filters?.employment) params.employment = filters.employment

  const response = await apiClient.get('/jobs', {
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
}

export const updateUserProfile = async (patch: ProfileUpdate): Promise<UserProfile> => {
  const response = await apiClient.patch('/user/profile', patch)
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
  const response = await apiClient.get('/user/profile')
  return response.data
}

export interface OnboardingPayload {
  target_roles: string[]
  primary_resume_analysis_id?: number | null
  primary_resume_filename?: string | null
}

export const completeOnboarding = async (payload: OnboardingPayload): Promise<UserProfile> => {
  const response = await apiClient.post('/user/onboarding', payload)
  return response.data
}

/** Marks onboarding done without roles. A separate endpoint because
 *  /user/onboarding enforces a 3-5 role bound that an empty list fails. */
export const skipOnboarding = async (): Promise<UserProfile> => {
  const response = await apiClient.post('/user/onboarding/skip')
  return response.data
}

export const getUserStats = async (): Promise<UserStats> => {
  const response = await apiClient.get('/user/stats')
  return response.data
}

export const getUserActivity = async (): Promise<ActivityItem[]> => {
  const response = await apiClient.get('/user/activity')
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
  const response = await apiClient.post(`/resume-builder/stage-fixes/${analysisId}`, {
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
  const response = await apiClient.post(`/resume-builder/quality-report/${analysisId}`)
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
  const response = await apiClient.post('/resume-builder/compile-and-score', payload)
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

export const APPLICATION_STAGES = ['saved', 'applied', 'interviewing', 'offer', 'rejected'] as const
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
}

export const getApplicationPipeline = async (): Promise<Pipeline> => {
  const response = await apiClient.get('/applications/pipeline')
  return response.data
}

export const createApplication = async (
  payload: CreateApplicationPayload,
): Promise<JobApplication> => {
  const response = await apiClient.post('/applications', payload)
  return response.data
}

export const updateApplicationStatus = async (
  applicationId: number,
  status: ApplicationStatus,
): Promise<JobApplication> => {
  const response = await apiClient.patch(`/applications/${applicationId}/status`, { status })
  return response.data
}

/** Partial — omitted keys are left untouched server-side. */
export const updateApplication = async (
  applicationId: number,
  patch: Partial<Omit<JobApplication, 'id' | 'created_at' | 'updated_at' | 'applied_at'>>,
): Promise<JobApplication> => {
  const response = await apiClient.patch(`/applications/${applicationId}`, patch)
  return response.data
}

export const deleteApplication = async (applicationId: number): Promise<void> => {
  await apiClient.delete(`/applications/${applicationId}`)
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
  const response = await apiClient.get('/offers')
  return response.data
}

export const createOffer = async (payload: CreateOfferPayload): Promise<JobOffer> => {
  const response = await apiClient.post('/offers', payload)
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
  const response = await apiClient.get('/analytics/summary')
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
export interface NewsArticle {
  id: string
  title: string
  /** The issuing agency's own abstract, verbatim. */
  summary?: string | null
  type: string
  agency: string
  /** The document's real publication date — never the current time. */
  published_at?: string | null
  url?: string | null
}

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
  news: NewsArticle[]
  /** False when the Federal Register could not be reached. */
  news_reachable: boolean
  news_cached: boolean
}

export const getDashboardOverview = async (): Promise<DashboardOverview> => {
  const response = await apiClient.get('/dashboard/overview')
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
  const response = await apiClient.post('/resume-builder/tailor-preview', payload)
  return response.data
}
