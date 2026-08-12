'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion'
import { ArrowRight, Menu, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import ThemeToggle from '@/components/ThemeToggle'
import { ZenithMark } from '@/components/ZenithMark'
import { useCommandPalette } from '@/components/CommandPalette'
import { spring, springSnappy, layoutIds } from '@/lib/motion'
import { cn } from '@/lib/utils'

const LINKS = [
  { label: 'Features', href: '/features' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Dashboard', href: '/dashboard' },
]

/**
 * The floating capsule header.
 *
 * A single shared pill tracks the pointer across the links and settles back
 * onto the current route when the pointer leaves — so hover and location are
 * expressed by the same object rather than two competing highlights.
 */
export function FloatingNav() {
  const pathname = usePathname()
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = React.useState(false)
  const [hidden, setHidden] = React.useState(false)
  const [hovered, setHovered] = React.useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { toggle } = useCommandPalette()

  const { scrollY } = useScroll()

  /* Direction-aware chrome: scrolling down yields the viewport to content,
     scrolling up brings navigation back. A small delta threshold keeps
     trackpad jitter and momentum bounce from flickering the bar. */
  useMotionValueEvent(scrollY, 'change', (y) => {
    const previous = scrollY.getPrevious() ?? 0
    const delta = y - previous

    setScrolled(y > 16)

    if (mobileOpen) {
      setHidden(false)
      return
    }
    if (y <= 16) {
      setHidden(false)
      return
    }
    if (Math.abs(delta) < 6) return
    setHidden(delta > 0)
  })

  const activeHref = LINKS.find(
    (l) => pathname === l.href || pathname.startsWith(`${l.href}/`)
  )?.href
  const pillHref = hovered ?? activeHref

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={
        hidden && !reduce
          ? { y: '-140%', opacity: 0 }
          : { y: 0, opacity: 1 }
      }
      transition={spring}
      className="fixed inset-x-0 top-3 z-50 flex justify-center px-4 sm:top-4"
    >
      <nav
        aria-label="Primary"
        className={cn(
          'flex w-full max-w-5xl items-center justify-between gap-3 rounded-full px-3 py-2.5 sm:px-4',
          'glass transition-shadow duration-300 ease-[var(--ease-enter)]',
          scrolled ? 'shadow-[var(--shadow-raised)]' : 'shadow-[var(--shadow-card)]'
        )}
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-full pl-1.5 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ZenithMark className="size-7 transition-transform duration-300 group-hover:scale-110" />
          {/* Always visible. This was `hidden sm:block`, and sm is 640px — so
              the wordmark disappeared on every phone (iPhone SE 375, 12 390),
              leaving an unlabelled icon. */}
          <span className="wordmark text-[17px] text-ink">
            Zenith
          </span>
        </Link>

        {/* Desktop links */}
        <div
          className="hidden items-center md:flex"
          onMouseLeave={() => setHovered(null)}
        >
          {LINKS.map(({ label, href }) => {
            const isPill = pillHref === href
            return (
              <Link
                key={href}
                href={href}
                onMouseEnter={() => setHovered(href)}
                onFocus={() => setHovered(href)}
                aria-current={activeHref === href ? 'page' : undefined}
                className={cn(
                  'relative rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  isPill ? 'text-ink' : 'text-ink-dim hover:text-ink'
                )}
              >
                {isPill && (
                  <motion.span
                    layoutId={reduce ? undefined : layoutIds.navPill}
                    className="absolute inset-0 -z-10 rounded-full bg-canvas-elevated"
                    transition={springSnappy}
                  />
                )}
                {label}
              </Link>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button
            variant="outline"
            onClick={toggle}
            aria-label="Open command palette"
            className={cn(
              'hidden h-9 items-center gap-2 border-canvas-line bg-canvas-raise/60 py-1.5 pl-3 pr-2 lg:inline-flex',
              'text-[13px] font-normal text-ink-faint hover:border-line-strong hover:text-ink-dim'
            )}
          >
            <Search className="size-3.5" aria-hidden="true" />
            <span>Search</span>
            <kbd className="rounded border border-canvas-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] tracking-widest">
              ⌘K
            </kbd>
          </Button>

          {/* Icon-only palette trigger below lg, where the labelled pill won't fit */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label="Open command palette"
            className="lg:hidden"
          >
            <Search />
          </Button>

          <ThemeToggle />

          <Link
            href="/login"
            className="hidden rounded-full px-3 py-2 text-sm font-medium text-ink-dim transition-colors hover:text-ink md:block"
          >
            Sign in
          </Link>

          <Button asChild size="sm" className="hidden md:inline-flex">
            <Link href="/register">
              Get started
              <ArrowRight />
            </Link>
          </Button>

          {/* Mobile */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open menu" className="md:hidden">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="top" className="rounded-b-3xl">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2.5 wordmark text-xl">
                  <ZenithMark className="size-6" />
                  Zenith
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-1 px-6 pb-8">
                {LINKS.map(({ label, href }) => (
                  <SheetClose asChild key={href}>
                    <Link
                      href={href}
                      className="rounded-xl px-4 py-3 text-[15px] font-medium text-ink-dim transition-colors hover:bg-canvas-elevated hover:text-ink"
                    >
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <Separator className="my-3" />
                <SheetClose asChild>
                  <Link
                    href="/login"
                    className="rounded-xl px-4 py-3 text-[15px] font-medium text-ink-dim transition-colors hover:bg-canvas-elevated hover:text-ink"
                  >
                    Sign in
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild size="lg" className="mt-2 w-full">
                    <Link href="/register">
                      Get started free
                      <ArrowRight />
                    </Link>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </motion.header>
  )
}
