// Types for the Interview Coach's Mock Interview flow (Setup -> Session ->
// Feedback), mirroring backend/app/schemas/interview.py and
// backend/app/schemas/interview_prep.py's PrepCategory field-for-field.
// Field names are kept in the API's own snake_case rather than translated to
// camelCase, since these travel straight through `http` with no mapping
// layer in between.

export type PrepCategory = 'hr' | 'technical' | 'behavioral' | 'screening' | 'scenario'

// Mirrors interview_coach/prep.py's CATEGORY_LABELS.
export const CATEGORY_LABELS: Record<PrepCategory, string> = {
  hr: 'HR',
  technical: 'Technical',
  behavioral: 'Behavioral',
  screening: 'Screening',
  scenario: 'Scenario',
}

// Mirrors interview_coach/prep.py's CATEGORY_FRAMING — used to explain each
// category on the setup screen instead of just naming five options.
export const CATEGORY_FRAMING: Record<PrepCategory, string> = {
  hr: 'HR and culture-fit questions — about motivation, work style, and fit, not technical depth.',
  technical: "Technical questions that test hands-on knowledge and problem-solving in the role's domain.",
  behavioral: 'Behavioral questions about past experience, best answered with a structured story (e.g. STAR).',
  screening: 'General recruiter-screen-style questions — early-stage, broad, filtering for basic fit.',
  scenario: 'Scenario / situational questions that pose a hypothetical problem and ask how the candidate would handle it.',
}

export const PREP_CATEGORIES: PrepCategory[] = ['hr', 'technical', 'behavioral', 'screening', 'scenario']

export interface QuestionRequest {
  role: string
  seniority: string
  category: PrepCategory
}

export interface InterviewQuestionSchema {
  id: number
  text: string
  type: string
  sequence_order: number
}

export interface QuestionsResponseSchema {
  session_id: number
  role: string
  seniority: string
  category: PrepCategory
  questions: InterviewQuestionSchema[]
}

export interface VoiceMetricsSchema {
  speaking_duration_seconds?: number | null
  average_confidence?: number | null
  speaking_rate_wpm?: number | null
  long_pause_count?: number | null
  filler_word_count?: number | null
}

export interface EvaluationRequest {
  question_id: number
  answer_text: string
  voice_metrics?: VoiceMetricsSchema | null
}

// `score` and every value in `dimension_scores` are on a 0-10 scale, NOT
// 0-100 — callers multiply by 10 (see scoreToPercent) before handing either
// to a percent-based display like ScoreRing.
export interface FeedbackSchema {
  score: number
  dimension_scores: Record<string, number>
  strengths: string[]
  weaknesses: string[]
  missing_points: string[]
  learning_suggestions: string[]
  sample_answer?: string | null
  voice_metrics?: VoiceMetricsSchema | null
}

export interface ActiveAnswerSchema extends FeedbackSchema {
  answer_text: string
}

export interface ActiveQuestionSchema extends InterviewQuestionSchema {
  answer: ActiveAnswerSchema | null
}

export interface ActiveSessionSchema {
  session_id: number
  role: string
  seniority: string
  category: PrepCategory
  status: string
  questions: ActiveQuestionSchema[]
}

export interface QuestionFeedbackSchema extends FeedbackSchema {
  question_id: number
  question_text: string
  answer_text: string
}

export interface CategoryPerformanceSchema {
  key: string
  label: string
  average_score: number
}

export interface NextActionSchema {
  key: string
  label: string
  description: string
  href: string
  priority: string
}

export interface SessionReportSchema {
  session_id: number
  role: string
  seniority: string
  category: PrepCategory
  overall_score: number
  readiness_band: string
  performance_summary: string
  question_feedback: QuestionFeedbackSchema[]
  category_performance: CategoryPerformanceSchema[]
  strongest_skills: string[]
  weakest_skills: string[]
  topics_to_improve: string[]
  practice_plan: string[]
  next_actions: NextActionSchema[]
}

export interface ModelAnswerSchema {
  ideal_answer: string
  example: string
  plain_explanation: string
  key_points: string[]
}

export interface InterviewHistoryItemSchema {
  id: number
  role: string
  seniority: string
  category: PrepCategory | null
  status: string
  created_at: string
  average_score: number | null
  answered_count: number
  question_count: number
}

// Builds the ActiveSessionSchema shape straight from POST /questions's
// response, for the moment right after InterviewSetupPage creates a session
// and before InterviewSessionPage's own GET /sessions/active round-trip
// necessarily reflects it. Every question starts unanswered.
export function activeSessionFromQuestions(res: QuestionsResponseSchema): ActiveSessionSchema {
  return {
    session_id: res.session_id,
    role: res.role,
    seniority: res.seniority,
    category: res.category,
    status: 'in_progress',
    questions: res.questions.map((q) => ({ ...q, answer: null })),
  }
}

// FeedbackSchema's score is 0-10; every score-based display in this module
// (ScoreRing, percent labels) works in 0-100, so this is the one place that
// conversion happens rather than mixing scales across components.
export function scoreToPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(10, score)) * 10)
}

// dimension_scores is an open dict rather than named fields, so its keys are
// rendered generically — this turns "technical_accuracy" into "Technical
// Accuracy" without hard-coding backend's DIMENSION_LABELS dict here.
export function humanizeKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
