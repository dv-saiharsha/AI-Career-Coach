// Mirrors backend/app/schemas/notification.py exactly.

export type NotificationCategory =
  | 'resume'
  | 'job_match'
  | 'application'
  | 'interview'
  | 'milestone'
  | string

export interface NotificationItem {
  id: number
  type: string
  category: NotificationCategory
  priority: string
  title: string
  message: string
  href: string | null
  occurrence_count: number
  read_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationListResponse {
  notifications: NotificationItem[]
  unread_count: number
}
