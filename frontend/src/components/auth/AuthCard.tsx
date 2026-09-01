import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { ApplyCenterMark } from '@/components/ApplyCenterMark'
import { cn } from '@/lib/utils'

/**
 * The shell every auth screen sits in: one centred card in the largest
 * raised treatment, floating over the ambient wash.
 *
 * This replaces a split-screen showcase panel whose right half rotated
 * through four marketing lines with a scramble-text effect and claimed "real
 * ATS scoring across 200+ systems". Nobody counted those systems. On a page
 * where someone is deciding whether to hand over their CV, an unverifiable
 * number is worse than no number, and a headline that reshuffles itself
 * every 3.4 seconds is worse than one that holds still.
 *
 * A server component. The old version was a client boundary for the sake of
 * an interval timer and three entrance animations.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-4 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] ambient-wash"
      />

      <Link
        href="/"
        className="mb-9 inline-flex items-center gap-2.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-3"
      >
        <ApplyCenterMark className="size-8" />
        <span className="wordmark text-lg text-ink">ApplyCenter</span>
      </Link>

      <div
        className={cn(
          'w-full max-w-md rounded-3xl bg-canvas-raise p-7 neu-raised-lg sm:p-9',
          className
        )}
      >
        <div className="mb-7">
          <h1 className="text-section text-ink" style={{ fontSize: '1.75rem' }}>
            {title}
          </h1>
          {subtitle && <p className="mt-2.5 text-[14.5px] font-light text-ink-dim">{subtitle}</p>}
        </div>
        {children}
      </div>

      {footer && <div className="mt-7 text-center text-[14px] text-ink-dim">{footer}</div>}
    </div>
  )
}

/**
 * Form-level failure: the whole submission went wrong, rather than one field
 * being invalid. Field problems belong under their own field, inside
 * <Field>, so the fix is always next to the problem.
 *
 * Rendered unconditionally when there is a message, with no enter animation.
 * This used to be an AnimatePresence height tween; an error that takes 240ms
 * to arrive is an error the user has already started retyping past.
 */
export function AuthAlert({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-md bg-danger-bg p-3.5 text-[13.5px] leading-relaxed text-danger neu-inset-sm"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}
