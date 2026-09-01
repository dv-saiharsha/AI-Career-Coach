'use client'

import { useState } from 'react'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import type { CoachConversation } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Reveal } from '@/lib/reveal'

function relativeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

interface ConversationSidebarProps {
  conversations: CoachConversation[]
  loading: boolean
  activeId: number | null
  onSelect: (id: number | null) => void
  onDelete: (id: number) => void
  deletingId: number | null
}

export function ConversationSidebar({
  conversations,
  loading,
  activeId,
  onSelect,
  onDelete,
  deletingId,
}: ConversationSidebarProps) {
  const [confirmId, setConfirmId] = useState<number | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button type="button" onClick={() => onSelect(null)} className="w-full justify-center gap-2">
          <MessageSquarePlus strokeWidth={1.5} className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && (
          <div className="flex flex-col gap-2 px-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-(--color-ink-faint)">
            No conversations yet. Ask the coach anything about your resume, interviews, or job search.
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {conversations.map((c) => {
            const active = c.id === activeId
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className="w-full rounded-sm px-3 py-2.5 text-left transition-colors"
                  style={{ background: active ? 'var(--color-accent-tint)' : 'transparent' }}
                >
                  <p
                    className="truncate text-sm font-medium pr-6"
                    style={{ color: active ? 'var(--color-accent)' : 'var(--color-ink)' }}
                  >
                    {c.title || 'New conversation'}
                  </p>
                  <p className="mt-0.5 text-[10px] font-mono text-(--color-ink-faint)">
                    {relativeLabel(c.updated_at)}
                  </p>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={confirmId === c.id ? 'Confirm delete conversation' : 'Delete conversation'}
                  disabled={deletingId === c.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmId === c.id) {
                      onDelete(c.id)
                      setConfirmId(null)
                    } else {
                      setConfirmId(c.id)
                    }
                  }}
                  onBlur={() => setConfirmId((id) => (id === c.id ? null : id))}
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  {confirmId === c.id ? (
                    <Reveal as="span" className="text-[10px] font-mono text-(--color-error)">
                      Sure?
                    </Reveal>
                  ) : (
                    <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5 text-(--color-ink-faint)" />
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
