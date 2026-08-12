import { createBrowserClient } from '@supabase/ssr'

/**
 * Retry a request once on a transient network failure.
 *
 * supabase-js runs a background token refresh on tab visibility change. If the
 * machine was asleep or off-network at that moment the request rejects with a
 * bare `TypeError: Failed to fetch` before the connection is back, which
 * surfaces as an uncaught console error even though the session is fine.
 *
 * A network-layer rejection is the only case retried here — any HTTP response,
 * including 4xx/5xx, is passed straight through so real auth errors keep their
 * status and body.
 */
async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    // Don't retry a caller-initiated abort — that rejection is intentional.
    if (err instanceof DOMException && err.name === 'AbortError') throw err

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Offline: wait for the connection rather than burning an instant retry.
      await new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener('online', done)
          resolve()
        }
        window.addEventListener('online', done, { once: true })
        setTimeout(done, 5000)
      })
    } else {
      await new Promise((resolve) => setTimeout(resolve, 600))
    }

    return fetch(input, init)
  }
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { fetch: fetchWithRetry } }
  )
}
