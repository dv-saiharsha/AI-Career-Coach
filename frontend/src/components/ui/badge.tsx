import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive/15 text-destructive border-destructive/20',
        outline: 'text-foreground',
        success: 'border-transparent bg-success-tint text-success',
        warning: 'border-transparent bg-warning-tint text-warning',
        info: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
        high: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium',
        medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium',
        low: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400 font-medium',
        subtle: 'border-primary/20 bg-primary/10 text-primary font-medium',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
