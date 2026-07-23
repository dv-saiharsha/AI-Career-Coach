'use client'

import { useRef } from 'react'
import { motion, useScroll, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

/** A vertical beam alongside a step list that fills with the brand gradient as it scrolls into view. */
export function TracingBeam({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.4'],
  })
  const pathLength = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 })
  const height = useTransform(pathLength, [0, 1], ['0%', '100%'])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border sm:left-[19px]">
        <motion.div
          className="absolute left-0 top-0 w-px"
          style={{ height, background: 'var(--gradient-signature)', boxShadow: '0 0 12px color-mix(in srgb, var(--primary) 60%, transparent)' }}
        />
      </div>
      {children}
    </div>
  )
}
