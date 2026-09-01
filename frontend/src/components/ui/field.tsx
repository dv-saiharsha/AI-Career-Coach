'use client'

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

export interface FieldProps {
  label: string
  htmlFor: string
  /** Persistent guidance. Stays visible; it is not a substitute for the label. */
  hint?: string
  /** When set the field reads as invalid and the message replaces the hint. */
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Label + control + message, wired for accessibility.
 *
 * The label is always visible (a placeholder is not a label), and the error
 * appears directly beneath its own field rather than in a summary at the top
 * of the form, so the fix is always next to the problem.
 */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const messageId = `${htmlFor}-message`
  const hasMessage = Boolean(error || hint)

  /* The message <p> below carries messageId, but nothing associates it with
     the input itself unless we do it here — a screen reader would announce
     the label and nothing else, silently dropping both the persistent hint
     and any validation error. children is typed as ReactNode for
     flexibility, but every real caller passes exactly one Input or Textarea,
     so cloning is safe; an unexpected shape just skips the wiring rather
     than throwing. */
  const describedField =
    hasMessage && React.isValidElement(children)
      ? React.cloneElement(
          children as React.ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>,
          {
            'aria-describedby': messageId,
            ...(error ? { 'aria-invalid': true } : {}),
          }
        )
      : children

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </Label>

      {describedField}

      {/* This was an AnimatePresence pair, which made every form in the app a
          Framer client boundary in order to cross-fade one line of text. The
          swap is instant now, which is also the honest behaviour: a
          validation error should not take 240ms to appear. */}
      {error ? (
        <p
          id={messageId}
          role="alert"
          className="flex items-start gap-1.5 text-[13px] leading-relaxed text-danger"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-[13px] leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
