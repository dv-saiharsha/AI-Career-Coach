import { http } from '@/lib/http'
import {
  ActiveSessionSchema,
  EvaluationRequest,
  FeedbackSchema,
  InterviewHistoryItemSchema,
  ModelAnswerSchema,
  PrepCategory,
  QuestionsResponseSchema,
  SessionReportSchema,
} from '@/types/interview'

/* Interview Coach — Mock Interview flow. Thin, typed wrappers over
   backend/app/modules/interview_coach/router.py; every request/response
   shape lives in @/types/interview. There is no mock or local fallback data
   left in this file. */

export const interviewService = {
  // Starts a new Mock Interview session, sourcing its questions from the
  // shared Interview Preparation cache. Abandons any other session this user
  // still had in progress server-side. The very first request for a never-
  // before-seen role+category pair generates content with an LLM and can
  // take several seconds — callers should show a real loading state.
  createSession: async (role: string, seniority: string, category: PrepCategory): Promise<QuestionsResponseSchema> => {
    const { data } = await http.post<QuestionsResponseSchema>('/interview/questions', { role, seniority, category })
    return data
  },

  // Null when the user has no in-progress session to resume. Already-
  // answered questions come back with their full FeedbackSchema attached.
  getActiveSession: async (): Promise<ActiveSessionSchema | null> => {
    const { data } = await http.get<ActiveSessionSchema | null>('/interview/sessions/active')
    return data
  },

  // Marks the current in-progress attempt abandoned so a fresh POST
  // /questions call is free to start another. Idempotent server-side.
  abandonSession: async (sessionId: number): Promise<void> => {
    await http.post<void>(`/interview/sessions/${sessionId}/abandon`)
  },

  // Scores one answer and persists it. This auto-completes the session
  // server-side once every question in it has an answer.
  evaluateAnswer: async (req: EvaluationRequest): Promise<FeedbackSchema> => {
    const { data } = await http.post<FeedbackSchema>('/interview/evaluate', req)
    return data
  },

  // Only valid once the session's status is "completed" — the backend 400s
  // if it's still in progress.
  getSessionReport: async (sessionId: number): Promise<SessionReportSchema> => {
    const { data } = await http.get<SessionReportSchema>(`/interview/sessions/${sessionId}/report`)
    return data
  },

  // Optional "show me a model answer" affordance during a session. Reuses
  // Interview Preparation's cached content when the question was sourced
  // from it, so this is usually free of a second LLM call.
  getModelAnswer: async (questionId: number): Promise<ModelAnswerSchema> => {
    const { data } = await http.post<ModelAnswerSchema>('/interview/model-answer', { question_id: questionId })
    return data
  },

  getHistory: async (): Promise<InterviewHistoryItemSchema[]> => {
    const { data } = await http.get<InterviewHistoryItemSchema[]>('/interview/history')
    return data
  },
}
