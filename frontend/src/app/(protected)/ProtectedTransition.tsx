'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Route-level enter choreography for the workspace.
 *
 * The animation is a CSS keyframe on `.route-enter` (see globals.css). The
 * pathname key is what drives it: a navigation remounts this element, and a
 * freshly mounted element runs its animation again. No state, no library, no
 * JavaScript on the transition path at all.
 *
 * The Framer version chose between two presets by route, because the richer
 * one used a backdrop blur and `filter` repaints the whole subtree per frame
 * — unaffordable on the chart- and list-dense pages. Dropping the blur drops
 * the need to special-case those routes, so the HEAVY_ROUTES list goes with
 * it. Reduced motion is handled in the stylesheet rather than by branching
 * here on useReducedMotion.
 */
export function ProtectedTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  )
}
