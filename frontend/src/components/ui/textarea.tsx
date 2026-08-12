'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  invalid?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-28 w-full resize-y rounded-xl bg-canvas-raise px-4 py-3 text-sm leading-relaxed text-ink',
        'border transition-[border-color,box-shadow] duration-200 ease-[var(--ease-enter)]',
        'placeholder:text-ink-faint',
        'outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-tint)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-danger focus-visible:border-danger' : 'border-line-strong',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
