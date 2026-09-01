'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/apiClient'
import { useRealtimeStream } from './useRealtimeStream'

const NOTIFICATIONS_KEY = ['notifications']

/**
 * The Notification Center's one data source. Mounts useRealtimeStream —
 * this is that hook's first real caller anywhere in the app (see
 * lib/realtimeStream.ts / core/events.py: the SSE pipe already existed but
 * had no subscriber). Reused here rather than polling: a "notification"
 * event on the wire invalidates this query, which refetches the same list a
 * page reload would show.
 */
export function useNotifications() {
  const queryClient = useQueryClient()
  useRealtimeStream()

  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: getNotifications,
    staleTime: 30_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
  })

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
  })

  const archiveMutation = useMutation({
    mutationFn: archiveNotification,
    onSuccess: invalidate,
  })

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unread_count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    markRead: markReadMutation.mutate,
    markAllRead: markAllReadMutation.mutate,
    archive: archiveMutation.mutate,
  }
}
