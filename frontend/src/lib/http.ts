import { signOut } from 'firebase/auth'
import { auth, getIdToken } from './firebase'

/* A very small fetch-based HTTP client with a consistent shape across the
   app: `.get`, `.post`, `.patch`, `.delete`, each resolving to `{ data,
   status }`, every call carrying the signed-in user's Firebase ID token.

   Three behaviours matter to callers:
     1. A non-2xx response throws HttpError, which carries `response.status`
        and `response.data` (the parsed JSON body, so FastAPI's `detail`
        field is reachable).
     2. Undefined query params are dropped rather than serialised as the
        string "undefined".
     3. FormData bodies get no Content-Type header — the browser sets its
        own multipart boundary. */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

export interface HttpResponse<T> {
  data: T
  status: number
}

export class HttpError extends Error {
  response: { status: number; statusText: string; data: unknown }

  constructor(status: number, statusText: string, data: unknown, url: string) {
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof (data as Record<string, unknown>).detail === 'string'
        ? ((data as Record<string, unknown>).detail as string)
        : `Request failed with status ${status} for ${url}`
    super(detail)
    this.name = 'HttpError'
    this.response = { status, statusText, data }
  }
}

export interface RequestConfig {
  params?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
  responseType?: 'blob'
  signal?: AbortSignal
}

function buildUrl(path: string, params?: RequestConfig['params']): string {
  const url = `${BASE_URL}${path}`
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const query = search.toString()
  return query ? `${url}?${query}` : url
}

async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const token = await getIdToken(forceRefresh)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** The API's way of saying "this email address has not been verified". */
export const EMAIL_NOT_VERIFIED = 'email_not_verified'

export function isEmailNotVerified(err: unknown): boolean {
  if (!(err instanceof HttpError) || err.response.status !== 403) return false
  const data = err.response.data
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).detail === EMAIL_NOT_VERIFIED
}

async function send(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  config: RequestConfig,
  forceRefresh: boolean
): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = {
    ...(await authHeaders(forceRefresh)),
    ...config.headers,
  }
  if (isForm) delete headers['Content-Type']
  else if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(buildUrl(path, config.params), {
    method,
    headers,
    signal: config.signal,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })
}

/** Whether a fresh token could change the answer: the token was rejected, or it
 * predates the person verifying their email (the verified flag is a claim
 * baked into the token when it was minted). */
async function tokenMayBeStale(response: Response): Promise<boolean> {
  if (response.status === 401) return true
  if (response.status !== 403) return false
  try {
    const data = await response.clone().json()
    return data?.detail === EMAIL_NOT_VERIFIED
  } catch {
    return false
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  config: RequestConfig = {}
): Promise<HttpResponse<T>> {
  let response = await send(method, path, body, config, false)

  // One retry with a forced-fresh token, never more. If that is rejected too
  // the account is gone or disabled server-side, so end the local session;
  // ProtectedRoute then sends the person to /login. A 503 is deliberately NOT
  // handled here: it means authentication is temporarily unavailable, not that
  // the person is signed out, and signing them out would turn a blip into a
  // forced re-login.
  if (auth.currentUser && (await tokenMayBeStale(response))) {
    response = await send(method, path, body, config, true)
    if (response.status === 401) void signOut(auth)
  }

  if (!response.ok) {
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

  if (response.status === 204) return { data: undefined as T, status: response.status }
  const text = await response.text()
  return {
    data: (text ? JSON.parse(text) : undefined) as T,
    status: response.status,
  }
}

export const http = {
  defaults: { baseURL: BASE_URL },
  get: <T = unknown>(path: string, config?: RequestConfig) => request<T>('GET', path, undefined, config),
  post: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) => request<T>('POST', path, body, config),
  patch: <T = unknown>(path: string, body?: unknown, config?: RequestConfig) => request<T>('PATCH', path, body, config),
  delete: <T = unknown>(path: string, config?: RequestConfig) => request<T>('DELETE', path, undefined, config),
}
