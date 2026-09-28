import { http } from '@/lib/http'
import {
  type ActivityItem,
  type ApplicationCreateInput,
  type ApplicationDetail,
  type ApplicationRecord,
  type ApplicationStatus,
  type ApplicationUpdateInput,
  type PipelineResponse,
  STAGE_COLUMNS,
} from '@/types/applications'

/** The stage to persist when a card is dropped on / assigned to a column.
 *  A card already inside that column's members keeps its precise stage —
 *  reassigning within the same column must not silently demote e.g. Final
 *  Interview back to Recruiter Screening. */
export function stageForColumn(columnId: string, currentStatus: ApplicationStatus): ApplicationStatus {
  const column = STAGE_COLUMNS.find((c) => c.id === columnId)
  if (!column) return currentStatus
  return column.members.includes(currentStatus) ? currentStatus : column.entry
}

export const applicationsService = {
  getPipeline: async (): Promise<PipelineResponse> => {
    const { data } = await http.get<PipelineResponse>('/applications/pipeline')
    return data
  },

  getActivity: async (): Promise<ActivityItem[]> => {
    const { data } = await http.get<ActivityItem[]>('/applications/activity')
    return data
  },

  getDetail: async (id: number): Promise<ApplicationDetail> => {
    const { data } = await http.get<ApplicationDetail>(`/applications/${id}`)
    return data
  },

  create: async (payload: ApplicationCreateInput): Promise<ApplicationRecord> => {
    const { data } = await http.post<ApplicationRecord>('/applications', payload)
    return data
  },

  update: async (id: number, payload: ApplicationUpdateInput): Promise<ApplicationRecord> => {
    const { data } = await http.patch<ApplicationRecord>(`/applications/${id}`, payload)
    return data
  },

  updateStatus: async (id: number, status: ApplicationStatus): Promise<ApplicationRecord> => {
    const { data } = await http.patch<ApplicationRecord>(`/applications/${id}/status`, { status })
    return data
  },

  remove: async (id: number): Promise<void> => {
    await http.delete(`/applications/${id}`)
  },
}
