import { http } from '@/lib/http'
import type { AnalyticsSummary } from '@/types/analytics'

export const analyticsService = {
  /** GET /api/analytics/summary — the signed-in user's own ATS score
   *  trajectory, resume-quality diagnostics, and application pipeline
   *  funnel. Identity comes from the bearer token; there is no id in the
   *  path to guard, so every figure is already scoped to the caller. */
  getSummary: async (): Promise<AnalyticsSummary> => {
    const { data } = await http.get<AnalyticsSummary>('/analytics/summary')
    return data
  },
}
