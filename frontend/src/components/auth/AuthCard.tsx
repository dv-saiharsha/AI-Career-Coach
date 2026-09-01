import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { ApplyCenterMark } from '@/components/ApplyCenterMark'
import { cn } from '@/lib/utils'

/**
 * The shell every auth screen sits in: a brand panel on the left, the form
 * on the right, and on anything narrower than `lg` the brand panel is not
 * rendered at all.
 *
 * That last part is the whole point of the breakpoint choice. Stacking a
 * marketing panel above a sign-in form does not make it responsive, it makes
 * someone scroll past an advertisement to reach the thing they came for. On
 * a phone this is the form, full width, under a wordmark.
 *
 * A split lived here once before and was removed, for reasons worth keeping:
 * its panel rotated four headlines through a scramble effect every 3.4
 * seconds and claimed "real ATS scoring across 200+ systems", which nobody
 * had counted. The layout was never the problem. What goes in it is — so
 * this panel says only things that are true and holds still while it says
 * them.
 *
 * Still a server component. Nothing here needs the client, and auth routes
 * have 10KB of headroom against their budget.
 */

export interface AuthAsidePoint {
  title: string
  body: string
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  className,
  asideHeading,
  asidePoints,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  /** Left-panel headline. Omitted on interstitials like "check your email". */
  asideHeading?: string
  asidePoints?: AuthAsidePoint[]
}) {
  const hasAside = Boolean(asideHeading && asidePoints?.length)

  return (
    <div className={cn('min-h-[100dvh]', hasAside && 'lg:grid lg:grid-cols-[44%_1fr]')}>
      {hasAside && (
        <aside className="relative hidden overflow-hidden bg-canvas-deep px-12 py-14 lg:flex lg:flex-col lg:justify-between">
          {/* Two static blurred fields. Static deliberately: a slow looping
              glow is the exact kind of ambient movement that reads as
              restless in peripheral vision, and it would run for as long as
              someone sits on this page. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-32 -top-40 size-[30rem] rounded-full bg-accent/12 blur-[110px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-40 -right-28 size-[26rem] rounded-full bg-accent-light/10 blur-[110px]"
          />

          <Link
            href="/"
            className="relative inline-flex w-fit items-center gap-2.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-3"
          >
            <ApplyCenterMark className="size-8" />
            <span className="wordmark text-lg text-ink">ApplyCenter</span>
          </Link>

          <div className="relative max-w-[24rem]">
            <h2 className="text-balance text-[2.1rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink">
              {asideHeading}
            </h2>

            <ul className="mt-9 flex flex-col gap-5">
              {asidePoints?.map((point) => (
                <li key={point.title} className="flex gap-3.5">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <div>
                    <p className="text-[14.5px] font-medium text-ink">{point.title}</p>
                    <p className="mt-1 text-[13.5px] font-light leading-relaxed text-ink-dim">
                      {point.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-[13px] font-light text-ink-faint">
            Free for every jobseeker we serve. No card, ever.
          </p>
        </aside>
      )}

      <div className="relative flex flex-col items-center justify-center px-4 py-14 sm:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] ambient-wash"
        />

        {/* Below lg the brand is a header, not a panel. Above it the aside
            already carries the wordmark, so repeating it would be noise. */}
        <Link
          href="/"
          className={cn(
            'mb-9 inline-flex items-center gap-2.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-3',
            hasAside && 'lg:hidden'
          )}
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
