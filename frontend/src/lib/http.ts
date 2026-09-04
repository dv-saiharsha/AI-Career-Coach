'use client'

import { createClient } from './supabase/client'

/* ────────────────────────────────────────────────────────────────────────
   A very small axios.

   axios is 19KB gzipped on all sixteen app routes, and this file uses about
   eight percent of it: a base URL, a request interceptor that attaches a
   bearer token, query params, blobs, and an error object carrying the
   response. fetch does all of that.

   The surface is deliberately identical — `.get`, `.post`, `.patch`,
   `.delete`, each resolving to `{ data }`, and `.defaults.baseURL` — so all
   54 call sites in apiClient.ts are untouched by the swap. This is a port,
   not a redesign: a redesign would have meant editing every one of them for
   the same 19KB, and every edit is a chance to change behaviour by accident.

   Three behaviours are matched deliberately, because code outside this file
   depends on them:

     1. A non-2xx response throws. Three call sites read `err.response.status`
        or `err.response.data.detail`, so the thrown error carries a
        `response` object with exactly those fields.
     2. Undefined query params are dropped rather than serialised as the
        string "undefined" — apiClient.ts's job-filter code relies on it.
     3. FormData bodies get no Content-Type header. The browser must set it
        itself, because only it knows the multipart boundary.
   ──────────────────────────────────────────────────────────────────────── */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api'

export interface HttpResponse<T> {
  data: T
  status: number
}

/** Mirrors the shape of an AxiosError closely enough for existing callers. */
export class HttpError extends Error {
  response: { status: number; statusText: string; data: unknown }

  constructor(status: number, statusText: string, data: unknown, url: string) {
    /* Prefer the API's own message. FastAPI puts it in `detail`, and a
       thrown error that says "Request failed with status code 422" instead
       of "That file has no selectable text" is a worse error twice over:
       once for the user, once for whoever reads the log. */
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
        ? data.detail
        : `Request failed with status ${status} for ${url}`
    super(detail)
    this.name = 'HttpError'
    this.response = { status, statusText, data }
  }
}

/* ────────────────────────────────────────────────────────────────────────
   In-flight tracking.

   Every network call in the app goes through `request` below, which makes
   this the one place that knows whether anything is pending. Components can
   subscribe without threading a loading prop through a tree or duplicating
   react-query state for the eight pages that do not use react-query.

   Deliberately a count, not a boolean: two overlapping requests must not
   have the first one to finish declare the app idle.

   No delay or animation policy lives here — this reports facts, and
   NetworkActivityBar decides what is worth showing a user. Keeping the
   threshold out of the transport means a second consumer (a test, a debug
   overlay) sees the real number rather than one already filtered for one
   presentation.
   ──────────────────────────────────────────────────────────────────────── */

type InflightListener = (count: number) => void

let inflight = 0
const listeners = new Set<InflightListener>()

/** Subscribe to the number of requests currently in flight. Returns an
 *  unsubscribe function, so it drops straight into a useEffect. */
export function onInflightChange(listener: InflightListener): () => void {
  listeners.add(listener)
  listener(inflight)
  return () => {
    listeners.delete(listener)
  }
}

export function getInflightCount(): number {
  return inflight
}

function setInflight(next: number): void {
  inflight = next
  for (const listener of listeners) listener(inflight)
}

export interface UploadProgress {
  loaded: number
  total?: number
}

interface RequestConfig {
  params?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
  responseType?: 'blob'
  signal?: AbortSignal
  /* fetch cannot report upload progress — the spec has no hook for it, and
     streaming request bodies are not supported widely enough to fake one.
     When this is set the request goes through XMLHttpRequest instead, which
     can. Two call sites use it, both resume uploads, and both would
     otherwise show a progress bar that jumps 0 to 100. */
  onUploadProgress?: (event: UploadProgress) => void
}

function buildUrl(path: string, params?: RequestConfig['params']): string {
  const url = `${BASE_URL}${path}`
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // Matching axios: an unset filter must not become "undefined".
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const query = search.toString()
  return query ? `${url}?${query}` : url
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  config: RequestConfig = {},
): Promise<HttpResponse<T>> {
  // try/finally rather than decrementing at each return: this function has
  // four success returns and throws from three places, and a counter that
  // leaks on the error path would pin the activity bar on permanently after
  // the first failed request.
  setInflight(inflight + 1)
  try {
    return await performRequest<T>(method, path, body, config)
  } finally {
    setInflight(Math.max(0, inflight - 1))
  }
}

async function performRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  config: RequestConfig = {},
): Promise<HttpResponse<T>> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {
    ...(await authHeaders()),
    ...config.headers,
  }
  // The browser sets multipart Content-Type itself, boundary included.
  if (isForm) delete headers['Content-Type']
  else if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  if (config.onUploadProgress) {
    return uploadWithProgress<T>(method, buildUrl(path, config.params), body, headers, config)
  }

  const response = await fetch(buildUrl(path, config.params), {
    method,
    headers,
    signal: config.signal,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })

  if (!response.ok) {
    // Read the body before throwing — the API's own message lives in it.
    let data: unknown = null
    try {
      data = await response.clone().json()
    } catch {
      try {
        data = await response.text()
      } catch {
        data = null
      }
    }
    throw new HttpError(response.status, response.statusText, data, path)
  }

  if (config.responseType === 'blob') {
    return { data: (await response.blob()) as T, status: response.status }
  }

  // 204 and an empty 200 both have no body to parse.
  if (response.status === 204) return { data: undefined as T, status: response.status }
  const text = await response.text()
  return {
    data: (text ? JSON.parse(text) : undefined) as T,
    status: response.status,
  }
}

export const http = {
  defaults: { baseURL: BASE_URL },
  get: <T = unknown>(path: string, config?: RequestConfig) =>
    request<T>('GET', path, undefined, config),
  post: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('POST', path, body, config),
  patch: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('PATCH', path, body, config),
  delete: <T = unknown>(path: string, config?: RequestConfig) =>
    request<T>('DELETE', path, undefined, config),
}

/**
 * The XHR path, used only when a caller wants upload progress.
 *
 * Kept deliberately narrow: same return shape, same HttpError, so nothing
 * downstream can tell which transport ran.
 */
function uploadWithProgress<T>(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  config: RequestConfig,
): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    if (config.responseType === 'blob') xhr.responseType = 'blob'

    xhr.upload.addEventListener('progress', (event) => {
      config.onUploadProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : undefined,
      })
    })

    xhr.addEventListener('load', () => {
      const raw = xhr.response
      if (xhr.status < 200 || xhr.status >= 300) {
        let data: unknown = raw
        try {
          data = typeof raw === 'string' ? JSON.parse(raw) : raw
        } catch {
          /* leave it as the raw text */
        }
        reject(new HttpError(xhr.status, xhr.statusText, data, url))
        return
      }
      if (config.responseType === 'blob') {
        resolve({ data: raw as T, status: xhr.status })
        return
      }
      resolve({
        data: (typeof raw === 'string' && raw ? JSON.parse(raw) : undefined) as T,
        status: xhr.status,
      })
    })

    xhr.addEventListener('error', () =>
      reject(new HttpError(0, 'Network Error', null, url)),
    )
    config.signal?.addEventListener('abort', () => xhr.abort())

    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    xhr.send(body === undefined ? null : isForm ? (body as FormData) : JSON.stringify(body))
  })
}
