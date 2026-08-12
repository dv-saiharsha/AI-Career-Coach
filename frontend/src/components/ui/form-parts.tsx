'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { ease, spring } from '@/lib/motion'

export interface SubmitButtonProps extends Omit<ButtonProps, 'children' | 'asChild'> {
  loading?: boolean
  loadingLabel: string
  children: React.ReactNode
}

/**
 * Submit control with a spring cross-fade between resting and pending states.
 *
 * The button keeps its own width while the label swaps, so the control never
 * resizes under the pointer mid-submit, and it stays disabled for the whole
 * pending window to make double submission impossible.
 */
export function SubmitButton({
  loading = false,
  loadingLabel,
  children,
  className,
  disabled,
  size = 'lg',
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('w-full', className)}
      {...props}
    >
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="inline-flex items-center gap-2"
          >
            <Spinner className="text-on-accent" label={loadingLabel} />
            {loadingLabel}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="inline-flex items-center gap-2"
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  )
}

/**
 * Form-level failure banner. Use for errors that belong to the submission as
 * a whole; anything attributable to one input belongs in that field's `error`.
 */
export function FormError({ message }: { message?: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0, y: -6 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -6 }}
          transition={ease}
          className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}
