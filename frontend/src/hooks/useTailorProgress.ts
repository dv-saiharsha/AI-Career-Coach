'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Progress that reports what actually happened.
 *
 * The obvious implementation advances stages on a timer — 1.2s, then 2.5s,
 * then done — which looks smooth and is a lie. It claims "Building your PDF"
 * before the build has started, finishes early on a slow request, and finishes
 * at the same moment whether the backend answered in 200ms or timed out.
 *
 * Here a stage only completes when its network call resolves, so a slow stage
 * visibly takes longer and the bar says something true about where the time is
 * going. Nothing is animated between stages, because there is nothing real to
 * animate — the elapsed clock carries that instead, and it is real wall time.
 */
export interface ProgressStep {
  key: string
  label: string
}

export type StepState = 'pending' | 'active' | 'done' | 'failed'

export function useTailorProgress(steps: ProgressStep[]) {
  const [states, setStates] = useState<Record<string, StepState>>({})
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAt = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  // The clock runs only while something is in flight. Leaving it ticking after
  // the last stage would show a number that keeps climbing for work that
  // finished, which is the same category of dishonesty as a scripted bar.
  const begin = useCallback((key: string) => {
    if (startedAt.current === null) startedAt.current = performance.now()
    setStates((prev) => ({ ...prev, [key]: 'active' }))
    if (!timer.current) {
      timer.current = setInterval(() => {
        if (startedAt.current !== null) setElapsedMs(performance.now() - startedAt.current)
      }, 100)
    }
  }, [])

  const finish = useCallback(
    (key: string, ok = true) => {
      setStates((prev) => {
        const next = { ...prev, [key]: ok ? ('done' as const) : ('failed' as const) }
        const settled = steps.every((s) => next[s.key] === 'done' || next[s.key] === 'failed')
        if (settled || !ok) stop()
        return next
      })
    },
    [steps, stop],
  )

  const reset = useCallback(() => {
    stop()
    startedAt.current = null
    setElapsedMs(0)
    setStates({})
  }, [stop])

  useEffect(() => stop, [stop])

  const stateOf = useCallback(
    (key: string): StepState => states[key] ?? 'pending',
    [states],
  )
  const doneCount = steps.filter((s) => states[s.key] === 'done').length

  return {
    stateOf,
    begin,
    finish,
    reset,
    elapsedMs,
    /** Fraction of steps genuinely completed — not a smoothed estimate. */
    ratio: steps.length ? doneCount / steps.length : 0,
  }
}
