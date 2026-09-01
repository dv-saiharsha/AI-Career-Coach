'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

export interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'value'> {
  value?: number
  /** Fill. Defaults to the accent gradient; pass a token class for state meters. */
  indicatorClassName?: string
  /**
   * Animates the fill up from zero on first paint, over 900ms, then holds.
   * Pair with a scroll reveal so the bar fills as its card arrives.
   */
  animateOnMount?: boolean
}

/* Track is inset — a groove cut into the surface. Fill is the accent
   gradient sitting in it. The width transition is a plain CSS transition
   rather than a Framer spring: one animated property, no interruption
   semantics worth a physics engine, and no VisualElement per meter on a
   route that may render fifty of them. */
const Progress = React.forwardRef<React.ComponentRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value = 0, indicatorClassName, animateOnMount = false, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, value))
    const [width, setWidth] = React.useState(animateOnMount ? 0 : pct)

    React.useEffect(() => {
      if (!animateOnMount) {
        setWidth(pct)
        return
      }
      /* Two frames: one for the zero-width paint to land, one to start the
         transition. A single rAF sometimes coalesces with the initial paint
         and the bar appears already full. */
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setWidth(pct))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }, [pct, animateOnMount])

    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={pct}
        className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-canvas neu-inset-sm', className)}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full rounded-full bg-[image:var(--gradient-accent)]',
            'transition-[width] duration-[900ms] ease-(--ease-enter) motion-reduce:transition-none',
            indicatorClassName
          )}
          style={{ width: `${width}%` }}
        />
      </ProgressPrimitive.Root>
    )
  }
)
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
