import { http } from '@/lib/http'
import type { JobFeed } from '@/types/jobs'

export interface JobFeedQuery {
  /** Free-text search. Under 3 significant characters is treated by the
   * backend as "no query" and served from the warm cache — see
   * job_market/router.py's MIN_BILLABLE_QUERY_LEN. */
  q?: string
  h1b?: string
  experience?: string
  employment?: string
  /** Employer quick-filter chip label, e.g. "AWS" | "Google" | "Stripe". */
  company?: string
  // Index signature so this satisfies http.ts's RequestConfig#params shape.
  [key: string]: string | undefined
}

export interface TrackApplicationPayload {
  job_title: string
  company: string
  location?: string | null
  salary_range?: string | null
  job_url?: string | null
  job_description?: string | null
  status?: string
}

export const jobsService = {
  /** GET /api/jobs — cache-first job feed, optionally narrowed by search
   * text and the enrichment filters (h1b / experience / employment) plus an
   * employer chip. Work-mode has no server-side filter; the caller narrows
   * the returned `jobs` array on `workMode` itself. */
  getJobs: async (params: JobFeedQuery = {}): Promise<JobFeed> => {
    const { data } = await http.get<JobFeed>('/jobs', { params })
    return data
  },

  /** POST /api/applications — logs a listing into the user's Application
   * Pipeline. Kept to a single call with no follow-up state of its own;
   * the Pipeline page owns everything past creation. */
  trackApplication: async (payload: TrackApplicationPayload) => {
    const { data } = await http.post('/applications', payload)
    return data
  },
}
