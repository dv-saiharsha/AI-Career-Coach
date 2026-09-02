import Constants from 'expo-constants'
import { supabase } from './supabase'

/**
 * The API client, deliberately the same shape as the web's lib/http.ts.
 *
 * Two products talk to one FastAPI backend, so a divergence here shows up as
 * one platform quietly sending a different payload than the other. Same
 * method surface, same `{ data }` return, same error object carrying
 * `response.status` and `response.data` — so a fix in either place reads the
 * same way in both.
 *
 * What is different is mobile-specific and stated rather than assumed:
 *
 *   A timeout. A phone on a train does not fail a request, it hangs, and a
 *   spinner that never resolves is worse than an error that arrives. Twenty
 *   seconds, via AbortController.
 *
 *   A distinguishable offline error. `fetch` rejects with a TypeError for
 *   both "no network" and "DNS failed", and a screen that says "check your
 *   connection" is only correct for one of them — but it is the one that is
 *   almost always true on a device, so it is worth naming.
 */

const extra = Constants.expoConfig?.extra as Record<string, string> | undefined

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? extra?.apiBaseUrl ?? 'http://localhost:8000/api'

const TIMEOUT_MS = 20_000

export class ApiError extends Error {
  name = 'ApiError'
  response: { status: number; data: unknown }
  /** True when the request never reached the server. */
  offline: boolean

  constructor(status: number, data: unknown, message: string, offline = false) {
    super(message)
    this.response = { status, data }
    this.offline = offline
  }
}

interface RequestConfig {
  params?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
}

function buildUrl(path: string, params?: RequestConfig['params']): string {
  const url = `${API_BASE_URL}${path}`
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const query = search.toString()
  return query ? `${url}?${query}` : url
}

async function authHeader(): Promise<Record<string, string>> {
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
): Promise<{ data: T; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // Honour a caller's own cancellation as well as the timeout.
  config.signal?.addEventListener('abort', () => controller.abort())

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers: Record<string, string> = { ...(await authHeader()) }
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, config.params), {
      method,
      headers,
      signal: controller.signal,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new ApiError(
      0,
      null,
      aborted
        ? 'That took too long. Your connection may be slow — try again.'
        : "Couldn't reach ApplyCenter. Check your connection.",
      true,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
        ? data.detail
        : `Something went wrong (${response.status}).`
    throw new ApiError(response.status, data, detail)
  }

  if (response.status === 204) return { data: undefined as T, status: response.status }
  const text = await response.text()
  return { data: (text ? JSON.parse(text) : undefined) as T, status: response.status }
}

export const api = {
  get: <T>(path: string, config?: RequestConfig) => request<T>('GET', path, undefined, config),
  post: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('POST', path, body, config),
  patch: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    request<T>('PATCH', path, body, config),
  delete: <T>(path: string, config?: RequestConfig) =>
    request<T>('DELETE', path, undefined, config),
}
