import { http } from '@/lib/http'
import type {
  AccountDeletionResult,
  ActivityResponseSchema,
  ProfileSchema,
  ProfileUpdatePayload,
  UserStatsSchema,
} from '@/types/profile'

// Thin wrapper around the /api/user endpoints (backend/app/modules/user_profile).
// Used by both ProfilePage (career details, activity) and SettingsPage
// (data export, account deletion) since they're all scoped to the same
// signed-in-user resource on the backend.
export const profileService = {
  getProfile: async (): Promise<ProfileSchema> => {
    const { data } = await http.get<ProfileSchema>('/user/profile')
    return data
  },

  updateProfile: async (payload: ProfileUpdatePayload): Promise<ProfileSchema> => {
    const { data } = await http.patch<ProfileSchema>('/user/profile', payload)
    return data
  },

  getStats: async (): Promise<UserStatsSchema> => {
    const { data } = await http.get<UserStatsSchema>('/user/stats')
    return data
  },

  getActivity: async (): Promise<ActivityResponseSchema> => {
    const { data } = await http.get<ActivityResponseSchema>('/user/activity')
    return data
  },

  // Arbitrary JSON blob of everything held about the caller. Left untyped —
  // the shape is "everything", not a fixed schema — and handed to the
  // caller to turn into a downloaded file.
  exportData: async (): Promise<unknown> => {
    const { data } = await http.get<unknown>('/user/export')
    return data
  },

  // Irreversible. confirm=DELETE lives in the query string, mirroring the
  // backend's own guard against a client that silently drops DELETE bodies.
  deleteAccount: async (): Promise<AccountDeletionResult> => {
    const { data } = await http.delete<AccountDeletionResult>('/user/account', {
      params: { confirm: 'DELETE' },
    })
    return data
  },
}

// Triggers a browser download of `data` as a pretty-printed JSON file.
export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
