'use client'

import * as React from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet'
import { ApplyCenterMark } from '@/components/ApplyCenterMark'
import ThemeToggle from '@/components/ThemeToggle'

const LINKS = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'What you get', href: '/features' },
  { label: 'For partners', href: '/pricing' },
]

/**
 * The sticky nav capsule.
 *
 * It sits flush over the hero and gains its raised shadow across the first
 * 40px of scroll. That behaviour is a CSS scroll-driven animation on
 * `.nav-capsule` (see globals.css) rather than a scroll listener, so there
 * is no state, no rAF loop and no main-thread work on scroll at all — which
 * is also why this component holds no scroll state of its own.
 *
 * Height is 64px, inside the 80px cap. Every item fits on one line at
 * desktop; below `md` the links move into a drawer rather than wrapping.
 */
export function SiteNav() {
  const [open, setOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 w-full px-4 pt-4">
      <nav
        aria-label="Main"
        className="nav-capsule mx-auto flex h-16 w-full max-w-[76rem] items-center gap-2 rounded-full px-3 sm:px-5"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-full pr-2 outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <ApplyCenterMark className="size-7" />
          <span className="wordmark text-[15px] text-ink">ApplyCenter</span>
        </Link>

        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex h-11 items-center rounded-full px-4 text-[13px] font-medium text-ink-dim transition-colors duration-200 ease-(--ease-enter) hover:text-ink active:shadow-(--neu-inset-sm) outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/register">Start free</Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-sm">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <ul className="flex flex-col gap-1 p-[22px] pt-2">
                {LINKS.map((link) => (
                  <li key={link.href}>
                    <SheetClose asChild>
                      <Link
                        href={link.href}
                        className="flex min-h-12 items-center rounded-md px-4 text-[15px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 active:shadow-(--neu-inset-sm)"
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-3 p-[22px]">
                <SheetClose asChild>
                  <Button asChild size="lg">
                    <Link href="/register">Start free</Link>
                  </Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/login">Sign in</Link>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  )
}
