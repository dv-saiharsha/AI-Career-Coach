import { http } from '@/lib/http'
import type {
  AnalysisResult,
  ResumeHistoryItem,
  ResumeOnFile,
  ScoreBreakdown,
} from '@/types/resume'

/* A module-level cache of the last full analysis this browser session
   produced, keyed by nothing but "most recent" — mirroring the in-memory
   pattern the mock service used before this.

   It exists because of a real backend limitation: POST /analyze and
   POST /rescan are the ONLY endpoints that ever return the rich payload
   (keyword_analysis with per-keyword frequency/implied, suggestions,
   diagnostics). Nothing persists that payload for later retrieval by id —
   /resume/history returns only id/filename/score/date, and
   /resume/breakdown/{id} returns only the deterministic rubric plus
   matched/missing skill *names* (as matched_keywords/missing_keywords), not
   the rest. A reload of the results page, or a link into it from elsewhere,
   has no way to get the rich fields back except by re-scanning — so the
   results page reads this cache first and falls back to what /on-file and
   /breakdown can still offer. See ResumeResultsPage.tsx's loader. */
let cachedAnalysis: AnalysisResult | null = null

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
    cachedAnalysis = data
    return data
  },

  /** Re-score the resume already on file against a different JD. Same rate
   * limit and same shape of response as analyzeResume, but no file upload
   * and — per the backend — no scan_id/progress-stream support. */
  rescanStoredResume: async (jobDescription: string): Promise<AnalysisResult> => {
    const { data } = await http.post<AnalysisResult>('/resume/rescan', {
      job_description: jobDescription,
    })
    cachedAnalysis = data
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

  /** The most recent analyze/rescan result from this browser session, if
   * any — see the module docstring above for why this exists at all. */
  getCachedAnalysis: (): AnalysisResult | null => cachedAnalysis,
}
