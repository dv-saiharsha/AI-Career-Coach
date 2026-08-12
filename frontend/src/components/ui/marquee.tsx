'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface MarqueeProps extends React.ComponentPropsWithoutRef<'div'> {
  reverse?: boolean
  pauseOnHover?: boolean
  vertical?: boolean
  /** Seconds for one full pass. Slower reads as more premium. */
  duration?: number
  gap?: string
}

/**
 * Infinite scrolling strip.
 *
 * The children are rendered twice and the track translates exactly -50%, so
 * the seam lands on an identical frame and the loop is invisible. Animation
 * is a CSS transform (compositor-only) rather than a JS scroll handler.
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  vertical = false,
  duration = 40,
  gap = '2.5rem',
  children,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      style={
        {
          '--marquee-duration': `${duration}s`,
          '--gap': gap,
          gap,
          ...props.style,
        } as React.CSSProperties
      }
      className={cn(
        'group flex overflow-hidden',
        vertical ? 'flex-col' : 'flex-row',
        className
      )}
    >
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          aria-hidden={i === 1 || undefined}
          style={{ gap }}
          className={cn(
            'flex shrink-0 justify-around',
            vertical
              ? 'animate-marquee-vertical flex-col'
              : 'animate-marquee flex-row',
            reverse && '[animation-direction:reverse]',
            pauseOnHover && 'group-hover:[animation-play-state:paused]'
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}

/** Fades the strip into the canvas at both ends instead of cutting it off. */
export function MarqueeFade({
  side,
  className,
}: {
  side: 'left' | 'right'
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 z-10 w-24 sm:w-40',
        side === 'left'
          ? 'left-0 bg-gradient-to-r from-canvas to-transparent'
          : 'right-0 bg-gradient-to-l from-canvas to-transparent',
        className
      )}
    />
  )
}
