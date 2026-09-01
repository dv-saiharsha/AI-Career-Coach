'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectRealtimeStream, type StreamEvent } from '@/lib/realtimeStream'

export type StreamStatus = 'connecting' | 'open' | 'closed'

/**
 * Which query keys each event invalidates.
 *
 * Invalidation, not cache patching: the event payload says *that* something
 * changed, and refetching is what guarantees the client converges on real
 * server state. Splicing a payload into the cache would drift whenever the
 * event shape and the endpoint's response shape disagree — and it would be
 * wrong outright after a dropped connection, where events were missed
 * entirely.
 */
const INVALIDATIONS: Record<string, readonly (readonly unknown[])[]> = {
  job_match: [['jobs'], ['analytics', 'summary']],
  pipeline_update: [['applications'], ['analytics', 'summary']],
  offer_update: [['offers'], ['analytics', 'summary']],
  scan_complete: [['analytics', 'summary'], ['resume', 'history']],
  notification: [['notifications']],
}

export interface UseRealtimeStreamOptions {
  /** Extra handling beyond cache invalidation — toasts, badges, etc. */
  onEvent?: (event: StreamEvent) => void
  enabled?: boolean
}

export function useRealtimeStream({ onEvent, enabled = true }: UseRealtimeStreamOptions = {}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StreamStatus>('closed')

  // Held in a ref so a caller passing an inline arrow function doesn't tear
  // down and reopen the stream on every render.
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()

    // Not awaited: this resolves only when the stream is aborted, which is on
    // unmount. The effect must return its cleanup synchronously.
    void connectRealtimeStream({
      signal: controller.signal,
      onStatusChange: setStatus,
      onEvent: (event) => {
        for (const key of INVALIDATIONS[event.type] ?? []) {
          queryClient.invalidateQueries({ queryKey: key })
        }
        onEventRef.current?.(event)
      },
    })

    return () => controller.abort()
  }, [enabled, queryClient])

  return { status }
}
