'use client'

import * as React from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Transient confirmation for actions whose result isn't otherwise visible.
 *
 * Built here rather than pulled in as a dependency: the whole surface is one
 * context, one list and one animated element, and the design system already
 * supplies every token it needs. A library would be more code to configure
 * than to write.
 *
 * Not a replacement for inline errors. A toast is the right home for "that
 * worked" — a form validation failure belongs next to the field it concerns,
 * where InlineError already puts it.
 */
export type ToastVariant = 'success' | 'error'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Milliseconds on screen. Errors default to longer than successes. */
  duration?: number
}

interface ToastRecord extends Required<Omit<ToastOptions, 'description'>> {
  /** Set while the exit transition runs, before the row leaves state. */
  leaving?: boolean
  id: number
  description?: string
}

const ToastContext = React.createContext<((options: ToastOptions) => void) | null>(null)

export function useToast() {
  const toast = React.useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used inside <ToastProvider>')
  return toast
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3200,
  // Longer: a failure usually carries something the user has to read.
  error: 5200,
}

// Bounded so a loop that fires repeatedly can't paper over the whole screen.
/** Must match .presence-panel's transition in globals.css. */
const TOAST_EXIT_MS = 180

const MAX_VISIBLE = 3

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())

  /* Two-step removal: the toast is marked leaving, its CSS exit runs, and
     the row is dropped from state once the transition has had time to
     finish. AnimatePresence used to hold the element in the tree for this;
     a flag and a timeout do the same job without the library. */
  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, TOAST_EXIT_MS)
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = React.useCallback(
    ({ title, description, variant = 'success', duration }: ToastOptions) => {
      const id = nextId++
      const record: ToastRecord = {
        id,
        title,
        description,
        variant,
        duration: duration ?? DEFAULT_DURATION[variant],
      }
      setToasts((current) => [...current, record].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), record.duration)
      )
    },
    [dismiss]
  )

  // Every pending timer is cleared on unmount — otherwise a dismissal fires
  // into an unmounted tree after navigation.
  React.useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[]
  onDismiss: (id: number) => void
}) {

  return (
    /* polite, not assertive: a confirmation should wait for a natural pause
       rather than interrupt whatever the screen reader is currently saying.
       The region stays mounted so announcements are picked up reliably. */
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-state={t.leaving ? 'closed' : 'open'}
            className={cn(
              'presence-panel pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border p-3.5',
              'border-canvas-line bg-canvas-raise shadow-(--shadow-pop)'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                t.variant === 'success' ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'
              )}
            >
              {t.variant === 'success' ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : (
                <TriangleAlert className="size-3" strokeWidth={2.5} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{t.description}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 shrink-0 rounded-full p-1 text-ink-faint outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
    </div>
  )
}
