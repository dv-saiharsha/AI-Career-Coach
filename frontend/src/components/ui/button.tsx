'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* Ink is the accent, so `default` is a solid ink pill in light and a solid
   cream pill in dark — the inversion is what carries the brand, not a hue. */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full',
    'text-sm font-medium tracking-[-0.005em] cursor-pointer select-none',
    'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
    /* Press feedback is a compositor-only CSS transform on an overshoot
       curve. This used to be a Framer whileHover/whileTap, which built a
       VisualElement per button and drove every press through JS animation
       frames — it was the single worst INP contributor in the app. */
    'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-enter)]',
    'motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.97] motion-safe:active:duration-75',
    'motion-safe:hover:ease-[var(--ease-spring)]',
  ],
  {
    variants: {
      variant: {
        default: 'bg-accent text-on-accent shadow-[var(--glow-signal)] hover:bg-accent-dim',
        secondary:
          'bg-canvas-elevated text-ink border border-canvas-line hover:border-line-strong',
        outline:
          'border border-line-strong bg-transparent text-ink hover:bg-canvas-elevated',
        ghost: 'text-ink-dim hover:text-ink hover:bg-canvas-elevated',
        destructive: 'bg-danger text-on-accent hover:opacity-90',
        link: 'text-ink underline-offset-4 hover:underline p-0 h-auto rounded-none',
      },
      size: {
        /* 44px floor on the interactive sizes — touch target minimum. */
        default: 'h-11 px-6',
        sm: 'h-9 px-4 text-[13px]',
        lg: 'h-12 px-8 text-[15px]',
        icon: 'size-11 rounded-full',
        'icon-sm': 'size-9 rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
