import { http } from '@/lib/http'
import type {
  CoverLetterResult,
  GenerateCoverLetterRequest,
  JobOption,
  ResumeScanOption,
} from '@/types/coverLetter'

interface JobFeedResponse {
  jobs: JobOption[]
}

export const coverLetterService = {
  /** Cover letters are grounded in one real cached posting, so the picker
   * searches the same feed the Jobs page shows (GET /api/jobs) rather than
   * accepting freeform title/company/description text. */
  searchJobs: async (query: string): Promise<JobOption[]> => {
    const q = query.trim()
    const { data } = await http.get<JobFeedResponse>('/jobs', {
      params: q ? { q } : undefined,
    })
    return data.jobs ?? []
  },

  /** Resume scans the letter can be grounded in (GET /api/resume/history). */
  listResumeScans: async (): Promise<ResumeScanOption[]> => {
    const { data } = await http.get<ResumeScanOption[]>('/resume/history')
    return data ?? []
  },

  /** POST /api/cover-letter/generate. One LLM call — several seconds, can
   * 429/503 under load. Callers should catch HttpError themselves so they can
   * show a tailored message. */
  generate: async (payload: GenerateCoverLetterRequest): Promise<CoverLetterResult> => {
    const { data } = await http.post<CoverLetterResult>('/cover-letter/generate', payload)
    return data
  },
}
