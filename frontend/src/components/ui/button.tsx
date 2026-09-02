'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

/* ────────────────────────────────────────────────────────────────────────
   The interaction language in one component: raised at rest, a pixel higher
   on hover, flush with a ring on press. Hover deepens the shadow and sharpens
   the border rather than recolouring the surface — recolouring reads as a
   state change, and this system spends colour on state elsewhere.

   Press feedback is a compositor-only CSS transform with no transition, so
   depression is instant. It used to be a Framer whileTap, which built a
   VisualElement per button and drove every press through JS animation
   frames; that was the single worst INP contributor in the app.
   ──────────────────────────────────────────────────────────────────────── */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg',
    'text-sm font-medium tracking-[-0.005em] cursor-pointer select-none',
    'outline-none',
    'disabled:pointer-events-none',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
  ],
  {
    variants: {
      variant: {
        /* The one accent surface on the page: 145deg gradient, white label,
           accent glow. White clears 4.74:1 at the lightest gradient stop —
           see scripts/check-contrast.mjs. */
        default: 'elev-accent',
        /* Raised neutral surface. The default for everything that is not the
           single primary action in view. */
        secondary: 'elev-interactive bg-canvas-raise text-ink',
        outline: 'elev-interactive-sm bg-canvas-raise text-ink',
        /* Flush at rest — no shadow to lift from, so it insets on press and
           brightens its label on hover. */
        ghost: [
          'bg-transparent text-ink-dim',
          'transition-colors duration-200 ease-(--ease-enter) hover:text-ink',
          'active:shadow-(--ring-field-soft) active:transition-none',
          'disabled:text-ink-faint',
        ],
        /* State is carried by the label colour and the tint, never by the
           shadow alone — shadow cannot be read by anyone relying on
           contrast rather than depth. */
        destructive: 'elev-interactive bg-danger-bg text-danger',
        link: 'text-accent-text underline-offset-4 hover:underline p-0 h-auto rounded-none min-h-0',
      },
      size: {
        /* 44px floor on every interactive size — touch target minimum. */
        default: 'h-11 px-6',
        sm: 'h-11 px-4 text-[13px]',
        lg: 'h-12 px-8 text-[15px]',
        icon: 'size-11 rounded-lg',
        'icon-sm': 'size-11 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Swaps the leading content for a spinner and blocks interaction, without
   * changing the button's box — a button that resizes as it loads moves
   * whatever sits beside it.
   */
  loading?: boolean
  /** Announced while `loading`. Defaults to the button's own label. */
  loadingLabel?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingLabel,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'

    /* asChild renders someone else's element, which may not accept the extra
       spinner child — Slot requires exactly one. Loading is ignored there by
       design rather than crashing at runtime. */
    if (asChild) {
      return (
        <Comp
          ref={ref}
          className={cn(buttonVariants({ variant, size, className }))}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Spinner className="size-4" label={loadingLabel ?? 'Working'} />}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
