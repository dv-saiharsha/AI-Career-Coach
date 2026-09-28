import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Command, Menu, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { quickActions } from '@/config/navigation'
import { notificationsService } from '@/services/notificationsService'
import type { NotificationItem } from '@/types/notifications'

const NOTIFICATION_PANEL_LIMIT = 8

function notificationRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
import { CommandPalette } from './CommandPalette'
import { cn } from '@/lib/utils'

interface HeaderProps {
  onOpenMobileNav: () => void
}

function getBreadcrumb(pathname: string): { group: string; title: string } {
  if (pathname === '/dashboard') return { group: 'Overview', title: 'Dashboard' }
  if (pathname.startsWith('/resume')) {
    if (pathname === '/resume/results') return { group: 'Prepare', title: 'ATS Match Results' }
    if (pathname === '/resume/tailor') return { group: 'Prepare', title: 'Resume Tailor' }
    return { group: 'Prepare', title: 'ATS Check' }
  }
  if (pathname.startsWith('/interview')) {
    if (pathname === '/interview/session') return { group: 'Prepare', title: 'Live Simulation' }
    if (pathname === '/interview/feedback') return { group: 'Prepare', title: 'Session Performance' }
    return { group: 'Prepare', title: 'Interview Coach' }
  }
  if (pathname === '/cover-letter') return { group: 'Prepare', title: 'Cover Letter Generator' }
  if (pathname === '/jobs') return { group: 'Apply', title: 'Job Portal' }
  if (pathname === '/applications') return { group: 'Apply', title: 'Applications' }
  if (pathname === '/offers') return { group: 'Apply', title: 'Offer Comparison' }
  if (pathname === '/analytics') return { group: 'Overview', title: 'Analytics' }
  if (pathname === '/progress') return { group: 'Overview', title: 'Progress' }
  if (pathname === '/history') return { group: 'Account', title: 'History' }
  if (pathname === '/profile') return { group: 'Account', title: 'Profile' }
  if (pathname === '/settings') return { group: 'Account', title: 'Settings' }
  return { group: 'HireLoom', title: 'Dashboard' }
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const loadNotifications = () => {
    notificationsService.list().then((res) => {
      setNotifications(res.notifications.slice(0, NOTIFICATION_PANEL_LIMIT))
      setUnreadCount(res.unread_count)
    })
  }

  useEffect(() => {
    loadNotifications()
  }, [])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const { group, title } = getBreadcrumb(location.pathname)
  const hasUnread = unreadCount > 0

  const markAllRead = async () => {
    await notificationsService.markAllRead()
    loadNotifications()
  }

  const openNotification = async (item: NotificationItem) => {
    setNotificationsOpen(false)
    if (!item.read_at) {
      notificationsService.markRead(item.id).then(loadNotifications)
    }
    if (item.href) navigate(item.href)
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-[74px] min-w-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMobileNav}
            className="-ml-2 shrink-0 text-foreground md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <span className="hidden truncate text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground md:block">
              {group} / {title}
            </span>
            <h1 className="mt-0.5 truncate text-[19px] font-heading font-bold text-foreground">{title}</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={() => setCommandOpen(true)}
            className="hidden h-[38px] w-[240px] shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-muted-foreground transition-colors hover:border-secondary-foreground/30 lg:flex"
          >
            <Search size={17} />
            <span className="flex-1 text-left text-[11px]">Search anything</span>
            <span className="flex items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 text-[9px]">
              <Command size={12} />K
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCommandOpen(true)}
            className="text-muted-foreground lg:hidden"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>

          <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-muted-foreground hover:text-foreground"
                aria-label="Notifications"
              >
                <Bell className="h-[19px] w-[19px]" />
                {hasUnread && (
                  <i className="absolute right-2 top-2 h-[7px] w-[7px] rounded-full border-2 border-card bg-coral" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[340px] rounded-lg p-2 shadow-elevated">
              <div className="flex items-center justify-between px-2 py-1.5">
                <h3 className="text-[13px] font-heading font-bold text-foreground">Notifications</h3>
                <Button variant="ghost" size="sm" className="h-auto p-0 text-[10px]" onClick={markAllRead}>
                  Mark all read
                </Button>
              </div>
              {notifications.length === 0 && (
                <p className="px-2 py-6 text-center text-[10px] text-muted-foreground">You're all caught up.</p>
              )}
              {notifications.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openNotification(item)}
                  className="grid w-full grid-cols-[7px_1fr] gap-2 border-t border-border py-2.5 text-left"
                >
                  <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full', !item.read_at ? 'bg-coral' : 'bg-transparent')} />
                  <div>
                    <strong className="block text-[9px] text-foreground">{item.title}</strong>
                    <p className="mb-0 mt-0.5 text-[8px] text-muted-foreground">{item.message}</p>
                    <small className="text-[7px] text-muted-foreground">{notificationRelativeTime(item.created_at)}</small>
                  </div>
                </button>
              ))}
              <Button
                variant="ghost"
                className="mt-1 w-full text-primary"
                size="sm"
                onClick={() => {
                  navigate('/settings')
                  setNotificationsOpen(false)
                }}
              >
                Notification settings
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={quickOpen} onOpenChange={setQuickOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus size={17} /> New <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[210px] rounded-lg p-2 shadow-elevated">
              <span className="block px-2 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                Quick actions
              </span>
              {quickActions.map(({ label, path, icon: Icon }) => (
                <Button
                  key={path}
                  variant="ghost"
                  className="w-full justify-start gap-2.5 text-muted-foreground"
                  onClick={() => {
                    navigate(path)
                    setQuickOpen(false)
                  }}
                >
                  <Icon size={17} />
                  {label}
                </Button>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  )
}
