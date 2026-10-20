import { http } from '@/lib/http'
import type {
  AnalysisResult,
  ResumeHistoryItem,
  ResumeOnFile,
  ScoreBreakdown,
} from '@/types/resume'

export const resumeService = {
  analyzeResume: async (
    file: File,
    jobDescription: string,
    scanId?: string
  ): Promise<AnalysisResult> => {
    const form = new FormData()
    form.append('resume', file)
    form.append('job_description', jobDescription)
    if (scanId) form.append('scan_id', scanId)

    const { data } = await http.post<AnalysisResult>('/resume/analyze', form)
    return data
  },

  /** Re-score the resume already on file against a different JD. Same rate
   * limit and same shape of response as analyzeResume, but no file upload
   * and — per the backend — no scan_id/progress-stream support. */
  rescanStoredResume: async (jobDescription: string): Promise<AnalysisResult> => {
    const { data } = await http.post<AnalysisResult>('/resume/rescan', {
      job_description: jobDescription,
    })
    return data
  },

  getResumeOnFile: async (): Promise<ResumeOnFile> => {
    const { data } = await http.get<ResumeOnFile>('/resume/on-file')
    return data
  },

  /** Deterministic rubric breakdown for a stored scan. Free (no LLM call),
   * and — unlike the analyze/rescan payload — genuinely retrievable at any
   * time by id. */
  getBreakdown: async (analysisId: number): Promise<ScoreBreakdown> => {
    const { data } = await http.get<ScoreBreakdown>(`/resume/breakdown/${analysisId}`)
    return data
  },

  getHistory: async (): Promise<ResumeHistoryItem[]> => {
    const { data } = await http.get<ResumeHistoryItem[]>('/resume/history')
    return data
  },

  deleteAnalysis: async (analysisId: number): Promise<void> => {
    await http.delete(`/resume/${analysisId}`)
  },
}
