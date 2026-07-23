'use client'

import React, { useState, useRef, useLayoutEffect, cloneElement } from 'react'

export type NavItem = {
  id: string | number
  icon: React.ReactElement<React.SVGProps<SVGSVGElement>>
  label?: string
  onClick?: () => void
}

type LimelightNavProps = {
  items: NavItem[]
  /** Controlled active index — pass this (e.g. derived from the route) and the
   * limelight follows it; omit to let the component manage its own state. */
  activeIndex?: number
  defaultActiveIndex?: number
  onTabChange?: (index: number) => void
  className?: string
  limelightClassName?: string
  iconContainerClassName?: string
  iconClassName?: string
}

/**
 * An adaptive-width navigation bar with a "limelight" effect that highlights
 * the active item. Colors ride on the app's design tokens (surface/border/
 * primary) so it follows light/dark theme automatically.
 */
export const LimelightNav = ({
  items,
  activeIndex: controlledIndex,
  defaultActiveIndex = 0,
  onTabChange,
  className = '',
  limelightClassName = '',
  iconContainerClassName = '',
  iconClassName = '',
}: LimelightNavProps) => {
  const [internalIndex, setInternalIndex] = useState(defaultActiveIndex)
  const activeIndex = controlledIndex ?? internalIndex
  const [isReady, setIsReady] = useState(false)
  const navItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const limelightRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (items.length === 0) return

    const limelight = limelightRef.current
    const activeItem = navItemRefs.current[activeIndex]

    if (limelight && activeItem) {
      const newLeft = activeItem.offsetLeft + activeItem.offsetWidth / 2 - limelight.offsetWidth / 2
      limelight.style.left = `${newLeft}px`

      if (!isReady) {
        setTimeout(() => setIsReady(true), 50)
      }
    }
  }, [activeIndex, isReady, items])

  if (items.length === 0) {
    return null
  }

  const handleItemClick = (index: number, itemOnClick?: () => void) => {
    setInternalIndex(index)
    onTabChange?.(index)
    itemOnClick?.()
  }

  return (
    <nav
      className={`relative inline-flex items-center h-14 rounded-2xl bg-surface text-foreground border border-border px-1 ${className}`}
    >
      {items.map(({ id, icon, label, onClick }, index) => (
        <button
          key={id}
          type="button"
          ref={(el) => {
            navItemRefs.current[index] = el
          }}
          className={`relative z-20 flex h-full cursor-pointer items-center justify-center px-4 ${iconContainerClassName}`}
          onClick={() => handleItemClick(index, onClick)}
          aria-label={label}
          title={label}
          aria-current={activeIndex === index ? 'page' : undefined}
        >
          {cloneElement(icon, {
            className: `w-5 h-5 transition-opacity duration-100 ease-in-out ${
              activeIndex === index ? 'opacity-100 text-primary' : 'opacity-40'
            } ${icon.props.className || ''} ${iconClassName}`,
          })}
        </button>
      ))}

      <div
        ref={limelightRef}
        className={`absolute top-0 z-10 w-10 h-[4px] rounded-full bg-primary ${
          isReady ? 'transition-[left] duration-400 ease-in-out' : ''
        } ${limelightClassName}`}
        style={{ left: '-999px' }}
      >
        <div className="absolute left-[-30%] top-[4px] w-[160%] h-12 [clip-path:polygon(5%_100%,25%_0,75%_0,95%_100%)] bg-gradient-to-b from-primary/25 to-transparent pointer-events-none" />
      </div>
    </nav>
  )
}
