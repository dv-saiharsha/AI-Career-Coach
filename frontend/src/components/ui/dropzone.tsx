'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface DropzoneProps {
  /** Called with the accepted file. Rejections are reported through `error`. */
  onFile: (file: File) => void
  /** Extensions, lowercase, with the dot. */
  accept?: readonly string[]
  maxBytes?: number
  disabled?: boolean
  /** Server-side or caller-owned error, rendered below the zone. */
  error?: string | null
  className?: string
  children?: React.ReactNode
  id?: string
}

const DEFAULT_ACCEPT = ['.pdf', '.docx'] as const
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

function formatMb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

/**
 * The recessed well a file is dropped into. Inset at rest, inset deeper
 * while a file is over it — a dropzone is a hole in the surface, so it never
 * extrudes.
 *
 * Everything here works from the keyboard: the whole zone is a label bound
 * to a visually-hidden file input, so Tab reaches it and Enter or Space
 * opens the picker without any key handling of our own.
 */
export function Dropzone({
  onFile,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  disabled = false,
  error,
  className,
  children,
  id,
}: DropzoneProps) {
  const inputId = React.useId()
  const fieldId = id ?? inputId
  const errorId = `${fieldId}-error`

  const [over, setOver] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)

  /* Depth counter, not a boolean: dragging across a child element fires
     dragleave on the parent, and a boolean would flicker the state off on
     every internal boundary crossed. */
  const depth = React.useRef(0)

  const message = error ?? localError

  const validate = React.useCallback(
    (file: File) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
      if (!accept.includes(ext)) {
        return `That is a ${ext.replace('.', '').toUpperCase() || 'file'} file. Please upload ${accept
          .map((a) => a.replace('.', '').toUpperCase())
          .join(' or ')}.`
      }
      if (file.size > maxBytes) {
        return `That file is ${formatMb(file.size)}. The limit is ${formatMb(maxBytes)}.`
      }
      return null
    },
    [accept, maxBytes]
  )

  const handle = React.useCallback(
    (file: File | undefined) => {
      if (!file) return
      const problem = validate(file)
      setLocalError(problem)
      if (!problem) onFile(file)
    },
    [onFile, validate]
  )

  return (
    <div className={cn('w-full', className)}>
      <label
        htmlFor={fieldId}
        aria-describedby={message ? errorId : undefined}
        onDragEnter={(e) => {
          e.preventDefault()
          if (disabled) return
          depth.current += 1
          setOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          depth.current = 0
          setOver(false)
          if (disabled) return
          handle(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'flex min-h-56 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl px-6 py-10 text-center',
          'bg-canvas transition-[box-shadow] duration-200 ease-(--ease-enter)',
          over ? 'shadow-(--neu-inset)' : 'shadow-(--neu-inset-sm)',
          disabled && 'cursor-not-allowed opacity-60',
          /* The ring goes on the label, since the real input is hidden. */
          'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-offset-3'
        )}
      >
        {children}
        <input
          id={fieldId}
          type="file"
          accept={accept.join(',')}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            handle(e.target.files?.[0])
            /* Reset so re-selecting the same file after an error still
               fires a change event. */
            e.target.value = ''
          }}
        />
      </label>

      {message && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  )
}
