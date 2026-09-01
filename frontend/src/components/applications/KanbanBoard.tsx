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
import { STAGE_LABELS, STAGE_MARKERS } from '@/lib/applicationStages'
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
  stage,
  cards,
  isLoading,
  onOpen,
  onMove,
  onDelete,
  busy,
}: {
  stage: ApplicationStatus
  cards: JobApplication[]
  isLoading: boolean
  onOpen: (application: JobApplication) => void
  onMove: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
  busy: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <section
      ref={setNodeRef}
      aria-label={STAGE_LABELS[stage]}
      className="flex min-h-[420px] w-[280px] shrink-0 flex-col rounded-lg p-3 transition-colors"
      style={{
        background: isOver ? 'var(--color-accent-tint)' : 'var(--color-canvas)',
        border: isOver ? '1px dashed var(--color-accent)' : '1px solid var(--color-canvas-line)',
      }}
    >
      <div className="mb-3 flex items-center justify-between border-b border-(--color-canvas-line) px-1 pb-2.5">
        <span className="flex items-center gap-2 text-xs font-medium text-(--color-ink)">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_MARKERS[stage] }} aria-hidden="true" />
          {STAGE_LABELS[stage]}
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
    const overStage = event.over?.id as ApplicationStatus | undefined
    if (!overStage) return
    const application = allCards.find((a) => a.id === event.active.id)
    if (application && application.status !== overStage) onMove(application.id, overStage)
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveCard(null)}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {APPLICATION_STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            cards={pipeline[stage] ?? []}
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
