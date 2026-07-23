'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/** A soft directional light beam that fades in on mount — Aceternity's signature hero treatment. */
export function Spotlight({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4, ease: 'easeOut' }}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      <div
        className="absolute left-1/2 top-0 h-[70vh] w-[55vw] -translate-x-1/2 opacity-[0.12] dark:opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 50% 50% at 50% 0%, color-mix(in srgb, var(--primary) 35%, transparent) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        className="absolute left-[20%] top-0 h-[55vh] w-[30vw] -rotate-[25deg] opacity-[0.08] dark:opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 50% 50% at 50% 0%, color-mix(in srgb, var(--accent) 30%, transparent) 0%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />
      <div
        className="absolute right-[15%] top-0 h-[55vh] w-[30vw] rotate-[25deg] opacity-[0.08] dark:opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 50% 50% at 50% 0%, color-mix(in srgb, var(--secondary) 30%, transparent) 0%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />
    </motion.div>
  )
}
