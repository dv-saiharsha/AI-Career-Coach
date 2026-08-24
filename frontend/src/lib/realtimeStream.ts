'use client'

/**
 * SSE client built on fetch, not EventSource.
 *
 * EventSource cannot do this job here. Its constructor accepts only a URL and
 * `withCredentials` — there is no way to set an Authorization header, and the
 * backend authenticates with the same Bearer dependency as every other route.
 * The usual workaround is putting the JWT in the query string, but a Supabase
 * access token grants full account access and URLs end up in server access
 * logs, browser history, and Referer headers.
 *
 * fetch + ReadableStream sends the header properly, works cross-origin under
 * normal CORS (frontend :3000, API :8000), and gives us an AbortController for
 * clean teardown. The cost is parsing the wire format ourselves, which is the
 * small function below.
 */

import { createClient } from './supabase/client'

export interface StreamEvent {
  type: string
  data: unknown
}

export interface RealtimeStreamOptions {
  onEvent: (event: StreamEvent) => void
  onStatusChange?: (status: 'connecting' | 'open' | 'closed') => void
  signal: AbortSignal
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api'

// Reconnect backoff. Capped so a backend that is down for a while doesn't get
// hammered, but a transient blip still recovers quickly.
const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 30000

/**
 * Parse one SSE frame into {type, data}.
 *
 * Returns null for frames with no data line (bare comments/keep-alives), so
 * callers never see a half-formed event.
 */
export function parseFrame(frame: string): StreamEvent | null {
  let type = 'message'
  const dataLines: string[] = []

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue // comment
    if (line.startsWith('event:')) {
      type = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (dataLines.length === 0) return null

  const raw = dataLines.join('\n')
  try {
    return { type, data: JSON.parse(raw) }
  } catch {
    // The server always sends JSON, but a proxy injecting an error page
    // shouldn't throw inside the read loop and kill the stream.
    return { type, data: raw }
  }
}

/**
 * Split a buffer on frame boundaries.
 *
 * Returns complete frames plus whatever partial text remains. A chunk from the
 * network can end mid-frame, so the remainder must be carried into the next
 * read rather than parsed as if it were whole.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  // Normalised first: the SSE spec allows CRLF, and a stray \r would otherwise
  // survive into the parsed values.
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  return { frames: parts.filter((p) => p.trim().length > 0), rest }
}

/**
 * Connect and read until aborted, reconnecting with backoff.
 *
 * Resolves only when `signal` aborts — callers run it without awaiting and
 * abort on unmount.
 */
export async function connectRealtimeStream({
  onEvent,
  onStatusChange,
  signal,
}: RealtimeStreamOptions): Promise<void> {
  let retryDelay = INITIAL_RETRY_MS

  while (!signal.aborted) {
    onStatusChange?.('connecting')
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        // Not signed in yet. Wait rather than opening a stream that would be
        // rejected — a 401 loop would retry forever at full speed.
        await delay(retryDelay, signal)
        continue
      }

      const response = await fetch(`${API_BASE}/events/stream`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: 'text/event-stream',
        },
        signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`stream failed: ${response.status}`)
      }

      onStatusChange?.('open')
      // Reset only after a successful open, so a run of failures keeps backing
      // off instead of resetting on every attempt.
      retryDelay = INITIAL_RETRY_MS

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        // stream: true so a multi-byte character split across chunk
        // boundaries is decoded correctly rather than as replacement chars.
        buffer += decoder.decode(value, { stream: true })

        const { frames, rest } = splitFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          const event = parseFrame(frame)
          if (event) onEvent(event)
        }
      }
    } catch (error) {
      // An abort is the expected way this ends — not an error worth logging.
      if (signal.aborted || (error as Error)?.name === 'AbortError') break
    }

    onStatusChange?.('closed')
    if (signal.aborted) break
    await delay(retryDelay, signal)
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
  }

  onStatusChange?.('closed')
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
