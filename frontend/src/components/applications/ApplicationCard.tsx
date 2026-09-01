'use client'

import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Building2, GripVertical, MapPin, Trash2 } from 'lucide-react'
import { APPLICATION_STAGES, type ApplicationStatus, type JobApplication } from '@/lib/apiClient'
import { STAGE_LABELS } from '@/lib/applicationStages'

interface ApplicationCardProps {
  application: JobApplication
  onOpen: () => void
  onMove: (status: ApplicationStatus) => void
  onDelete: () => void
  disabled: boolean
  /** True only for the ghost rendered inside DragOverlay — no drag wiring,
   *  no interactive controls, just the visual. */
  overlay?: boolean
}

export function ApplicationCard({ application, onOpen, onMove, onDelete, disabled, overlay }: ApplicationCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    disabled: overlay || disabled,
  })

  const style = transform && !overlay ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
     
     
     
     
     
      className={cn('rounded-md p-3.5 panel-enter', isDragging && 'opacity-60 scale-[0.98]')}
      style={{
        ...style,
        background: 'var(--color-canvas-raise)',
        border: overlay ? '1px solid var(--color-accent)' : '1px solid var(--color-canvas-line)',
        boxShadow: overlay ? 'var(--shadow-raised)' : undefined,
        cursor: overlay ? 'grabbing' : undefined,
      }}
    >
      <div className="flex items-start gap-1.5">
        {!overlay && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${application.job_title} to another stage`}
            className="mt-0.5 shrink-0 cursor-grab touch-none text-(--color-ink-faint) transition-colors hover:text-(--color-ink-dim) active:cursor-grabbing"
          >
            <GripVertical strokeWidth={1.5} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="truncate text-sm font-medium leading-snug text-(--color-ink) hover:underline">
            {application.job_title}
          </h3>
        </button>
      </div>

      <div className="mt-1.5 flex flex-col gap-1 pl-5">
        <span className="flex items-center gap-1.5 text-xs text-(--color-ink-dim)">
          <Building2 strokeWidth={1.5} className="h-3 w-3 shrink-0" />
          <span className="truncate">{application.company}</span>
        </span>
        {application.location && (
          <span className="flex items-center gap-1.5 text-xs text-(--color-ink-faint)">
            <MapPin strokeWidth={1.5} className="h-3 w-3 shrink-0" />
            <span className="truncate">{application.location}</span>
          </span>
        )}
      </div>

      {application.salary_range && (
        <p className="mt-1.5 pl-5 font-mono text-[11px] text-(--color-ink-faint)">
          {application.salary_range}
        </p>
      )}

      {!overlay && (
        <div className="mt-3 flex items-center gap-2 border-t border-(--color-canvas-line) pt-2.5">
          <label className="sr-only" htmlFor={`stage-${application.id}`}>
            Move {application.job_title} to another stage
          </label>
          <select
            id={`stage-${application.id}`}
            value={application.status}
            disabled={disabled}
            onChange={(event) => onMove(event.target.value as ApplicationStatus)}
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-medium text-(--color-ink-subtle) transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-canvas-line)' }}
          >
            {APPLICATION_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
            disabled={disabled}
            aria-label={confirmDelete ? `Confirm removing ${application.job_title}` : `Remove ${application.job_title}`}
            className="shrink-0 text-(--color-ink-faint) transition-colors hover:text-(--color-signal-low) disabled:opacity-50"
          >
            {confirmDelete ? (
              <span className="font-mono text-[10px] text-(--color-signal-low)">Sure?</span>
            ) : (
              <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
