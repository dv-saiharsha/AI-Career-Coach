'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
  /** The exact text placed on the clipboard. */
  value: string
  /** Names what is being copied, for screen readers and the tooltip. */
  label?: string
  className?: string
}

/**
 * Copy-to-clipboard with a confirmed state.
 *
 * `navigator.clipboard` is unavailable on insecure origins and in some
 * embedded webviews, so the write is guarded and failure is reported rather
 * than swallowed — a button that silently does nothing is worse than one that
 * says it couldn't.
 */
export function CopyButton({ value, label = 'text', className = '' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // Held so an unmount mid-timeout can't setState on a dead component, and so
  // rapid clicks reset the window rather than stacking timers.
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  const text = state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy'

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === 'copied' ? `${label} copied` : `Copy ${label}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors ${className}`}
      style={{
        color:
          state === 'copied'
            ? 'var(--color-signal-high)'
            : state === 'failed'
              ? 'var(--color-signal-low)'
              : 'var(--color-ink-faint)',
      }}
    >
      {state === 'copied' ? (
        <Check strokeWidth={2} className="h-3 w-3" />
      ) : (
        <Copy strokeWidth={1.5} className="h-3 w-3" />
      )}
      {text}
    </button>
  )
}
