import * as React from 'react'
import { cn } from '@/lib/utils'

/* ────────────────────────────────────────────────────────────────────────
   A card is a surface extruded from the canvas it sits on. Same hue, no
   border, no hard cast — only the two-part shadow separates it.

   This is no longer a client component. Hover was a Framer whileHover, which
   made every card on a route a client boundary carrying a VisualElement, to
   express a one-pixel lift that CSS does for free.
   ──────────────────────────────────────────────────────────────────────── */

export interface CardProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Lifts on hover, insets on press. Use for cards that navigate. */
  interactive?: boolean
  /** Recessed rather than extruded — chart wells, metric bands, dropzones. */
  inset?: boolean
  /** 22px stat-tile radius instead of the 28px content-card radius. */
  tile?: boolean
  /** The one accent surface. Reserve it for a single card per view. */
  accent?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, inset = false, tile = false, accent = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        tile ? 'rounded-xl' : 'rounded-2xl',
        accent
          ? 'neu-accent'
          : inset
            ? 'neu-inset bg-canvas'
            : interactive
              ? 'neu-interactive bg-canvas-raise text-ink cursor-pointer'
              : 'neu-raised bg-canvas-raise text-ink',
        className
      )}
      {...props}
    />
  )
)
Card.displayName = 'Card'

/* 30px desktop / 22px mobile padding, per the spacing rhythm. */
const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-[22px] lg:p-[30px]', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<'h3'>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-card-title text-ink', className)} {...props} />
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
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-[22px] pt-0 lg:p-[30px] lg:pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-3 p-[22px] pt-0 lg:p-[30px] lg:pt-0', className)}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
