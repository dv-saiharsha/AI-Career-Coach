'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileSearch, MessageSquareCode, BarChart3, FileText,
  User, Settings, Bell, LogOut, Menu, X, Trophy, TrendingUp, ChevronRight, Sparkles
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import ThemeToggle from './ThemeToggle';

const EASE = [0.22, 1, 0.36, 1] as const;

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: FileSearch, label: 'Resume Analyzer', href: '/resume' },
  { icon: MessageSquareCode, label: 'Interview Coach', href: '/interview' },
  { icon: FileText, label: 'Reports', href: '/reports' },
  { icon: BarChart3, label: 'Analytics', href: '/analytics' },
  { icon: Trophy, label: 'Achievements', href: '/achievements' },
  { icon: TrendingUp, label: 'History', href: '/history' },
];

const BOTTOM_ITEMS = [
  { icon: User, label: 'Profile', href: '/profile' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

function NavLink({
  item,
  active,
  onClick,
  scope,
}: {
  item: typeof NAV_ITEMS[0];
  active: boolean;
  onClick?: () => void;
  scope: 'desktop' | 'mobile';
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-white/5'
      }`}
    >
      {active && (
        <motion.span
          layoutId={`nav-active-pill-${scope}`}
          className="absolute inset-0 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/25"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <Icon className="relative w-4 h-4 shrink-0" />
      <span className="relative">{item.label}</span>
      {active && <ChevronRight className="relative w-3.5 h-3.5 ml-auto text-[var(--color-accent)]" />}
    </Link>
  );
}

function SidebarContent({
  onClose,
  scope,
  pathname,
  user,
  logout,
}: {
  onClose?: () => void;
  scope: 'desktop' | 'mobile';
  pathname: string;
  user: ReturnType<typeof useAuth>['user'];
  logout: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between p-5 border-b border-[var(--color-canvas-line-soft)]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dim)] flex items-center justify-center shadow-glow-sm transition-transform duration-300 group-hover:scale-105">
            <Sparkles className="w-4 h-4 text-[var(--color-ink)]" />
          </div>
          <span className="font-display font-semibold text-[var(--color-ink)] text-[14px]">AI Career Coach</span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">Menu</div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} onClick={onClose} scope={scope} />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="p-4 border-t border-[var(--color-canvas-line-soft)] space-y-1">
        <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">Account</div>
        {BOTTOM_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} onClick={onClose} scope={scope} />
        ))}
        <button
          onClick={() => { logout(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--color-ink-dim)] hover:bg-[#EF4444]/10 hover:text-[#EF4444] transition-all"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>

      {/* User info */}
      <div className="p-4 border-t border-[var(--color-canvas-line-soft)]">
        <div className="flex items-center gap-3 p-3 glass-card">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dim)] flex items-center justify-center text-sm font-bold text-white shrink-0 ring-2 ring-[var(--color-accent)]/20">
            {user?.email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--color-ink)] truncate">{user?.email ?? 'User'}</div>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-lighter)] mt-0.5">
              <span className="w-1 h-1 rounded-full bg-[var(--color-accent-lighter)]" />
              Professional Plan
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentLabel = [...NAV_ITEMS, ...BOTTOM_ITEMS].find((item) => item.href === pathname)?.label ?? 'Overview';

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 md:left-[calc(50%+7.5rem)] -translate-x-1/2 w-[900px] h-[500px] bg-[var(--color-accent)]/[0.06] rounded-full blur-[160px] pointer-events-none -z-10" />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-[var(--color-canvas-line-soft)] bg-[var(--color-canvas)] fixed inset-y-0 left-0 z-20">
        <SidebarContent scope="desktop" pathname={pathname} user={user} logout={logout} />
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="fixed inset-y-0 left-0 w-60 bg-[var(--color-canvas)] border-r border-[var(--color-canvas-line-soft)] z-40 flex flex-col md:hidden"
            >
              <SidebarContent onClose={() => setSidebarOpen(false)} scope="mobile" pathname={pathname} user={user} logout={logout} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <div className="flex-1 flex flex-col md:ml-60">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-canvas-line-soft)] bg-[var(--color-canvas)]/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded-lg text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-white/5 transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="hidden md:block text-sm font-medium text-[var(--color-ink-dim)]">
              <span className="text-[var(--color-ink)] font-semibold">{currentLabel}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button className="relative p-2 rounded-lg text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-white/5 transition-colors">
              <Bell className="w-[18px] h-[18px]" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] heartbeat-glow" />
            </button>
            <Link
              href="/profile"
              className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-dim)] flex items-center justify-center text-sm font-bold text-white hover:scale-105 transition-transform ring-1 ring-[var(--color-accent)]/30"
            >
              {user?.email?.[0]?.toUpperCase() ?? 'U'}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-5 md:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
