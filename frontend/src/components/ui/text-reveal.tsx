'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { inView, springSoft } from '@/lib/motion'

export interface TextRevealProps {
  children: string
  className?: string
  /** Seconds between each word. */
  stagger?: number
  delay?: number
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span'
  /** Reveal on scroll into view instead of on mount. */
  onScroll?: boolean
}

/**
 * Word-by-word rise.
 *
 * Splitting text into spans hides it from some assistive tech, so the source
 * string is kept intact in an sr-only node and the animated copy is marked
 * aria-hidden. Under reduced motion the text simply renders.
 */
export function TextReveal({
  children,
  className,
  stagger = 0.045,
  delay = 0,
  as: Tag = 'span',
  onScroll = false,
}: TextRevealProps) {
  const reduce = useReducedMotion()
  const words = React.useMemo(() => children.split(' '), [children])

  if (reduce) {
    return <Tag className={className}>{children}</Tag>
  }

  const animateProps = onScroll
    ? { whileInView: 'show' as const, viewport: inView }
    : { animate: 'show' as const }

  return (
    <Tag className={className}>
      <span className="sr-only">{children}</span>
      <motion.span
        aria-hidden="true"
        initial="hidden"
        {...animateProps}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: stagger, delayChildren: delay } },
        }}
        className="inline"
      >
        {words.map((word, i) => (
          <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              variants={{
                hidden: { y: '110%', opacity: 0 },
                show: { y: '0%', opacity: 1, transition: springSoft },
              }}
            >
              {word}
              {i < words.length - 1 ? ' ' : ''}
            </motion.span>
          </span>
        ))}
      </motion.span>
    </Tag>
  )
}

/** Same idea at character granularity — use sparingly, on short strings. */
export function CharReveal({
  children,
  className,
  stagger = 0.02,
  delay = 0,
}: Omit<TextRevealProps, 'as' | 'onScroll'>) {
  const reduce = useReducedMotion()
  if (reduce) return <span className={className}>{children}</span>

  return (
    <span className={cn('inline-block', className)}>
      <span className="sr-only">{children}</span>
      <motion.span
        aria-hidden="true"
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: stagger, delayChildren: delay } },
        }}
      >
        {children.split('').map((char, i) => (
          <motion.span
            key={i}
            className="inline-block"
            variants={{
              hidden: { y: '60%', opacity: 0 },
              show: { y: '0%', opacity: 1, transition: springSoft },
            }}
          >
            {char === ' ' ? ' ' : char}
          </motion.span>
        ))}
      </motion.span>
    </span>
  )
}
