'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'

type NativeDivProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
>

export interface CardProps extends NativeDivProps {
  /** Lifts and deepens its shadow on hover. Use for cards that navigate. */
  interactive?: boolean
  /** Frosted panel instead of solid. Reserve for genuinely floating surfaces. */
  glass?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, glass = false, ...props }, ref) => {
    const reduce = useReducedMotion()

    const base = cn(
      'rounded-2xl text-ink',
      glass
        ? 'glass shadow-[var(--shadow-raised)]'
        : 'border border-canvas-line bg-canvas-raise shadow-[var(--shadow-card)]',
      interactive && 'cursor-pointer',
      className
    )

    if (!interactive) {
      return <div ref={ref} className={base} {...(props as React.ComponentPropsWithoutRef<'div'>)} />
    }

    return (
      <motion.div
        ref={ref}
        className={base}
        whileHover={reduce ? undefined : { y: -3, boxShadow: 'var(--shadow-raised)' }}
        transition={spring}
        {...props}
      />
    )
  }
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<'h3'>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-display text-xl leading-tight tracking-[-0.02em] text-ink', className)}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<'p'>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm leading-relaxed text-ink-dim', className)} {...props} />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
