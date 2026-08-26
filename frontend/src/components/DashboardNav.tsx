'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  LayoutDashboard,
  FileSearch,
  MessageSquareCode,
  User,
  Settings,
  Bell,
  LogOut,
  Menu,
  TrendingUp,
  Briefcase,
  KanbanSquare,
  Search,
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { ApplyCenterMark } from './ApplyCenterMark'
import ThemeToggle from './ThemeToggle'
import { LimelightNav } from './ui/limelight-nav'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { useCommandPalette } from '@/components/CommandPalette'
import { springSnappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: FileSearch, label: 'Resume Analyzer', href: '/resume' },
  { icon: MessageSquareCode, label: 'Interview Coach', href: '/interview' },
  { icon: Briefcase, label: 'Job Market', href: '/jobs' },
  { icon: KanbanSquare, label: 'Applications & Offers', href: '/applications' },
  { icon: TrendingUp, label: 'History', href: '/history' },
]

const BOTTOM_ITEMS = [
  { icon: User, label: 'Profile', href: '/profile' },
  { icon: Settings, label: 'Settings', href: '/settings' },
]

const MOBILE_NAV_ITEMS = [
  { id: '/dashboard', icon: <LayoutDashboard />, label: 'Overview' },
  { id: '/resume', icon: <FileSearch />, label: 'Resume Analyzer' },
  { id: '/interview', icon: <MessageSquareCode />, label: 'Interview Coach' },
  { id: '/profile', icon: <User />, label: 'Profile' },
]

function NavLink({
  item,
  active,
  onNavigate,
  scope,
}: {
  item: { icon: React.ElementType; label: string; href: string }
  active: boolean
  onNavigate?: () => void
  scope: string
}) {
  const Icon = item.icon
  const reduce = useReducedMotion()

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative mx-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
        'outline-none transition-colors duration-200',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        active ? 'text-ink' : 'text-ink-dim hover:text-ink'
      )}
    >
      {active && (
        <motion.span
          layoutId={reduce ? undefined : `sidebar-pill-${scope}`}
          className="absolute inset-0 -z-10 rounded-xl bg-canvas-elevated"
          transition={springSnappy}
        />
      )}
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

function SidebarContent({
  pathname,
  scope,
  onNavigate,
}: {
  pathname: string
  scope: string
  onNavigate?: () => void
}) {
  const { user, logout } = useAuth()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-5 py-4">
        <Link
          href="/"
          className="group flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ApplyCenterMark className="size-7 transition-transform duration-300 group-hover:scale-110" />
          <span className="wordmark text-[17px] tracking-[-0.02em] text-ink">ApplyCenter</span>
        </Link>
      </div>

      <Separator />

      <nav aria-label="Workspace" className="flex-1 space-y-0.5 overflow-y-auto py-4">
        <p className="mb-2 px-5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Menu
        </p>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            onNavigate={onNavigate}
            scope={scope}
          />
        ))}
      </nav>

      <Separator />

      <div className="space-y-0.5 py-4">
        <p className="mb-2 px-5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Account
        </p>
        {BOTTOM_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            onNavigate={onNavigate}
            scope={scope}
          />
        ))}
        <Button
          variant="ghost"
          onClick={logout}
          className="mx-2 h-auto w-[calc(100%-1rem)] justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:text-danger"
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          Sign out
        </Button>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-3 rounded-xl border border-canvas-line bg-canvas-raise p-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-accent text-sm font-medium text-on-accent">
              {user?.firstName?.[0]?.toUpperCase() ?? 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{user?.fullName || 'User'}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { toggle } = useCommandPalette()

  const currentLabel =
    [...NAV_ITEMS, ...BOTTOM_ITEMS].find((item) => item.href === pathname)?.label ?? 'Overview'
  const mobileActiveIndex = MOBILE_NAV_ITEMS.findIndex((item) => item.id === pathname)

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 shrink-0 flex-col border-r border-canvas-line bg-canvas md:flex">
        <SidebarContent pathname={pathname} scope="desktop" />
      </aside>

      <div className="flex flex-1 flex-col md:ml-60">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-canvas-line bg-canvas/80 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
                <SidebarContent
                  pathname={pathname}
                  scope="mobile"
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <h1 className="truncate font-display text-lg tracking-[-0.02em] text-ink">
              {currentLabel}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label="Open command palette"
            >
              <Search />
            </Button>

            <ThemeToggle />

            <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
              <Bell />
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent"
              />
            </Button>

            <Link
              href="/profile"
              aria-label="Your profile"
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <Avatar className="size-8 transition-opacity hover:opacity-85">
                <AvatarFallback className="bg-accent text-sm font-medium text-on-accent">
                  {user?.firstName?.[0]?.toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-5 pb-24 md:p-7 md:pb-7">{children}</main>
      </div>

      {/* Bottom bar on small screens, where the sidebar is behind a trigger */}
      <div className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 md:hidden">
        <LimelightNav
          items={MOBILE_NAV_ITEMS.map((item) => ({
            ...item,
            onClick: () => router.push(item.id),
          }))}
          activeIndex={mobileActiveIndex === -1 ? 0 : mobileActiveIndex}
        />
      </div>
    </div>
  )
}
