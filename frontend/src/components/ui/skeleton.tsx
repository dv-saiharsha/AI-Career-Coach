import { cn } from '@/lib/utils'

/**
 * Content-shaped loading. A slow shimmer over an inset well, never a spinner
 * — a spinner says "something is happening", a skeleton says "this is what
 * is arriving and this is where it will sit".
 *
 * Give it the same box as the content it stands in for. A skeleton that
 * changes size on load causes the layout shift it exists to prevent.
 */
function Skeleton({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-md bg-canvas neu-inset-sm',
        'after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--ink)_8%,transparent),transparent)] after:bg-[length:200%_100%]',
        'motion-reduce:after:animate-none',
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
