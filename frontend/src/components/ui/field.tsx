'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { ease } from '@/lib/motion'

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
 * The label is always visible (placeholders are not labels), and the error
 * appears directly beneath its own field rather than in a summary at the top
 * of the form, so the fix is always next to the problem.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const messageId = `${htmlFor}-message`

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

      {children}

      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={messageId}
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={ease}
            className="flex items-center gap-1.5 text-[13px] text-danger"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={messageId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={ease}
            className="text-[13px] leading-relaxed text-ink-faint"
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
