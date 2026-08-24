'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Building2, ExternalLink, MapPin, Plus, Trash2 } from 'lucide-react'
import {
  APPLICATION_STAGES,
  createApplication,
  deleteApplication,
  getApplicationPipeline,
  updateApplicationStatus,
  type ApplicationStatus,
  type JobApplication,
  type Pipeline,
} from '@/lib/apiClient'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const PIPELINE_KEY = ['applications', 'pipeline'] as const

const STAGE_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
}

// Signal tokens, not chroma. The palette carries no per-stage hues, and
// inventing five would break the design system for decoration — progression
// is carried by column order, with colour reserved for the two stages that
// are genuinely outcomes.
const STAGE_MARKERS: Record<ApplicationStatus, string> = {
  saved: 'var(--color-ink-faint)',
  applied: 'var(--color-ink-dim)',
  interviewing: 'var(--color-accent)',
  offer: 'var(--color-signal-high)',
  rejected: 'var(--color-signal-low)',
}

const EMPTY_PIPELINE: Pipeline['pipeline'] = {
  saved: [],
  applied: [],
  interviewing: [],
  offer: [],
  rejected: [],
}

function ApplicationCard({
  application,
  onMove,
  onDelete,
  disabled,
}: {
  application: JobApplication
  onMove: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
  disabled: boolean
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="rounded-[12px] p-3.5"
      style={{
        background: 'var(--color-canvas-raise)',
        border: '1px solid var(--color-canvas-line)',
      }}
    >
      <h3 className="text-sm font-medium leading-snug text-[var(--color-ink)]">
        {application.job_title}
      </h3>

      <div className="mt-1.5 flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
          <Building2 strokeWidth={1.5} className="h-3 w-3 shrink-0" />
          <span className="truncate">{application.company}</span>
        </span>
        {application.location && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
            <MapPin strokeWidth={1.5} className="h-3 w-3 shrink-0" />
            <span className="truncate">{application.location}</span>
          </span>
        )}
      </div>

      {application.salary_range && (
        <p className="mt-1.5 font-mono text-[11px] text-[var(--color-ink-faint)]">
          {application.salary_range}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-canvas-line)] pt-2.5">
        <label className="sr-only" htmlFor={`stage-${application.id}`}>
          Move {application.job_title} to another stage
        </label>
        <select
          id={`stage-${application.id}`}
          value={application.status}
          disabled={disabled}
          onChange={(event) => onMove(application.id, event.target.value as ApplicationStatus)}
          className="flex-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--color-ink-subtle)] transition-colors disabled:opacity-50"
          style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-canvas-line)' }}
        >
          {APPLICATION_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>

        {application.job_url && (
          <a
            href={application.job_url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open the ${application.job_title} posting`}
            className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-accent)]"
          >
            <ExternalLink strokeWidth={1.5} className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => onDelete(application.id)}
          disabled={disabled}
          aria-label={`Remove ${application.job_title}`}
          className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-signal-low)] disabled:opacity-50"
        >
          <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  )
}

export default function ApplicationsPage() {
  const queryClient = useQueryClient()
  const reduceMotion = usePrefersReducedMotion()
  const [showAdd, setShowAdd] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftCompany, setDraftCompany] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: PIPELINE_KEY,
    queryFn: getApplicationPipeline,
  })

  const pipeline = data?.pipeline ?? EMPTY_PIPELINE

  /**
   * Optimistic move with rollback.
   *
   * The card jumps columns before the request resolves, but the previous
   * pipeline is snapshotted first and restored in onError — without that, a
   * failed request leaves the board showing a move that never persisted, and
   * the user only finds out on refresh.
   */
  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: ApplicationStatus }) =>
      updateApplicationStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: PIPELINE_KEY })
      const previous = queryClient.getQueryData<Pipeline>(PIPELINE_KEY)

      queryClient.setQueryData<Pipeline>(PIPELINE_KEY, (current) => {
        if (!current) return current
        const next = { ...current.pipeline }
        let moved: JobApplication | undefined

        for (const stage of APPLICATION_STAGES) {
          const found = next[stage].find((a) => a.id === id)
          if (found) {
            moved = { ...found, status }
            next[stage] = next[stage].filter((a) => a.id !== id)
          }
        }
        if (moved) next[status] = [moved, ...next[status]]
        return { ...current, pipeline: next }
      })

      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(PIPELINE_KEY, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PIPELINE_KEY }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteApplication,
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: PIPELINE_KEY })
      const previous = queryClient.getQueryData<Pipeline>(PIPELINE_KEY)
      queryClient.setQueryData<Pipeline>(PIPELINE_KEY, (current) => {
        if (!current) return current
        const next = { ...current.pipeline }
        for (const stage of APPLICATION_STAGES) {
          next[stage] = next[stage].filter((a) => a.id !== id)
        }
        return { ...current, pipeline: next, total: Math.max(0, current.total - 1) }
      })
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(PIPELINE_KEY, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PIPELINE_KEY }),
  })

  const addMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      setDraftTitle('')
      setDraftCompany('')
      setShowAdd(false)
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
    },
  })

  const busy = moveMutation.isPending || deleteMutation.isPending

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow mb-2 inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            Application Pipeline
          </span>
          <h1 className="mt-2 font-display text-2xl font-medium italic text-[var(--color-ink)] md:text-3xl">
            Every role, one board.
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-dim)]">
            {data ? `${data.total} application${data.total === 1 ? '' : 's'} tracked.` : 'Loading…'}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus strokeWidth={1.5} />
          Add application
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {showAdd && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onSubmit={(event) => {
              event.preventDefault()
              if (!draftTitle.trim() || !draftCompany.trim()) return
              addMutation.mutate({
                job_title: draftTitle.trim(),
                company: draftCompany.trim(),
              })
            }}
            className="overflow-hidden"
          >
            <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row">
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Role title"
                aria-label="Role title"
                className="flex-1"
              />
              <Input
                value={draftCompany}
                onChange={(event) => setDraftCompany(event.target.value)}
                placeholder="Company"
                aria-label="Company"
                className="flex-1"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!draftTitle.trim() || !draftCompany.trim() || addMutation.isPending}
              >
                {addMutation.isPending ? 'Adding…' : 'Add to Saved'}
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {isError && (
        <div className="card p-6">
          <p className="text-sm text-[var(--color-ink-dim)]">
            Could not load your pipeline. Check that the API is running and try again.
          </p>
        </div>
      )}

      {!isError && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {APPLICATION_STAGES.map((stage) => {
            const cards = pipeline[stage] ?? []
            return (
              <section
                key={stage}
                aria-label={STAGE_LABELS[stage]}
                className="flex min-h-[400px] flex-col rounded-[16px] p-3"
                style={{
                  background: 'var(--color-canvas)',
                  border: '1px solid var(--color-canvas-line)',
                }}
              >
                <div className="mb-3 flex items-center justify-between border-b border-[var(--color-canvas-line)] px-1 pb-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium text-[var(--color-ink)]">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: STAGE_MARKERS[stage] }}
                      aria-hidden="true"
                    />
                    {STAGE_LABELS[stage]}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                    {isLoading ? '—' : cards.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2.5">
                  {isLoading ? (
                    // Same box as a real card, so nothing shifts on load.
                    <>
                      <Skeleton className="h-[124px]" />
                      <Skeleton className="h-[124px]" />
                    </>
                  ) : cards.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                      Nothing here yet.
                    </p>
                  ) : (
                    <AnimatePresence initial={false} mode="popLayout">
                      {cards.map((application) => (
                        <ApplicationCard
                          key={application.id}
                          application={application}
                          onMove={(id, status) => moveMutation.mutate({ id, status })}
                          onDelete={(id) => deleteMutation.mutate(id)}
                          disabled={busy}
                        />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <p className="mt-5 text-xs text-[var(--color-ink-faint)]">
        Save roles straight from the{' '}
        <Link href="/jobs" className="text-[var(--color-accent)] hover:underline">
          job market
        </Link>
        .
      </p>
    </div>
  )
}
