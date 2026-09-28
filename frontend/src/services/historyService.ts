import { http } from '@/lib/http'
import { applicationsService } from '@/services/applicationsService'
import { HistoryEntry, InterviewHistoryItem, ResumeHistoryItem } from '@/types/history'

/** There is no combined history endpoint on the backend — this calls the
 * resume analyzer's, interview coach's, and applications' own real endpoints
 * directly and merges them client-side. Owned by this service so none of
 * those modules' own service files need to know about the unified History
 * page. Cover letters are not a fourth source here — see types/history.ts
 * for why (no persistence exists to have a history of). */

async function getResumeHistory(): Promise<ResumeHistoryItem[]> {
  const { data } = await http.get<ResumeHistoryItem[]>('/resume/history')
  return data
}

async function getInterviewHistory(): Promise<InterviewHistoryItem[]> {
  const { data } = await http.get<InterviewHistoryItem[]>('/interview/history')
  return data
}

function entryTimestamp(entry: HistoryEntry): number {
  const iso = entry.type === 'application' ? entry.changed_at : entry.created_at
  if (!iso) return 0
  const parsed = new Date(iso).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export const historyService = {
  getResumeHistory,
  getInterviewHistory,

  /** All three lists fetched in parallel, tagged with `type`, and
   * interleaved newest-first by their own timestamp — the single feed the
   * History page renders. */
  getUnifiedHistory: async (): Promise<HistoryEntry[]> => {
    const [resumes, interviews, applicationActivity] = await Promise.all([
      getResumeHistory(),
      getInterviewHistory(),
      applicationsService.getActivity(),
    ])
    const entries: HistoryEntry[] = [
      ...resumes.map((r): HistoryEntry => ({ type: 'resume', ...r })),
      ...interviews.map((i): HistoryEntry => ({ type: 'interview', ...i })),
      ...applicationActivity.map((a): HistoryEntry => ({ type: 'application', ...a })),
    ]
    entries.sort((a, b) => entryTimestamp(b) - entryTimestamp(a))
    return entries
  },
}
