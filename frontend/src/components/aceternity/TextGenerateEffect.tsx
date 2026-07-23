'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

/** Words fade + un-blur in sequence — used for supporting copy under a hero headline. */
export function TextGenerateEffect({
  words,
  className,
  wordClassName,
  delay = 0,
}: {
  words: string
  className?: string
  wordClassName?: string
  delay?: number
}) {
  const reduceMotion = usePrefersReducedMotion()
  const items = words.split(' ')

  return (
    <p className={cn(className)}>
      {items.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={reduceMotion ? undefined : { opacity: 0, filter: 'blur(6px)', y: 6 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, filter: 'blur(0px)', y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: delay + i * 0.045, ease: 'easeOut' }}
          className={cn('inline-block', wordClassName)}
        >
          {word}
          {i < items.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </p>
  )
}
