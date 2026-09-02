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
  CreditCard,
  Moon,
  Sun,
  LogIn,
  KanbanSquare,
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
import { useCommandPalette } from './index'

/* Every workspace route the app actually serves. This list had drifted a
   long way behind the product — Career Coach and the Application Tracker,
   two of the largest features, were unreachable from ⌘K entirely, as were
   Cover Letter, Offers and Policy News. Anything added under
   app/(protected) belongs here as well as in DashboardNav. */
const WORKSPACE = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Resume Analyzer', href: '/resume', icon: FileSearch },
  { label: 'Interview Coach', href: '/interview', icon: MessageSquareCode },
  { label: 'Jobs', href: '/jobs', icon: Briefcase },
  { label: 'Applications', href: '/applications', icon: KanbanSquare },
  { label: 'Cover Letter', href: '/cover-letter', icon: FileText },
  { label: 'Offers', href: '/offers', icon: Scale },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Reports', href: '/reports', icon: TrendingUp },
]

const ACCOUNT = [
  { label: 'Profile', href: '/profile', icon: User },
  { label: 'Settings', href: '/settings', icon: Settings },
]

const SITE = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Pricing', href: '/pricing', icon: CreditCard },
  { label: 'Sign in', href: '/login', icon: LogIn },
]

/**
 * The palette itself, and the only module in the app that pulls in cmdk.
 * Loaded through next/dynamic on first ⌘K rather than imported by the root
 * layout, so neither cmdk nor these twenty icons are in any route's initial
 * graph. Nothing here runs until someone actually asks for the palette.
 */
export default function PaletteDialog() {
  const { open, setOpen } = useCommandPalette()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  const run = React.useCallback(
    (action: () => void) => {
      setOpen(false)
      action()
    },
    [setOpen],
  )

  return (
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
            onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
          >
            {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
