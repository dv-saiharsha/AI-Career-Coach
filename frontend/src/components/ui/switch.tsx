'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

/* Track is an inset groove; the thumb is extruded and rides in it. Checked
   fills the groove with the accent gradient, so the state is legible as
   colour as well as position. */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full px-0.5',
      'bg-canvas neu-inset-sm transition-[background-image] duration-200 ease-(--ease-enter)',
      'outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-3',
      'disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50',
      'data-[state=checked]:bg-[image:var(--gradient-accent)]',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-6 rounded-full bg-canvas-raise shadow-(--neu-raised-sm)',
        'transition-transform duration-200 ease-(--ease-spring)',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
