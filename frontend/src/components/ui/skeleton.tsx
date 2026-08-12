import { cn } from '@/lib/utils'

/**
 * Placeholder block. Give it the same box as the content it stands in for —
 * a skeleton that changes size on load causes the layout shift it exists to
 * prevent.
 */
function Skeleton({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-lg bg-canvas-elevated',
        'after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--ink)_7%,transparent),transparent)] after:bg-[length:200%_100%]',
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
