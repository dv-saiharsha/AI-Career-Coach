'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Menu, Sparkles } from 'lucide-react'
import ThemeToggle from '../ThemeToggle'
import { ZenithMark } from '../ZenithMark'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '../ui/sheet'

const NAV_LINKS = [
  { label: 'Features', href: '#features', page: '/features' },
  { label: 'How It Works', href: '#how-it-works', page: '/how-it-works' },
  { label: 'Pricing', href: '#pricing', page: '/pricing' },
]

function smoothScrollTo(id: string) {
  document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function LandingNav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isHome = pathname === '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function handleNavClick(e: React.MouseEvent, href: string) {
    if (isHome && href.startsWith('#')) {
      e.preventDefault()
      smoothScrollTo(href)
      setMobileOpen(false)
    }
  }

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="fixed left-0 right-0 top-4 z-50 flex justify-center px-4"
    >
      <div
        className={`flex w-full max-w-[1100px] items-center justify-between rounded-full px-5 py-3 transition-all duration-300 ${
          scrolled
            ? 'border border-border bg-surface/90 shadow-[var(--shadow-raised)] backdrop-blur-xl'
            : 'border border-border/60 bg-surface/70 backdrop-blur-md'
        }`}
      >
        <Link href="/" className="group flex items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ZenithMark className="h-7 w-7 transition-transform duration-300 group-hover:scale-110" />
          <span className="hidden font-display text-[15px] font-semibold tracking-tight text-foreground sm:block">Zenith</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(({ label, href, page }) => (
            <Link
              key={label}
              href={isHome ? href : page}
              onClick={(e) => handleNavClick(e, href)}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </Link>
          ))}
          <Link href="/dashboard" className="rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground">
            Dashboard
          </Link>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Sign In
          </Link>
          <Button asChild size="sm">
            <Link href="/register">
              <Sparkles className="h-3.5 w-3.5" />
              Get Started
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-raised hover:text-foreground" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="top" className="rounded-b-3xl">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ZenithMark className="h-6 w-6" />
                  Zenith
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-1 px-6 pb-6">
                {NAV_LINKS.map(({ label, href, page }) => (
                  <SheetClose asChild key={label}>
                    <Link
                      href={isHome ? href : page}
                      onClick={(e) => handleNavClick(e, href)}
                      className="rounded-xl px-4 py-3 text-[15px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Link href="/dashboard" className="rounded-xl px-4 py-3 text-[15px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground">
                    Dashboard
                  </Link>
                </SheetClose>
                <div className="my-2 border-t border-border" />
                <SheetClose asChild>
                  <Link href="/login" className="rounded-xl px-4 py-3 text-[15px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground">
                    Sign In
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild size="lg" className="mt-1 justify-center">
                    <Link href="/register">
                      <Sparkles className="h-4 w-4" />
                      Get Started Free
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </motion.nav>
  )
}
