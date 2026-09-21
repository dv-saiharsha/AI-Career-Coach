'use client'

import { useEffect, useState } from 'react'

/**
 * Milliseconds remaining until `targetIso`, ticking down once a second.
 *
 * Recomputed from the wall clock on every tick rather than decremented, so a
 * backgrounded tab that misses several timer callbacks catches up to the
 * real remaining time the instant it's visible again, instead of a
 * countdown that's simply behind. Returns null when there's no target —
 * "no schedule" and "0:00 remaining" are different claims.
 */
export function useCountdown(targetIso: string | null): number | null {
  const target = targetIso ? new Date(targetIso).getTime() : null
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  useEffect(() => {
    // One function for both branches rather than a bare setRemainingMs(null)
    // early return — Date.now() belongs behind the effect boundary, never in
    // a useState initializer, which re-runs it on every render rather than
    // only on mount.
    const tick = () => setRemainingMs(target === null ? null : Math.max(0, target - Date.now()))
    tick()
    if (target === null) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])

  return remainingMs
}

/** "42:17", or "1:02:17" past an hour. Never negative — once a countdown
 *  reaches zero it holds at "0:00" until the feed it's timing actually
 *  refetches and hands back a new target. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}
