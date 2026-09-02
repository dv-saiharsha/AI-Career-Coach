'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/* The selected tab is INSET with accent text — the same opposition as a
   pressed button and a selected chip.

   The sliding accent pill this used to render is gone. It needed a mirrored
   value context, an auto-incrementing layoutId, and a Framer layout
   animation per tab set, all to express a state the inset shadow states more
   plainly. Selection is now carried by shadow, colour and aria-selected
   together, so it survives both a screen reader and a contrast-only read. */

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full bg-canvas p-1.5 field-ring-soft',
      'max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5',
      'text-[13px] font-medium whitespace-nowrap',
      'transition-[box-shadow,color,transform] duration-200 ease-(--ease-enter)',
      'outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
      'disabled:pointer-events-none disabled:text-ink-faint',
      '[&_svg]:size-4 [&_svg]:shrink-0',
      'text-ink-dim hover:text-ink',
      'data-[state=active]:bg-canvas-raise data-[state=active]:text-accent-text data-[state=active]:shadow-(--shadow-sm)',
      'active:shadow-(--ring-field-soft) active:transition-none',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-6 outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
