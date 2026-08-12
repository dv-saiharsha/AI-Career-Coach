'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Slow drifting warm light behind hero content.
 *
 * Purely decorative, so it is aria-hidden and sits behind a `grain` layer.
 * Only transform/opacity are animated, and blur is baked into a static
 * filter so the compositor never re-rasterises mid-animation.
 *
 * Reduced motion is handled by the root <MotionConfig reducedMotion="user">
 * rather than a hook here: the hook resolves false on the server and true on
 * the client, which makes SSR and hydration emit different inline styles.
 */
export function AmbientGlow({ className }: { className?: string }) {
  const orbs = [
    { color: 'var(--data-3)', size: 460, x: '8%', y: '4%', delay: 0, dx: 26, dy: -18 },
    { color: 'var(--data-5)', size: 380, x: '68%', y: '12%', delay: 1.4, dx: -22, dy: 20 },
    { color: 'var(--data-6)', size: 300, x: '38%', y: '46%', delay: 2.6, dx: 16, dy: 14 },
  ]

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}
    >
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          /* Dark gets roughly a third of the light opacity — the obsidian
             canvas has far less headroom before a glow reads as a flare. */
          className="absolute rounded-full opacity-[0.16] blur-[100px] dark:opacity-[0.06]"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: orb.color,
            willChange: 'transform',
          }}
          animate={{ x: [0, orb.dx, 0], y: [0, orb.dy, 0], scale: [1, 1.06, 1] }}
          transition={{
            duration: 16 + i * 4,
            delay: orb.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}
