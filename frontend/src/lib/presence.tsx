'use client'

import * as React from 'react'

/* ────────────────────────────────────────────────────────────────────────
   PRESENCE

   The one thing CSS cannot do alone: keep an element in the tree long
   enough to animate out of it. `AnimatePresence` did this, and brought 43KB
   of framer-motion with it for what is, in the end, a timeout.

   A component under <Presence> is rendered while `open` is true and for
   `duration` after it goes false, carrying `data-state="open" | "closed"`
   throughout. Every transition — both directions — lives in CSS keyed on
   that attribute, so the shape of the animation stays in the stylesheet
   with the rest of the design system rather than in props.

   `duration` must be at least as long as the CSS transition, or the element
   unmounts mid-animation. The exported EXIT_MS constants are the durations
   the stylesheet actually uses; prefer them over a literal.
   ──────────────────────────────────────────────────────────────────────── */

/** Panels, inline reveals, accordion bodies. */
export const EXIT_FAST = 180
/** Drawers and modals — further to travel, so slightly longer. */
export const EXIT_SLOW = 240

export type PresenceState = 'open' | 'closed'

interface PresenceProps {
  open: boolean
  /** Must be >= the CSS exit transition. Use EXIT_FAST / EXIT_SLOW. */
  duration?: number
  children: React.ReactNode | ((state: PresenceState) => React.ReactNode)
}

export function Presence({ open, duration = EXIT_FAST, children }: PresenceProps) {
  const [closing, setClosing] = React.useState(false)
  const [seen, setSeen] = React.useState(open)

  /* Adjusted during render rather than in an effect. An effect would paint
     one frame of the closed state before the exit transition could start,
     which reads as a flicker; React supports setting state during render for
     exactly this "derive from a changed prop" case, and re-renders before
     committing anything to the DOM. Previous value is held in state rather
     than a ref because a ref written during render is not safe under
     concurrent rendering. */
  if (seen !== open) {
    setSeen(open)
    setClosing(!open)
  }

  React.useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => setClosing(false), duration)
    return () => clearTimeout(timer)
  }, [closing, duration])

  if (!open && !closing) return null

  const state: PresenceState = open ? 'open' : 'closed'
  return <>{typeof children === 'function' ? children(state) : children}</>
}

/**
 * For the common case where the animated element is the direct child and
 * only needs the attribute spread onto it.
 *
 * `<div {...presenceProps(state)} className="panel-reveal">`
 */
export function presenceProps(state: PresenceState) {
  return { 'data-state': state }
}
