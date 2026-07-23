'use client'

import { cn } from '@/lib/utils'

/** A card/panel with a static hairline border that resolves into the brand gradient on hover. */
export function HoverBorderGradient({
  as: Comp = 'div',
  containerClassName,
  className,
  children,
  ...props
}: {
  as?: React.ElementType
  containerClassName?: string
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Comp
      className={cn(
        'group/hbg relative rounded-2xl bg-border p-px transition-colors duration-500',
        containerClassName
      )}
      {...props}
    >
      <div
        className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover/hbg:opacity-100"
        style={{ background: 'var(--gradient-signature)' }}
        aria-hidden
      />
      <div className={cn('relative rounded-2xl bg-surface', className)}>{children}</div>
    </Comp>
  )
}
