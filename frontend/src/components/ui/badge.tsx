import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* Badges are not interactive, so they carry the small shadow and never
   move. State badges pair a tinted ground with the AA-checked text
   token — the label always says what the state is, so nothing depends on
   colour or depth alone. */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'elev-accent',
        outline: 'elev-sm bg-canvas-raise text-ink-dim',
        muted: 'field-ring-soft bg-canvas text-ink-subtle',
        accent: 'field-ring-soft bg-canvas text-accent-text',
        success: 'elev-sm bg-success-bg text-success',
        warning: 'elev-sm bg-warning-bg text-warning',
        danger: 'elev-sm bg-danger-bg text-danger',
      },
      size: {
        default: 'px-3 py-1 text-xs',
        sm: 'px-2.5 py-0.5 text-[12px]',
        lg: 'px-3.5 py-1.5 text-[13px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<'span'>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
