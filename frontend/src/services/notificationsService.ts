import { http } from '@/lib/http'
import type { NotificationItem, NotificationListResponse } from '@/types/notifications'

// GET /api/notifications — real engine (backend/app/modules/notifications):
// event-driven (application status changes, resume score changes, high-match
// jobs, interview-stage reached) plus a periodic sweep piggybacked on the
// dashboard's own request. Previously this file was a hardcoded mock array
// shown to every user regardless of their real activity — replaced outright,
// not layered on top of.
export const notificationsService = {
  list: async (includeArchived = false): Promise<NotificationListResponse> => {
    const { data } = await http.get<NotificationListResponse>('/notifications', {
      params: { include_archived: includeArchived },
    })
    return data
  },

  markRead: async (id: number): Promise<NotificationItem> => {
    const { data } = await http.post<NotificationItem>(`/notifications/${id}/read`)
    return data
  },

  markAllRead: async (): Promise<{ updated: number }> => {
    const { data } = await http.post<{ updated: number }>('/notifications/read-all')
    return data
  },

  archive: async (id: number): Promise<NotificationItem> => {
    const { data } = await http.post<NotificationItem>(`/notifications/${id}/archive`)
    return data
  },
}
