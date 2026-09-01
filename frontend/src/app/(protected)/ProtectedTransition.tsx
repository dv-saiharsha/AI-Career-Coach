'use client'

import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { PAGE_TRANSITION, PAGE_TRANSITION_FAST } from '@/lib/motion'

/**
 * Route-level enter choreography for the workspace.
 *
 * Blur is skipped on the chart- and list-dense routes: `filter` repaints the
 * whole subtree per frame, and on those pages the subtree is hundreds of
 * nodes plus an SVG chart. The lighter variant is visually near-identical at
 * the speed this runs, and costs nothing.
 */
const HEAVY_ROUTES = ['/dashboard', '/analytics', '/history', '/applications', '/interview']

export function ProtectedTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduce = useReducedMotion()

  const preset = HEAVY_ROUTES.some((route) => pathname.startsWith(route))
    ? PAGE_TRANSITION_FAST
    : PAGE_TRANSITION

  // Reduced motion keeps the fade (an opacity change is not vestibular) but
  // drops the travel and the blur entirely.
  if (reduce) {
    return (
      <motion.div key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {children}
      </motion.div>
    )
  }

  return (
    <motion.div
      key={pathname}
      initial={preset.initial}
      animate={preset.animate}
      transition={preset.transition}
    >
      {children}
    </motion.div>
  )
}
