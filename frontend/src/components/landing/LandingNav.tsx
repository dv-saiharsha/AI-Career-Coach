'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Sparkles } from 'lucide-react';
import ThemeToggle from '../ThemeToggle';

const NAV_LINKS = [
  { label: 'Features', href: '#features', page: '/features' },
  { label: 'How It Works', href: '#how-it-works', page: '/#how-it-works' },
  { label: 'Pricing', href: '#pricing', page: '/pricing' },
];

function smoothScrollTo(id: string) {
  const el = document.querySelector(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function LandingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isHome = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleNavClick(e: React.MouseEvent, href: string) {
    if (isHome && href.startsWith('#')) {
      e.preventDefault();
      smoothScrollTo(href);
      setMobileOpen(false);
    }
  }

  return (
    <>
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4"
      >
        <div
          className={`flex items-center justify-between w-full max-w-5xl rounded-full px-5 py-3 transition-all duration-300 ${
            scrolled
              ? 'bg-[var(--color-canvas)]/90 backdrop-blur-xl border border-[var(--color-canvas-line)] shadow-[0_4px_32px_rgba(0,0,0,0.5)]'
              : 'bg-[var(--color-canvas-raise)]/70 backdrop-blur-md border border-[var(--color-canvas-line)]/60'
          }`}
        >
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-lg"
          >
            <div className="relative w-7 h-7">
              <div
                className="absolute inset-0 rounded-full opacity-90 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(to top right, var(--color-accent, #8B5CF6), var(--color-accent-light, #A78BFA))' }}
              />
              <div
                className="absolute inset-0 rounded-full blur-sm opacity-50 group-hover:opacity-80 transition-opacity"
                style={{ background: 'linear-gradient(to top right, var(--color-accent, #8B5CF6), var(--color-accent-light, #A78BFA))' }}
              />
            </div>
            <span className="font-display font-semibold tracking-tight text-[var(--color-ink)] text-[15px] hidden sm:block">
              AI Career Coach
            </span>
          </Link>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ label, href, page }) => (
              <Link
                key={label}
                href={isHome ? href : page}
                onClick={(e) => handleNavClick(e, href)}
                className="relative text-sm font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-4 py-2 rounded-full hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                {label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              className="text-sm font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-4 py-2 rounded-full hover:bg-white/5"
            >
              Dashboard
            </Link>
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="text-sm font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-3 py-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)] hover:scale-[1.03] active:scale-[0.97] transition-all px-5 py-2.5 rounded-full"
              style={{
                background: 'linear-gradient(to right, var(--color-accent, #8B5CF6), var(--color-accent-dim, #6D28D9))',
                boxShadow: '0 0 20px color-mix(in srgb, var(--color-accent, #8B5CF6) 30%, transparent)',
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Get Started
            </Link>
          </div>

          {/* Mobile controls */}
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              className="p-2 rounded-lg text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-white/5 transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 left-4 right-4 z-40 bg-[var(--color-canvas-raise)]/95 backdrop-blur-xl border border-[var(--color-canvas-line)] rounded-2xl p-4 shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
          >
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map(({ label, href, page }) => (
                <Link
                  key={label}
                  href={isHome ? href : page}
                  onClick={(e) => handleNavClick(e, href)}
                  className="text-[15px] font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-4 py-3 rounded-xl hover:bg-white/5"
                >
                  {label}
                </Link>
              ))}
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="text-[15px] font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-4 py-3 rounded-xl hover:bg-white/5"
              >
                Dashboard
              </Link>
              <div className="border-t border-[var(--color-canvas-line)] my-2" />
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="text-[15px] font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors px-4 py-3 rounded-xl hover:bg-white/5"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center gap-2 text-[15px] font-semibold text-[var(--color-ink)] px-4 py-3 rounded-xl"
                style={{ background: 'linear-gradient(to right, var(--color-accent, #8B5CF6), var(--color-accent-dim, #6D28D9))' }}
              >
                <Sparkles className="w-4 h-4" />
                Get Started Free
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
