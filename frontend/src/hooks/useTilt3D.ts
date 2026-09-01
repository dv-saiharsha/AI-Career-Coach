'use client'

import { useRef } from 'react'
import { useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

export interface Tilt3DHandle {
  ref: React.RefObject<HTMLDivElement | null>
  rotateX: MotionValue<number>
  rotateY: MotionValue<number>
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
  style: { transformStyle: 'preserve-3d'; perspective: number }
}

/**
 * Cursor-tracked 3D tilt for a hover card — pointer position within the
 * element maps to a small rotation on each axis, sprung back to flat on
 * mouseleave rather than snapping.
 *
 * Raw pointer deltas feed straight into springs, not React state: state would
 * re-render the component on every mousemove frame, where a motion value
 * updates the compositor directly. This is the same reasoning that moved
 * Button's press feedback off Framer (see button.tsx) — a hover effect that
 * fires on every pixel of mouse travel is exactly the wrong place to pay a
 * React render.
 *
 * Disabled under prefers-reduced-motion: tilt is a vestibular-trigger motion
 * pattern (parallax-like), not just a duration to shorten, so it's turned
 * off entirely rather than sped up.
 */
export function useTilt3D(maxDegrees = 8): Tilt3DHandle {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = usePrefersReducedMotion()

  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const springConfig = { stiffness: 300, damping: 30, mass: 0.8 }
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [maxDegrees, -maxDegrees]), springConfig)
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-maxDegrees, maxDegrees]), springConfig)

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduceMotion || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    rawX.set((e.clientX - rect.left) / rect.width - 0.5)
    rawY.set((e.clientY - rect.top) / rect.height - 0.5)
  }

  function onMouseLeave() {
    rawX.set(0)
    rawY.set(0)
  }

  return {
    ref,
    rotateX,
    rotateY,
    onMouseMove,
    onMouseLeave,
    style: { transformStyle: 'preserve-3d', perspective: 1000 },
  }
}
