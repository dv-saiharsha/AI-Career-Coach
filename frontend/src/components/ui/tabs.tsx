'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'

/* Radix exposes the active tab only as a data attribute, which React cannot
   read during render. We mirror the value into context so the trigger knows
   whether to host the shared layout pill. */
type TabsCtx = { value: string | undefined; layoutId: string }
const TabsContext = React.createContext<TabsCtx>({ value: undefined, layoutId: 'tab-pill' })

let tabsAutoId = 0

export interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {}

const Tabs = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ value, defaultValue, onValueChange, children, ...props }, ref) => {
    const [internal, setInternal] = React.useState(defaultValue)
    const current = value ?? internal

    /* Each Tabs instance needs its own layoutId, or two tab sets on one page
       would animate the pill between them. */
    const layoutId = React.useMemo(() => `tab-pill-${++tabsAutoId}`, [])

    const handleChange = React.useCallback(
      (next: string) => {
        setInternal(next)
        onValueChange?.(next)
      },
      [onValueChange]
    )

    return (
      <TabsContext.Provider value={{ value: current, layoutId }}>
        <TabsPrimitive.Root
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onValueChange={handleChange}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1 rounded-full border border-canvas-line bg-canvas-elevated p-1',
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
>(({ className, children, value, ...props }, ref) => {
  const { value: active, layoutId } = React.useContext(TabsContext)
  const reduce = useReducedMotion()
  const isActive = active === value

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        'relative inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-4',
        'text-[13px] font-medium whitespace-nowrap transition-colors duration-200',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        isActive ? 'text-on-accent' : 'text-ink-dim hover:text-ink',
        className
      )}
      {...props}
    >
      {isActive && (
        <motion.span
          layoutId={reduce ? undefined : layoutId}
          className="absolute inset-0 rounded-full bg-accent"
          transition={springSnappy}
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-6 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
