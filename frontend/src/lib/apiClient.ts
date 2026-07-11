import axios from 'axios'

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api',
})

const TOKEN_KEY = 'aicc_token'
const USER_KEY = 'aicc_user'

export interface AuthUser {
  id: number
  email: string
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSession()
    }
    return Promise.reject(error)
  },
)

interface AuthResponse {
  access_token: string
  token_type: string
  user: AuthUser
}

export const register = async (email: string, password: string): Promise<AuthUser> => {
  const response = await apiClient.post<AuthResponse>('/auth/register', { email, password })
  setSession(response.data.access_token, response.data.user)
  return response.data.user
}

export const login = async (email: string, password: string): Promise<AuthUser> => {
  const response = await apiClient.post<AuthResponse>('/auth/login', { email, password })
  setSession(response.data.access_token, response.data.user)
  return response.data.user
}

export const logout = () => clearSession()

export interface KeywordFrequency {
  keyword: string
  present: boolean
  frequency: number
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

export const generateImprovedResume = async (
  analysisId: number,
  fullName: string,
  selectedSkills: string[],
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
  link.download = `resume-${safeName}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
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

export default apiClient
