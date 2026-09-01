'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { getApplicationActivity, type ApplicationActivityItem } from '@/lib/apiClient'
import { STAGE_LABELS, STAGE_MARKERS } from '@/lib/applicationStages'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineError } from '@/components/resume/InlineError'

function relativeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ActivityRow({ item, onOpen }: { item: ApplicationActivityItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left transition-colors hover:bg-(--color-canvas-raise)"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: STAGE_MARKERS[item.to_status] }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-(--color-ink)">
          <span className="font-medium">{item.job_title}</span>{' '}
          <span className="text-(--color-ink-faint)">· {item.company}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-ink-dim)">
          {item.from_status ? (
            <>
              {STAGE_LABELS[item.from_status]}
              <ArrowRight strokeWidth={1.5} className="h-3 w-3 shrink-0" />
              {STAGE_LABELS[item.to_status]}
            </>
          ) : (
            <>Added as {STAGE_LABELS[item.to_status]}</>
          )}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-(--color-ink-faint)">
        {relativeLabel(item.changed_at)}
      </span>
    </button>
  )
}

export function TimelineView({ onOpen }: { onOpen: (applicationId: number) => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['applications', 'activity'],
    queryFn: getApplicationActivity,
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="card p-6">
        <InlineError message="Could not load activity. Check that the API is running and try again." />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-(--color-ink-faint)">
          No activity yet — move a card or add an application to see it here.
        </p>
      </div>
    )
  }

  return (
    <div className="card flex flex-col divide-y divide-(--color-canvas-line) p-1.5">
      {data.map((item, index) => (
        <ActivityRow key={`${item.application_id}-${item.changed_at}-${index}`} item={item} onOpen={() => onOpen(item.application_id)} />
      ))}
    </div>
  )
}
