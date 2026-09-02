'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ChipProps extends React.ComponentPropsWithoutRef<'button'> {
  /** Raised when false, flush with a ring when true. */
  selected?: boolean
  /**
   * Renders a static span rather than a button. Use for chips that label
   * something (a matched keyword) rather than filter it.
   */
  readOnly?: boolean
  /**
   * Outlined and dimmed rather than filled — the "missing keyword"
   * treatment. A missing thing should read as an empty slot, not an item.
   */
  missing?: boolean
}

/* The stage filters, keyword chips and source pills are all this component.
   Selection is carried by three things at once — the inset shadow, the accent
   label colour, and aria-pressed — because shadow alone is unreadable to
   anyone navigating by contrast or by screen reader. */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected = false, readOnly = false, missing = false, children, ...props }, ref) => {
    const shape =
      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[12px] tracking-[0.02em]'

    if (readOnly) {
      return (
        <span
          className={cn(
            shape,
            missing
              ? 'field-ring-soft bg-canvas text-ink-faint'
              : 'elev-sm bg-canvas-raise text-ink-dim',
            className
          )}
        >
          {children}
        </span>
      )
    }

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected}
        className={cn(
          shape,
          /* 44px touch floor without inflating the chip visually: the label
             box stays small, the hit area does not. */
          'relative min-h-11 cursor-pointer select-none outline-none',
          'transition-[box-shadow,transform,color] duration-200 ease-(--ease-enter)',
          selected
            ? 'shadow-(--ring-field-soft) bg-canvas text-accent-text'
            : 'shadow-(--shadow-sm) bg-canvas-raise text-ink-dim hover:-translate-y-px hover:shadow-(--shadow-md) hover:text-ink',
          'active:translate-y-0 active:shadow-(--ring-field-soft) active:transition-none',
          'disabled:cursor-not-allowed disabled:text-ink-faint disabled:shadow-none disabled:translate-y-0',
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Chip.displayName = 'Chip'

export { Chip }
