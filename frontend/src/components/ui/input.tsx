'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.ComponentPropsWithoutRef<'input'> {
  invalid?: boolean
  /** Rendered inside the field, before the text. Decorative — keep it an icon. */
  startAdornment?: React.ReactNode
  endAdornment?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, startAdornment, endAdornment, type = 'text', ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full rounded-xl bg-canvas-raise px-4 text-sm text-ink',
          'border transition-[border-color,box-shadow] duration-200 ease-[var(--ease-enter)]',
          'placeholder:text-ink-faint',
          'outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-tint)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink',
          invalid ? 'border-danger focus-visible:border-danger' : 'border-line-strong',
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
