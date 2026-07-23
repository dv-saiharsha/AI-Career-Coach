'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileSearch, MessageSquareCode, BarChart3, FileText,
  User, Settings, Bell, LogOut, Menu, X, Trophy, TrendingUp, Briefcase
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { ZenithMark } from './ZenithMark';
import ThemeToggle from './ThemeToggle';
import { LimelightNav } from './ui/limelight-nav';

const EASE = [0.22, 1, 0.36, 1] as const;

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: FileSearch, label: 'Resume Analyzer', href: '/resume' },
  { icon: MessageSquareCode, label: 'Interview Coach', href: '/interview' },
  { icon: Briefcase, label: 'Job Market', href: '/jobs' },
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
      className={`relative flex items-center gap-3 pl-4 pr-3 py-2 text-sm font-medium transition-colors ${
        active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
      }`}
    >
      {active && (
        <motion.span
          layoutId={`nav-active-bar-${scope}`}
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--color-accent)]"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <Icon className="relative w-4 h-4 shrink-0" />
      <span className="relative">{item.label}</span>
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
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-canvas-line)]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-full bg-[var(--color-accent)] flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
            <ZenithMark className="w-3.5 h-3.5 text-[var(--color-on-accent)]" tone="flat" />
          </div>
          <span className="font-display font-medium text-[var(--color-ink)] text-[15px] tracking-tight">Zenith</span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        <div className="px-5 mb-1.5 eyebrow text-[10px] text-[var(--color-ink-faint)]">Menu</div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} onClick={onClose} scope={scope} />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="py-3 border-t border-[var(--color-canvas-line)] space-y-0.5">
        <div className="px-5 mb-1.5 eyebrow text-[10px] text-[var(--color-ink-faint)]">Account</div>
        {BOTTOM_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={pathname === item.href} onClick={onClose} scope={scope} />
        ))}
        <button
          onClick={() => { logout(); }}
          className="w-full flex items-center gap-3 pl-4 pr-3 py-2 text-sm font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-signal-low)] transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>

      {/* User info */}
      <div className="p-3 border-t border-[var(--color-canvas-line)]">
        <div className="flex items-center gap-3 p-2.5 rounded-[14px] border border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)]">
          <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-sm font-medium text-[var(--color-on-accent)] shrink-0">
            {user?.firstName?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--color-ink)] truncate">{user?.fullName || 'User'}</div>
            <span className="text-[10px] font-mono text-[var(--color-ink-faint)] mt-0.5 block truncate">
              {user?.email}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MOBILE_NAV_ITEMS = [
  { id: '/dashboard', icon: <LayoutDashboard />, label: 'Overview' },
  { id: '/resume', icon: <FileSearch />, label: 'Resume Analyzer' },
  { id: '/interview', icon: <MessageSquareCode />, label: 'Interview Coach' },
  { id: '/analytics', icon: <BarChart3 />, label: 'Analytics' },
  { id: '/profile', icon: <User />, label: 'Profile' },
];

export function DashboardNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentLabel = [...NAV_ITEMS, ...BOTTOM_ITEMS].find((item) => item.href === pathname)?.label ?? 'Overview';
  const mobileActiveIndex = MOBILE_NAV_ITEMS.findIndex((item) => item.id === pathname);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-[var(--color-canvas)] border-r border-[var(--color-canvas-line)] fixed inset-y-0 left-0 z-20">
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
              className="fixed inset-0 bg-black/60 z-30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="fixed inset-y-0 left-0 w-60 bg-[var(--color-canvas)] border-r border-[var(--color-canvas-line)] z-40 flex flex-col md:hidden"
            >
              <SidebarContent onClose={() => setSidebarOpen(false)} scope="mobile" pathname={pathname} user={user} logout={logout} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <div className="flex-1 flex flex-col md:ml-60">
        {/* Top toolbar */}
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-canvas-line)] bg-[var(--color-canvas)]">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded-full text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="hidden md:block eyebrow text-[var(--color-ink)]">
              {currentLabel}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button className="relative p-2 rounded-full text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors">
              <Bell className="w-[18px] h-[18px]" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] heartbeat-glow" />
            </button>
            <Link
              href="/profile"
              className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-sm font-medium text-[var(--color-on-accent)] hover:opacity-90 transition-opacity"
            >
              {user?.firstName?.[0]?.toUpperCase() ?? 'U'}
            </Link>
          </div>
        </header>

        {/* Page content — bottom padding on mobile clears the fixed bottom nav */}
        <main className="flex-1 p-5 md:p-7 pb-24 md:pb-7">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — the sidebar lives behind a hamburger on
          small screens, so the main sections get one-tap access here */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 md:hidden">
        <LimelightNav
          items={MOBILE_NAV_ITEMS.map((item) => ({ ...item, onClick: () => router.push(item.id as string) }))}
          activeIndex={mobileActiveIndex === -1 ? 0 : mobileActiveIndex}
        />
      </div>
    </div>
  );
}
