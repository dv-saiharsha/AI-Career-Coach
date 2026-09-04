'use client'

/**
 * A hairline bar at the top of the viewport while the app is talking to the
 * API.
 *
 * WHY A DELAY, AND WHY A MINIMUM
 *
 * Two thresholds, and both exist because the naive version is worse than
 * nothing.
 *
 * APPEAR_AFTER_MS keeps the bar off screen for requests that finish quickly.
 * Most calls here return in well under 200ms, and a bar that flashes on every
 * one of them reads as a glitch rather than as feedback — the user learns to
 * ignore it, which is the opposite of the point.
 *
 * MIN_VISIBLE_MS is the other half. Once the bar has appeared it stays for a
 * beat even if the response lands immediately after, because something that
 * appears and vanishes within a frame or two is a flicker, not a signal.
 *
 * Net effect: the bar is silent for the fast path and present for the slow
 * one, which is the only case where it is telling the user anything.
 *
 * This is deliberately NOT a substitute for local loading state. It answers
 * "is the app doing something" — a skeleton in the panel that is about to
 * fill answers "what", and both are needed. Anything that owns a region of
 * the page should still show its own skeleton or button spinner.
 */

import { useEffect, useState } from 'react'
import { onInflightChange } from '@/lib/http'

const APPEAR_AFTER_MS = 200
const MIN_VISIBLE_MS = 400

export function NetworkActivityBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let appearTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let shownAt = 0
    let active = false

    const clear = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer)
      return null
    }

    const unsubscribe = onInflightChange((count) => {
      if (count > 0) {
        if (active) return
        active = true
        hideTimer = clear(hideTimer)
        appearTimer = setTimeout(() => {
          shownAt = Date.now()
          setVisible(true)
        }, APPEAR_AFTER_MS)
        return
      }

      // Idle. If the bar never appeared, cancel it and leave no trace.
      active = false
      appearTimer = clear(appearTimer)
      if (shownAt === 0) return

      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
      hideTimer = setTimeout(() => {
        shownAt = 0
        setVisible(false)
      }, remaining)
    })

    return () => {
      unsubscribe()
      clear(appearTimer)
      clear(hideTimer)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
    >
      <div
        className={`h-full origin-left bg-accent transition-opacity duration-200 motion-safe:animate-network-sweep ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}
