'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KanbanSquare, List, Plus, TrendingUp } from 'lucide-react'
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
import { KanbanBoard } from '@/components/applications/KanbanBoard'
import { ListView } from '@/components/applications/ListView'
import { TimelineView } from '@/components/applications/TimelineView'
import { ApplicationDetailDrawer } from '@/components/applications/ApplicationDetailDrawer'
import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PIPELINE_KEY = ['applications', 'pipeline'] as const

const EMPTY_PIPELINE: Pipeline['pipeline'] = APPLICATION_STAGES.reduce(
  (acc, stage) => {
    acc[stage] = []
    return acc
  },
  {} as Pipeline['pipeline'],
)

type ViewMode = 'kanban' | 'list' | 'timeline'

const VIEW_TABS: { value: ViewMode; label: string; icon: typeof KanbanSquare }[] = [
  { value: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { value: 'list', label: 'List', icon: List },
  { value: 'timeline', label: 'Timeline', icon: TrendingUp },
]

export default function ApplicationsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
    const [view, setView] = useState<ViewMode>('kanban')
  const [showAdd, setShowAdd] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftCompany, setDraftCompany] = useState('')
  const [openApplicationId, setOpenApplicationId] = useState<number | null>(null)

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
      // Without this the card silently slides back to its old column and the
      // user is left guessing whether the move saved.
      toast({
        title: "Couldn't move that application",
        description: 'The card has been put back. Check your connection and try again.',
        variant: 'error',
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
      queryClient.invalidateQueries({ queryKey: ['applications', 'activity'] })
    },
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
      toast({
        title: "Couldn't delete that application",
        description: 'It has been restored to your pipeline.',
        variant: 'error',
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
      queryClient.invalidateQueries({ queryKey: ['applications', 'activity'] })
    },
  })

  const addMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: (created) => {
      setDraftTitle('')
      setDraftCompany('')
      setShowAdd(false)
      toast({
        title: 'Application added',
        description: `${created.job_title} at ${created.company} is now in Saved.`,
      })
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
      queryClient.invalidateQueries({ queryKey: ['applications', 'activity'] })
    },
    onError: () =>
      toast({
        title: "Couldn't add that application",
        description: 'Nothing was saved. Check your connection and try again.',
        variant: 'error',
      }),
  })

  const busy = moveMutation.isPending || deleteMutation.isPending

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        eyebrow="Application Pipeline"
        title="Every role, one workspace."
        description={
          data ? `${data.total} application${data.total === 1 ? '' : 's'} tracked.` : 'Loading…'
        }
        action={
          <Button type="button" size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus strokeWidth={1.5} />
            Add application
          </Button>
        }
      />

      <div className="relative mb-5 inline-flex rounded-[6px] border border-(--color-canvas-line) p-1">
        {VIEW_TABS.map(({ value, label, icon: Icon }) => {
          const active = view === value
          return (
            <Button
              key={value}
              type="button"
              variant="ghost"
              aria-pressed={active}
              onClick={() => setView(value)}
              className="relative h-auto gap-1.5 rounded-[4px] px-3.5 py-1.5 text-sm font-medium hover:bg-transparent"
            >
              {active && (
                <span
                 
                  className="absolute inset-0 rounded-[4px] bg-(--color-canvas-raise) border border-(--color-canvas-line) panel-enter"
                  />
              )}
              <span className={`relative z-10 flex items-center gap-1.5 ${active ? 'text-(--color-ink)' : 'text-(--color-ink-faint) hover:text-(--color-ink-dim)'}`}>
                <Icon strokeWidth={1.5} className="h-3.5 w-3.5" />
                {label}
              </span>
            </Button>
          )
        })}
      </div>

        {showAdd && (
          <form
           
           
           
           
            onSubmit={(event) => {
              event.preventDefault()
              if (!draftTitle.trim() || !draftCompany.trim()) return
              addMutation.mutate({
                job_title: draftTitle.trim(),
                company: draftCompany.trim(),
              })
            }}
            className="overflow-hidden panel-enter"
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
          </form>
        )}

      {isError && (
        <div className="card p-6">
          <p className="text-sm text-(--color-ink-dim)">
            Could not load your pipeline. Check that the API is running and try again.
          </p>
        </div>
      )}

      {!isError && view === 'kanban' && (
        <KanbanBoard
          pipeline={pipeline}
          isLoading={isLoading}
          onMove={(id, status) => moveMutation.mutate({ id, status })}
          onDelete={(id) => deleteMutation.mutate(id)}
          onOpen={(application) => setOpenApplicationId(application.id)}
          busy={busy}
        />
      )}

      {!isError && view === 'list' && (
        <ListView pipeline={pipeline} isLoading={isLoading} onOpen={(application) => setOpenApplicationId(application.id)} />
      )}

      {!isError && view === 'timeline' && <TimelineView onOpen={(id) => setOpenApplicationId(id)} />}

      <ApplicationDetailDrawer applicationId={openApplicationId} onClose={() => setOpenApplicationId(null)} />
    </div>
  )
}
