'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  FileSearch,
  MessageSquareCode,
  Briefcase,
  FileText,
  BarChart3,
  TrendingUp,
  User,
  Settings,
  Home,
  Sparkles,
  CreditCard,
  Moon,
  Sun,
  LogIn,
  KanbanSquare,
  Newspaper,
  Scale,
} from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

type PaletteCtx = {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext = React.createContext<PaletteCtx | null>(null)

/** Read the palette from anywhere (the nav trigger, an empty state, a hint). */
export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  return ctx
}

/* Every workspace route the app actually serves. This list had drifted a
   long way behind the product — Career Coach and the Application Tracker,
   two of the largest features, were unreachable from ⌘K entirely, as were
   Cover Letter, Offers and Policy News. Anything added under
   app/(protected) belongs here as well as in DashboardNav. */
const WORKSPACE = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Career Coach', href: '/coach', icon: Sparkles },
  { label: 'Resume Analyzer', href: '/resume', icon: FileSearch },
  { label: 'Interview Coach', href: '/interview', icon: MessageSquareCode },
  { label: 'Job Market', href: '/jobs', icon: Briefcase },
  { label: 'Applications', href: '/applications', icon: KanbanSquare },
  { label: 'Offers', href: '/offers', icon: Scale },
  /* /cover-letter is deliberately absent: it needs a job_id from the Job
     Market drawer to generate anything, so arriving cold would land the
     user on a page they cannot use. */
  { label: 'Policy News', href: '/news', icon: Newspaper },
  { label: 'Reports', href: '/reports', icon: FileText },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'History', href: '/history', icon: TrendingUp },
]

const ACCOUNT = [
  { label: 'Profile', href: '/profile', icon: User },
  { label: 'Settings', href: '/settings', icon: Settings },
]

const SITE = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Features', href: '/features', icon: Sparkles },
  { label: 'Pricing', href: '/pricing', icon: CreditCard },
  { label: 'Sign in', href: '/login', icon: LogIn },
]

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  const toggle = React.useCallback(() => setOpen((o) => !o), [])

  /* ⌘K / Ctrl+K anywhere. Ignored while the user is typing in a field so it
     never steals a genuine keystroke. */
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return

      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && !open) return

      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggle, open])

  const run = React.useCallback((action: () => void) => {
    setOpen(false)
    action()
  }, [])

  const value = React.useMemo(() => ({ open, setOpen, toggle }), [open, toggle])

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          <CommandGroup heading="Workspace">
            {WORKSPACE.map(({ label, href, icon: Icon }) => (
              <CommandItem
                key={href}
                value={`${label} ${href}`}
                onSelect={() => run(() => router.push(href))}
              >
                <Icon aria-hidden="true" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Account">
            {ACCOUNT.map(({ label, href, icon: Icon }) => (
              <CommandItem
                key={href}
                value={`${label} ${href}`}
                onSelect={() => run(() => router.push(href))}
              >
                <Icon aria-hidden="true" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Site">
            {SITE.map(({ label, href, icon: Icon }) => (
              <CommandItem
                key={href}
                value={`${label} ${href}`}
                onSelect={() => run(() => router.push(href))}
              >
                <Icon aria-hidden="true" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Preferences">
            <CommandItem
              value="toggle theme dark light appearance"
              onSelect={() =>
                run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))
              }
            >
              {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  )
}
