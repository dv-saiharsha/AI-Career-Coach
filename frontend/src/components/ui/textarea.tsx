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
        'min-h-28 w-full resize-y rounded-md bg-canvas px-4 py-3 text-sm leading-relaxed text-ink',
        'field-ring',
        'placeholder:text-ink-faint',
        'outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:text-ink-faint disabled:shadow-none',
        invalid && 'text-danger placeholder:text-danger/60',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
