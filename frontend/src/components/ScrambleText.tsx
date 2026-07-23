'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

export default function ScrambleText({
  text,
  duration = 900,
  delay = 0,
  onDone,
  className = '',
}: {
  text: string
  duration?: number
  delay?: number
  onDone?: () => void
  className?: string
}) {
  const reduce = usePrefersReducedMotion()
  const [display, setDisplay] = useState(text)
  const done = useRef(false)

  useEffect(() => {
    if (reduce) {
      onDone?.()
      return
    }

    let raf = 0

    const run = () => {
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration)
        const revealCount = Math.floor(p * text.length)
        let next = ''
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '<' || text[i] === ' ') {
            next += text[i]
          } else if (i < revealCount) {
            next += text[i]
          } else {
            next += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          }
        }
        setDisplay(next)
        if (p < 1) {
          raf = requestAnimationFrame(tick)
        } else if (!done.current) {
          done.current = true
          setDisplay(text)
          onDone?.()
        }
      }
      raf = requestAnimationFrame(tick)
    }

    const startTimeout = setTimeout(run, delay)
    return () => {
      clearTimeout(startTimeout)
      cancelAnimationFrame(raf)
    }
  }, [text, duration, delay, onDone, reduce])

  return <span className={className}>{reduce ? text : display}</span>
}
