'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Reveal } from '@/lib/reveal'

/**
 * The one page header for every workspace route.
 *
 * Before this, twelve pages carried three different `<h1>` treatments
 * (`font-medium italic` vs `font-semibold`, breaking at `sm:` vs `md:` vs not
 * at all), two eyebrow classes that resolved to identical CSS, and entrance
 * animations that some pages had and others didn't. None of that was a
 * decision — it was drift across ten milestones.
 *
 * The italic display face is the house style: it is what the most recent
 * pages (Applications, Offers, Cover Letter) and the Resume scan screen
 * already use, and it is what distinguishes a page title from the
 * `font-semibold` used for section headings inside a page.
 */
export interface PageHeaderProps {
  /** Small mono label above the title. Omit for utility pages. */
  eyebrow?: string
  /** Optional icon inside the eyebrow; a dot is used when absent. */
  eyebrowIcon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** Right-aligned slot — a primary action, usually one Button. */
  action?: ReactNode
  /** Extra nodes under the description (badges, timestamps, filters). */
  children?: ReactNode
  className?: string
}

export function PageHeader({
  eyebrow,
  eyebrowIcon: Icon,
  title,
  description,
  action,
  children,
  className,
}: PageHeaderProps) {
  return (
    <Reveal
      className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}
    >
      <div className="min-w-0">
        {eyebrow && (
          <span className="eyebrow inline-flex">
            {Icon ? (
              <Icon className="size-3" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-(--color-accent)" />
            )}
            {eyebrow}
          </span>
        )}
        <h1
          className={cn(
            'font-display text-2xl font-medium italic text-(--color-ink) md:text-3xl',
            eyebrow && 'mt-2'
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-(--color-ink-dim)">
            {description}
          </p>
        )}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </Reveal>
  )
}
