'use client'

import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { APPLICATION_STAGES, type ApplicationStatus, type JobApplication, type Pipeline } from '@/lib/apiClient'
import { STAGE_GROUPS, stageForDrop, type StageGroup } from '@/lib/applicationStages'
import { ApplicationCard } from '@/components/applications/ApplicationCard'
import { Skeleton } from '@/components/ui/skeleton'

// A plain click never moves more than a pixel or two, so this is what
// separates "clicked the card / a control inside it" from "started a real
// drag" — without it, dnd-kit's pointer sensor would swallow every click.
const ACTIVATION_DISTANCE = 8

interface KanbanBoardProps {
  pipeline: Pipeline['pipeline']
  isLoading: boolean
  onMove: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
  onOpen: (application: JobApplication) => void
  busy: boolean
}

function KanbanColumn({
  group,
  cards,
  isLoading,
  onOpen,
  onMove,
  onDelete,
  busy,
}: {
  group: StageGroup
  cards: JobApplication[]
  isLoading: boolean
  onOpen: (application: JobApplication) => void
  onMove: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
  busy: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id })

  return (
    <section
      ref={setNodeRef}
      aria-label={group.label}
      className="flex min-h-[420px] w-[280px] shrink-0 flex-col rounded-lg p-3 transition-colors lg:w-auto lg:shrink"
      style={{
        background: isOver ? 'var(--color-accent-tint)' : 'var(--color-canvas)',
        border: isOver ? '1px dashed var(--color-accent)' : '1px solid var(--color-canvas-line)',
      }}
    >
      <div className="mb-3 flex items-center justify-between border-b border-(--color-canvas-line) px-1 pb-2.5">
        <span className="flex items-center gap-2 text-xs font-medium text-(--color-ink)">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: group.marker }} aria-hidden="true" />
          {group.label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-(--color-ink-faint)">
          {isLoading ? '—' : cards.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5">
        {isLoading ? (
          <>
            <Skeleton className="h-[124px]" />
            <Skeleton className="h-[124px]" />
          </>
        ) : cards.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-(--color-ink-faint)">Nothing here yet.</p>
        ) : (
          <>
            {cards.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                onOpen={() => onOpen(application)}
                onMove={(status) => onMove(application.id, status)}
                onDelete={() => onDelete(application.id)}
                disabled={busy}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

export function KanbanBoard({ pipeline, isLoading, onMove, onDelete, onOpen, busy }: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<JobApplication | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: ACTIVATION_DISTANCE } }))

  const allCards = useMemo(
    () => APPLICATION_STAGES.flatMap((stage) => pipeline[stage] ?? []),
    [pipeline],
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCard(allCards.find((application) => application.id === event.active.id) ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCard(null)
    const groupId = event.over?.id as StageGroup['id'] | undefined
    if (!groupId) return
    const application = allCards.find((a) => a.id === event.active.id)
    if (!application) return

    /* The column is a group; the backend takes one of the twelve stages. A
       card dropped on the column it already lives in keeps its precise
       stage, so a nudge never demotes Final Interview to Recruiter
       Screening. */
    const next = stageForDrop(groupId, application.status)
    if (next !== application.status) onMove(application.id, next)
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveCard(null)}>
      {/* Four columns fit a desktop, so they share the width rather than
          scrolling. Below lg they stay a horizontal rail — four 280px columns
          will not fit a phone, and squeezing them would make every card
          unreadable rather than the row scrollable. */}
      <div className="flex gap-4 overflow-x-auto pb-4 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {STAGE_GROUPS.map((group) => (
          <KanbanColumn
            key={group.id}
            group={group}
            cards={group.members.flatMap((stage) => pipeline[stage] ?? [])}
            isLoading={isLoading}
            onOpen={onOpen}
            onMove={onMove}
            onDelete={onDelete}
            busy={busy}
          />
        ))}
      </div>
      <DragOverlay>
        {activeCard && (
          <ApplicationCard
            application={activeCard}
            onOpen={() => {}}
            onMove={() => {}}
            onDelete={() => {}}
            disabled
            overlay
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
