import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SubmitButtonProps extends Omit<ButtonProps, 'children' | 'asChild'> {
  loading?: boolean
  loadingLabel: string
  children: React.ReactNode
}

/**
 * Submit control.
 *
 * This used to cross-fade its own label through AnimatePresence, which
 * predated the Button primitive growing a `loading` prop that does the same
 * job — spinner, disabled, aria-busy — without a second implementation. It
 * now delegates, so there is one loading treatment in the product rather
 * than two that drift apart.
 *
 * No longer a client component either: it holds no state and runs no effect,
 * so it renders on the server like the rest of the form.
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
      loading={loading}
      loadingLabel={loadingLabel}
      disabled={disabled}
      className={cn('w-full', className)}
      {...props}
    >
      {loading ? loadingLabel : children}
    </Button>
  )
}

/**
 * Form-level failure banner. Use for errors that belong to the submission as
 * a whole; anything attributable to one input belongs in that field's `error`.
 *
 * It appears at once. This was a height tween, and the auth rebuild had
 * already made the same call for the same reason: an error that takes 240ms
 * to open is one the user has started retyping past before they can read it.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}
