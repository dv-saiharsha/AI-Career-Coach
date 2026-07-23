'use client'

import { cn } from '@/lib/utils'

export function InfiniteMovingCards({
  items,
  speed = 'normal',
  direction = 'left',
  className,
}: {
  items: React.ReactNode[]
  speed?: 'slow' | 'normal' | 'fast'
  direction?: 'left' | 'right'
  className?: string
}) {
  const duration = { slow: '70s', normal: '45s', fast: '25s' }[speed]

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,white_8%,white_92%,transparent)]',
        className
      )}
    >
      <div
        className="flex w-max shrink-0 gap-6 py-2 motion-safe:animate-marquee hover:[animation-play-state:paused]"
        style={{
          animationDuration: duration,
          animationDirection: direction === 'right' ? 'reverse' : 'normal',
          ['--gap' as string]: '1.5rem',
        }}
      >
        {[...items, ...items].map((item, i) => (
          <div key={i} className="w-[22rem] shrink-0">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}
