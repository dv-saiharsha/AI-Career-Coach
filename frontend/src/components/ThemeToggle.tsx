'use client'

import { motion } from 'framer-motion'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard next-themes hydration guard
    setMounted(true)
  }, [])

  const isDark = !mounted || resolvedTheme !== 'light'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative w-[52px] h-[28px] rounded-full shrink-0 border transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-canvas)] ${className}`}
      style={{
        background: isDark ? 'var(--color-canvas-raise)' : 'color-mix(in srgb, var(--color-accent) 20%, var(--color-canvas-raise))',
        borderColor: 'var(--color-canvas-line)',
      }}
    >
      {/* Track icons */}
      <Moon className="absolute left-[6px] top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-ink-faint)]" />
      <Sun className="absolute right-[6px] top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-accent)]" />

      {/* Sliding thumb */}
      <motion.span
        className="absolute top-[3px] left-[3px] w-[22px] h-[22px] rounded-full flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        style={{ background: isDark ? 'var(--color-canvas-elevated)' : 'var(--color-accent)' }}
        animate={{ x: isDark ? 0 : 24 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      >
        {isDark ? (
          <Moon className="w-3 h-3 text-[var(--color-ink-dim)]" />
        ) : (
          <Sun className="w-3 h-3 text-white" />
        )}
      </motion.span>
    </button>
  )
}
