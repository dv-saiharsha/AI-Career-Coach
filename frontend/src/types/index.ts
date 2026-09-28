export interface User {
  id: string
  name: string
  email: string
  title: string
  avatarUrl?: string
  experienceLevel: 'Entry Level' | 'Mid Level' | 'Senior' | 'Lead'
  targetRoles: string[]
  notificationCount: number
}

export interface Skill {
  name: string
  category: 'Programming' | 'Machine Learning' | 'Cloud & DevOps' | 'Databases' | 'Tools & Frameworks' | 'Soft Skills'
  relevance: 'High' | 'Medium' | 'Low'
  found: boolean
  priority?: 'High' | 'Medium' | 'Low'
  frequency?: number
  recommendation?: string
}

export interface Keyword {
  keyword: string
  frequencyInJob: number
  frequencyInResume: number
  relevance: 'High' | 'Medium' | 'Low'
  priority?: 'High' | 'Medium' | 'Low'
  isMissing: boolean
}

export interface Recommendation {
  id: string
  priority: 'High' | 'Medium' | 'Low'
  category: string
  problem: string
  whyItMatters: string
  suggestedAction: string
  implemented?: boolean
}

export interface ATSBreakdown {
  keywordMatch: number
  skillsMatch: number
  jobAlignment: number
  experienceRelevance: number
  formatting: number
}

export interface ResumeAnalysis {
  id: string
  fileName: string
  fileSize: string
  uploadedAt: string
  targetRole: string
  company?: string
  jobDescription: string
  overallScore: number
  matchRating: 'Strong Match' | 'Good Match' | 'Moderate Match' | 'Needs Improvement'
  breakdown: ATSBreakdown
  missingSkills: Skill[]
  detectedSkills: Skill[]
  keywords: Keyword[]
  recommendations: Recommendation[]
  summary: string
}

export type InterviewType = 'Technical' | 'Behavioral' | 'Mixed'
export type ExperienceLevel = 'Entry Level' | 'Mid Level' | 'Senior' | 'Lead'

export interface InterviewConfig {
  targetRole: string
  interviewType: InterviewType
  experienceLevel: ExperienceLevel
  questionCount: number
}

export interface AnswerEvaluation {
  technicalAccuracyScore: number
  communicationScore: number
  overallScore: number
  strengths: string[]
  weaknesses: string[]
  suggestedImprovements: string[]
  sampleIdealAnswer: string
  structureRating: string
}

export interface InterviewQuestion {
  id: string
  questionNumber: number
  category: 'Technical' | 'Behavioral' | 'System Design' | 'Scenario'
  question: string
  context?: string
  suggestedTimeMinutes?: number
}

export interface QuestionResponse {
  questionId: string
  question: string
  category: 'Technical' | 'Behavioral' | 'System Design' | 'Scenario'
  userAnswer: string
  evaluation?: AnswerEvaluation
  answeredAt?: string
  skipped?: boolean
}

export interface InterviewSession {
  id: string
  createdAt: string
  targetRole: string
  interviewType: InterviewType
  experienceLevel: ExperienceLevel
  status: 'In Progress' | 'Completed' | 'Abandoned'
  totalQuestions: number
  completedQuestions: number
  overallScore: number
  technicalScore: number
  communicationScore: number
  questions: QuestionResponse[]
  areasToImproveCount: number
}

export interface ProgressMetric {
  date: string
  interviewScore: number
  resumeATSScore: number
  technicalScore: number
  communicationScore: number
  sessionsCount: number
}

export interface DashboardSummary {
  atsMatch: {
    score: number
    previousScore: number
    targetRole: string
  }
  interviewScore: {
    overall: number
    technical: number
    communication: number
  }
  skillsIdentified: {
    total: number
    technical: number
    tools: number
    softSkills: number
  }
  interviewSessions: {
    total: number
    thisMonthChange: number
  }
}
