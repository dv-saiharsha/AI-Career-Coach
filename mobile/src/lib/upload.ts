import { supabase } from './supabase'
import { API_BASE_URL, ApiError } from './api'

/**
 * Multipart upload with real progress.
 *
 * `fetch` cannot report upload progress — the spec has no hook for it, and
 * streaming request bodies are not supported on React Native — so this goes
 * through XMLHttpRequest, which can. Exactly the same reason the web client
 * keeps an XHR path for its two resume uploads.
 *
 * On a phone this matters more than it does on a desktop. A 4MB CV over a
 * poor mobile connection is tens of seconds, and a spinner with no number
 * next to it is indistinguishable from a hang.
 */

export interface UploadProgress {
  /** 0–100, or null while the total length is still unknown. */
  percent: number | null
  loaded: number
  total: number | null
}

export interface PickedFile {
  uri: string
  name: string
  mimeType: string
  size: number
}

/** 10MB, matching MAX_RESUME_UPLOAD_BYTES on the server. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/**
 * Checked here as well as on the server, and the two limits are the same
 * number on purpose. Client-side is the courtesy — it fails in a tenth of a
 * second instead of after a two-minute upload — and the server is the rule.
 */
export function rejectionReason(file: PickedFile): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `That file is ${mb}MB. Resumes need to be under 10MB.`
  }
  if (!ACCEPTED_TYPES.includes(file.mimeType)) {
    return 'That has to be a PDF or a Word document.'
  }
  return null
}

export async function uploadResume<T>(
  file: PickedFile,
  jobDescription: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const form = new FormData()
  /* React Native's FormData takes this shape rather than a Blob — the
     bridge reads the file off disk by uri at send time, so a large CV never
     passes through JavaScript memory. */
  form.append('resume', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob)
  form.append('job_description', jobDescription)

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/resume/analyze`)
    if (session?.access_token) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    }
    /* Content-Type is deliberately not set: only the platform knows the
       multipart boundary it is about to generate. */

    xhr.upload.addEventListener('progress', (event) => {
      onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
        percent: event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null,
      })
    })

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = `Upload failed (${xhr.status}).`
        try {
          const body = JSON.parse(xhr.responseText)
          if (typeof body?.detail === 'string') detail = body.detail
        } catch {
          /* keep the status-code message */
        }
        reject(new ApiError(xhr.status, xhr.responseText, detail))
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T)
      } catch {
        reject(new ApiError(xhr.status, xhr.responseText, 'The server sent back something unreadable.'))
      }
    })

    xhr.addEventListener('error', () =>
      reject(new ApiError(0, null, "Couldn't reach ApplyCenter. Check your connection.", true)),
    )
    xhr.addEventListener('abort', () =>
      reject(new ApiError(0, null, 'Upload cancelled.', true)),
    )

    xhr.send(form)
  })
}
