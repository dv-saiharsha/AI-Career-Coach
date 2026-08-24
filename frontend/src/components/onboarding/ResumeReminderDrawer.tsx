'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Sparkles, Upload, X } from 'lucide-react'
import { springSoft } from '@/lib/motion'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED = ['.pdf', '.docx']

interface ResumeReminderDrawerProps {
  isOpen: boolean
  onDismiss: () => void
  onUpload: (file: File) => Promise<void>
  error?: string | null
}

/**
 * Follow-up for users who skipped resume upload during onboarding.
 *
 * Deliberately not a modal: onboarding already interrupted them once, and the
 * whole point of making the resume optional is that missing it shouldn't block
 * the product. This slides in from the right, leaves the dashboard usable
 * underneath, and has no backdrop to trap clicks.
 */
export function ResumeReminderDrawer({ isOpen, onDismiss, onUpload, error }: ResumeReminderDrawerProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  function pickFile(picked: File | null) {
    setFileError(null)
    if (!picked) {
      setFile(null)
      return
    }
    // Same validation as the onboarding modal — the accept attribute only
    // filters the picker dialog and is bypassed by drag-and-drop.
    const name = picked.name.toLowerCase()
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setFileError('Upload a PDF or DOCX file.')
      return
    }
    if (picked.size > MAX_FILE_BYTES) {
      setFileError('That file is over 10MB. Try a smaller export.')
      return
    }
    setFile(picked)
  }

  async function handleUpload() {
    if (!file || isUploading) return
    setIsUploading(true)
    try {
      await onUpload(file)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={springSoft}
          role="complementary"
          aria-label="Add your resume"
          className="fixed right-0 top-0 z-40 flex h-full w-full max-w-sm flex-col justify-between border-l border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)] p-6 shadow-[var(--shadow-pop)]"
        >
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <span className="eyebrow inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={1.5} />
                Finish your profile
              </span>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div>
              <h3 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">Add your resume</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-dim)]">
                You skipped this during setup. Adding it turns on ATS match scores against your target
                roles, and lets interview prep draw on your actual experience.
              </p>
            </div>

            <label
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 transition-colors ${
                file
                  ? 'border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5'
                  : 'border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] hover:border-[var(--color-line-strong)]'
              }`}
            >
              {file ? (
                <FileText className="mb-2 h-7 w-7 text-[var(--color-ok)]" strokeWidth={1.5} />
              ) : (
                <Upload className="mb-2 h-7 w-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
              )}
              <span className="text-center text-sm font-medium text-[var(--color-ink)]">
                {file ? file.name : 'Drop your resume, or click to browse'}
              </span>
              <span className="mt-1 text-xs text-[var(--color-ink-faint)]">PDF or DOCX, up to 10MB</span>
              <input
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {(fileError || error) && (
              <p className="text-xs font-medium text-[var(--color-danger)]">{fileError ?? error}</p>
            )}
          </div>

          <div className="space-y-2 border-t border-[var(--color-canvas-line)] pt-4">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || isUploading}
              className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isUploading ? 'Scoring your resume…' : 'Upload and score'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full py-2 text-xs font-medium text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
              Not right now
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
