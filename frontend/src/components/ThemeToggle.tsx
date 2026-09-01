'use client'

import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard next-themes hydration guard
    setMounted(true)
  }, [])

  const isDark = !mounted || resolvedTheme !== 'light'

  return (
    <Button
      variant="ghost"
      role="switch"
      aria-checked={!isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'relative h-7 w-[52px] shrink-0 rounded-full border border-canvas-line p-0',
        isDark ? 'bg-canvas-raise' : 'bg-accent-tint',
        'hover:bg-canvas-elevated',
        className
      )}
    >
      {/* Track markers — decorative; the accessible name carries the state. */}
      <Moon
        className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
      <Sun
        className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-dim"
        aria-hidden="true"
      />

      {/* A 24px slide, in CSS. This was a Framer spring, and it was the only
          reason framer-motion was in the landing page's graph at all — 43KB
          gzipped for one transform. The easing overshoots slightly at the end
          via the system's own ease-spring token; motion-safe: means it snaps for
          anyone who has asked for less movement. */}
      <span
        className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-spring absolute left-0.75 top-0.75 flex size-5.5 items-center justify-center rounded-full shadow-(--shadow-card)"
        style={{
          background: isDark ? 'var(--canvas-elevated)' : 'var(--accent)',
          transform: isDark ? 'translateX(0)' : 'translateX(24px)',
        }}
      >
        {isDark ? (
          <Moon className="size-3 text-ink-dim" aria-hidden="true" />
        ) : (
          <Sun className="size-3 text-on-accent" aria-hidden="true" />
        )}
      </span>
    </Button>
  )
}
