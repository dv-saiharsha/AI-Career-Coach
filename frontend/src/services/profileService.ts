import { http } from '@/lib/http'
import type {
  AccountDeletionResult,
  ActivityResponseSchema,
  AvatarUploadDescriptor,
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

  // Profile photos go browser -> Cloud Storage directly; the API only signs the upload and
  // then checks what landed. Three steps: ask for a signed policy, post the file to it,
  // confirm. The storage POST is a plain multipart form (not the API client): it carries no
  // Authorization header, the signed fields are the credential.
  requestAvatarUpload: async (contentType: string): Promise<AvatarUploadDescriptor> => {
    const { data } = await http.post<AvatarUploadDescriptor>('/user/avatar/upload-url', {
      content_type: contentType,
    })
    return data
  },

  uploadAvatarToStorage: async (upload: AvatarUploadDescriptor, file: File): Promise<void> => {
    const form = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
    // Cloud Storage requires the file to be the LAST field of the form.
    form.append('file', file)
    const response = await fetch(upload.url, { method: 'POST', body: form })
    if (!response.ok) {
      throw new Error(
        response.status === 400 || response.status === 403
          ? 'That photo was not accepted. Use a JPEG, PNG or WebP image under the size limit.'
          : 'Could not upload your photo. Please try again.'
      )
    }
  },

  confirmAvatar: async (path: string): Promise<ProfileSchema> => {
    const { data } = await http.post<ProfileSchema>('/user/avatar/confirm', { path })
    return data
  },

  removeAvatar: async (): Promise<ProfileSchema> => {
    const { data } = await http.delete<ProfileSchema>('/user/avatar')
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
