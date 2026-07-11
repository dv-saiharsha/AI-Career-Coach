'use client'

import { useEffect, useRef, useState } from 'react'

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
  const [display, setDisplay] = useState(text)
  const done = useRef(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setDisplay(text)
      onDone?.()
      return
    }

    let raf = 0
    let startTimeout: ReturnType<typeof setTimeout>

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

    startTimeout = setTimeout(run, delay)
    return () => {
      clearTimeout(startTimeout)
      cancelAnimationFrame(raf)
    }
  }, [text, duration, delay, onDone])

  return <span className={className}>{display}</span>
}
