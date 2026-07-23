'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/** A barely-there wash of the brand gradient (blue → violet → cyan) behind
 * hero-weight sections — a hint of color on white, not a moody glow. */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      <motion.div
        className="absolute -top-[30%] left-1/2 h-[60vh] w-[120vw] -translate-x-1/2 rounded-full opacity-[0.06] blur-[140px] dark:opacity-[0.16]"
        style={{
          background:
            'conic-gradient(from 180deg at 50% 50%, var(--primary) 0deg, var(--secondary) 120deg, var(--accent) 240deg, var(--primary) 360deg)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, transparent 0%, var(--background) 70%)',
        }}
      />
    </div>
  )
}
