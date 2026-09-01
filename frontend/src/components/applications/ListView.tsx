'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react'
import { APPLICATION_STAGES, type ApplicationStatus, type JobApplication, type Pipeline } from '@/lib/apiClient'
import { STAGE_LABELS, STAGE_MARKERS } from '@/lib/applicationStages'
import { Skeleton } from '@/components/ui/skeleton'

type SortKey = 'company' | 'job_title' | 'status' | 'applied_at' | 'match_score'
type SortDirection = 'asc' | 'desc'

const STATUS_ORDER: Record<ApplicationStatus, number> = Object.fromEntries(
  APPLICATION_STAGES.map((stage, index) => [stage, index]),
) as Record<ApplicationStatus, number>

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Role' },
  { key: 'status', label: 'Stage' },
  { key: 'applied_at', label: 'Applied' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ListViewProps {
  pipeline: Pipeline['pipeline']
  isLoading: boolean
  onOpen: (application: JobApplication) => void
}

export function ListView({ pipeline, isLoading, onOpen }: ListViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('applied_at')
  const [direction, setDirection] = useState<SortDirection>('desc')

  const rows = useMemo(() => APPLICATION_STAGES.flatMap((stage) => pipeline[stage] ?? []), [pipeline])

  const sorted = useMemo(() => {
    const copy = [...rows]
    const factor = direction === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'company':
          return factor * a.company.localeCompare(b.company)
        case 'job_title':
          return factor * a.job_title.localeCompare(b.job_title)
        case 'status':
          return factor * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
        case 'applied_at':
          return factor * ((a.applied_at ?? '').localeCompare(b.applied_at ?? ''))
        default:
          return 0
      }
    })
    return copy
  }, [rows, sortKey, direction])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setDirection('desc')
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-(--color-ink-faint)">No applications tracked yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-(--color-canvas-line)">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-(--color-canvas-line)">
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-4 py-3 text-left">
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint) transition-colors hover:text-(--color-ink-dim)"
                >
                  {col.label}
                  {sortKey === col.key ? (
                    direction === 'asc' ? (
                      <ArrowUp strokeWidth={1.5} className="h-3 w-3" />
                    ) : (
                      <ArrowDown strokeWidth={1.5} className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown strokeWidth={1.5} className="h-3 w-3 opacity-30" />
                  )}
                </button>
              </th>
            ))}
            <th className="px-4 py-3 text-left">
              <span className="font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint)">
                Match
              </span>
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((application) => (
            <tr
              key={application.id}
              onClick={() => onOpen(application)}
              className="cursor-pointer border-b border-(--color-canvas-line) transition-colors last:border-0 hover:bg-(--color-canvas-raise)"
            >
              <td className="px-4 py-3 text-(--color-ink-dim)">{application.company}</td>
              <td className="px-4 py-3 font-medium text-(--color-ink)">{application.job_title}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-(--color-ink-dim)">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: STAGE_MARKERS[application.status] }}
                    aria-hidden="true"
                  />
                  {STAGE_LABELS[application.status]}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-(--color-ink-faint)">
                {formatDate(application.applied_at)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-(--color-ink-faint)">
                {application.match_score != null ? `${Math.round(application.match_score)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {application.job_url && (
                  <a
                    href={application.job_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Open the ${application.job_title} posting`}
                    className="text-(--color-ink-faint) transition-colors hover:text-(--color-accent)"
                  >
                    <ExternalLink strokeWidth={1.5} className="h-3.5 w-3.5" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
