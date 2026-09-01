'use client'

import Link from 'next/link'
import { Bell, Check, X } from 'lucide-react'
import type { AppNotification, NotificationPriority } from '@/lib/apiClient'
import { useNotifications } from '@/hooks/useNotifications'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineError } from '@/components/resume/InlineError'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const PRIORITY_DOT: Record<NotificationPriority, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-ink-faint',
}

const CATEGORY_LABEL: Record<AppNotification['category'], string> = {
  resume: 'Resume',
  jobs: 'Jobs',
  interview: 'Interview',
  application: 'Application',
  career_coach: 'Career Coach',
  analytics: 'Analytics',
}

// Module-level so the linter can see wall-clock reads never happen during
// render — see VoiceAnswerComposer.tsx / ConversationSidebar.tsx for the
// same isolation pattern.
function relativeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function NotificationRow({
  notification,
  onRead,
  onArchive,
}: {
  notification: AppNotification
  onRead: (id: number) => void
  onArchive: (id: number) => void
}) {
  const unread = !notification.read_at

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', PRIORITY_DOT[notification.priority])}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm', unread ? 'font-medium text-ink' : 'text-ink-dim')}>
            {notification.title}
          </p>
          {notification.occurrence_count > 1 && (
            <Badge variant="muted" size="sm" className="shrink-0">
              +{notification.occurrence_count - 1} more
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink-dim">{notification.message}</p>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          <span>{CATEGORY_LABEL[notification.category]}</span>
          <span aria-hidden="true">·</span>
          <span>{relativeLabel(notification.created_at)}</span>
        </div>
      </div>
    </>
  )

  return (
    <li
      role="listitem"
      className="group relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-canvas-elevated"
    >
      {notification.href ? (
        <Link
          href={notification.href}
          onClick={() => unread && onRead(notification.id)}
          className="flex flex-1 items-start gap-3 outline-none"
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => unread && onRead(notification.id)}
          className="flex flex-1 items-start gap-3 text-left outline-none"
        >
          {body}
        </button>
      )}

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {unread && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 touch-target"
            aria-label="Mark as read"
            onClick={() => onRead(notification.id)}
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 touch-target"
          aria-label="Archive notification"
          onClick={() => onArchive(notification.id)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

export function NotificationBell() {
  const { notifications, unreadCount, isLoading, isError, markRead, markAllRead, archive } =
    useNotifications()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          /* The badge itself is aria-hidden (it truncates to "9+"), so the
             count has to reach a screen reader through the label or it is
             conveyed by sight only. */
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, none unread'
          }
        >
          <Bell />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-medium text-on-accent"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-canvas-line px-4 py-3">
          <p className="font-display text-base tracking-[-0.01em] text-ink">Notifications</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllRead()}
              className="text-xs font-medium text-ink-dim outline-none transition-colors hover:text-ink focus-visible:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[26rem] overflow-y-auto p-2">
          {isLoading && (
            <div className="space-y-2 p-2">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          )}

          {isError && (
            <div className="p-3">
              <InlineError message="Could not load notifications." />
            </div>
          )}

          {!isLoading && !isError && notifications.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-dim">
              You&apos;re all caught up.
            </p>
          )}

          {!isLoading && !isError && notifications.length > 0 && (
            <ul role="list" className="space-y-0.5">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onRead={markRead}
                  onArchive={archive}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
