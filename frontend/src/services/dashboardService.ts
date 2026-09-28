import { http } from '@/lib/http'
import { DashboardHomeSchema } from '@/types/dashboard'

/** Career Dashboard's one request — GET /api/dashboard/home. Backs
 * DashboardPage and ProgressPage (its `analytics` section is the one source
 * of truth for both the mini chart on the dashboard and the dedicated
 * Progress page's charts). */
export const dashboardService = {
  getHome: async (): Promise<DashboardHomeSchema> => {
    const { data } = await http.get<DashboardHomeSchema>('/dashboard/home')
    return data
  },
}
