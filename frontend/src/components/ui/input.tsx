'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  invalid?: boolean
  /** Rendered inside the field, before the text. Decorative — keep it an icon. */
  startAdornment?: React.ReactNode
  endAdornment?: React.ReactNode
}

/* A field receives input, so it is inset: recessed into the canvas rather
   than sitting on it. That is the same rule as a pressed button, which is
   why the system only has to be learned once.

   Error state is carried by the label colour and the message below, never by
   the shadow — depth is not a signal anyone can read from contrast alone. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, startAdornment, endAdornment, type = 'text', ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full rounded-md bg-canvas px-4 text-sm text-ink',
          'field-ring',
          'placeholder:text-ink-faint',
          'outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
          'disabled:cursor-not-allowed disabled:text-ink-faint disabled:shadow-none',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink',
          invalid && 'text-danger placeholder:text-danger/60',
          startAdornment && 'pl-10',
          endAdornment && 'pr-10',
          className
        )}
        {...props}
      />
    )

    if (!startAdornment && !endAdornment) return field

    return (
      <div className="relative w-full">
        {startAdornment && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint [&_svg]:size-4">
            {startAdornment}
          </span>
        )}
        {field}
        {endAdornment && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-faint [&_svg]:size-4">
            {endAdornment}
          </span>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
