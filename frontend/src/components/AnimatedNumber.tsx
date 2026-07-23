'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

export default function AnimatedNumber({ value, duration = 1400 }: { value: number; duration?: number }) {
  const reduce = usePrefersReducedMotion()
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (reduce) return

    const node = ref.current
    if (!node) return

    const run = () => {
      if (started.current) return
      started.current = true
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - p, 3)
        setDisplay(Math.round(eased * value))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && run()),
        { threshold: 0.5 },
      )
      io.observe(node)
      return () => io.disconnect()
    }
    run()
  }, [value, duration, reduce])

  return <span ref={ref}>{reduce ? value : display}</span>
}
