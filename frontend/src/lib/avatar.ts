'use client'

import { createClient } from './supabase/client'

// Bucket and policies are created by alembic revision b6d2f84a1c93.
const BUCKET = 'avatars'

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface AvatarUploadResult {
  publicUrl: string
  path: string
}

export class AvatarError extends Error {
  /* Set explicitly. A subclass of Error inherits the name "Error", so
     anything identifying it across a dynamic-import boundary — where
     `instanceof` cannot reach the class — would silently never match. */
  name = 'AvatarError'
}

/**
 * Upload an avatar straight from the browser to Supabase Storage.
 *
 * Direct-to-Storage rather than through FastAPI so image bytes never
 * round-trip the API. Safe because the bucket's RLS policies confine writes
 * to the caller's own `{uid}/…` prefix — the first path segment is compared
 * against auth.uid(), so the path below is not merely a convention.
 *
 * `previousPath` is deleted after a successful upload. Without that, every
 * upload writes a new timestamped object and orphans the old one in the
 * bucket forever, since a unique filename means `upsert` never replaces
 * anything.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
  previousPath?: string | null,
): Promise<AvatarUploadResult> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new AvatarError('Use a JPG, PNG, or WEBP image.')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarError('That image is over 5MB. Try a smaller one.')
  }

  const supabase = createClient()
  // Extension derived from the MIME type, not the filename: the type has
  // already been validated, whereas a filename is arbitrary user input that
  // could carry a misleading or absent extension.
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
  // Timestamped so the browser and any CDN fetch the new image rather than a
  // cached response for a reused URL.
  const path = `${userId}/avatar_${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new AvatarError(error.message)

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  // Best-effort: a leaked old object is untidy, but failing the upload the
  // user just completed because cleanup failed would be worse.
  if (previousPath && previousPath !== path) {
    await supabase.storage
      .from(BUCKET)
      .remove([previousPath])
      .catch(() => {})
  }

  return { publicUrl, path }
}

/**
 * Permanently remove an avatar object from Storage.
 *
 * Takes the stored object path rather than parsing it back out of the public
 * URL. Splitting the URL on '/avatars/' — as the original approach did —
 * breaks the moment the URL contains a transform query, a different CDN
 * prefix, or a user id that happens to contain the delimiter.
 */
export async function deleteAvatar(path: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new AvatarError(error.message)
}

/**
 * Derive the object path from a stored public URL.
 *
 * Fallback only, for rows written before avatar_path existed. New uploads
 * persist the path explicitly and should never need this.
 */
export function pathFromPublicUrl(url: string): string | null {
  const marker = `/${BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return null
  const path = url.slice(index + marker.length).split('?')[0]
  return path || null
}
