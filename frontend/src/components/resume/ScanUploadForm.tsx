'use client'

import { type DragEvent, type FormEvent, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { InlineError } from './InlineError'
import { SCAN_EASE } from './scanShared'

interface ScanUploadFormProps {
  file: File | null
  jobDescription: string
  /** The form renders for idle and error alike; only the banner differs. */
  hasError: boolean
  error: string
  dragOver: boolean
  pasteNotice: string | null
  jobContextNotice: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onPickFile: (file: File | null) => void
  onRemoveFile: () => void
  onJobDescriptionChange: (value: string) => void
  onJobDescriptionPaste: () => void
  onDismissJobContextNotice: () => void
  onSubmit: (e: FormEvent) => void
}

/**
 * Upload + job-description entry — the idle/error state of the scan flow.
 *
 * Kept as a pure presentational split from ResumeAnalyzer: every handler is
 * still owned by the page (file picking, drag state, submit) so this
 * component carries no logic of its own to keep in sync.
 */
export function ScanUploadForm({
  file,
  jobDescription,
  hasError,
  error,
  dragOver,
  pasteNotice,
  jobContextNotice,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickFile,
  onRemoveFile,
  onJobDescriptionChange,
  onJobDescriptionPaste,
  onDismissJobContextNotice,
  onSubmit,
}: ScanUploadFormProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: SCAN_EASE }}
    >
      <div className="mb-8">
        <span className="eyebrow mb-3 inline-flex">
          <span className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
          Resume Analyzer
        </span>
        <h1 className="text-2xl md:text-3xl font-display italic font-medium text-(--color-ink) mt-3 mb-2">See what the scanner sees.</h1>
        <p className="text-sm text-(--color-ink-dim) leading-relaxed max-w-xl">
          Drop in your resume and the job description — we&apos;ll decode exactly what the ATS
          is scanning for, what&apos;s missing, and how to close the gap.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-5">
          <div>
            <span id="resumeDropzoneLabel" className="eyebrow mb-2 block">
              Resume (PDF or DOCX)
            </span>
            <div
              onDragOver={(e) => { e.preventDefault(); onDragOver() }}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-labelledby="resumeDropzoneLabel"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  // Without this, Space activates *and* scrolls the page.
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              className="cursor-pointer rounded-lg px-6 py-8 text-center transition-colors"
              style={{
                border: dragOver
                  ? '1px solid var(--color-accent)'
                  : `1px dashed var(--color-canvas-line)`,
                background: dragOver ? 'var(--color-accent-tint)' : 'transparent',
                boxShadow: dragOver ? 'var(--glow-signal)' : 'none',
              }}
            >
              {/* Visually hidden — the styled dropzone above is the
                  real affordance; this is what it delegates to. */}
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-(--color-accent-tint) flex items-center justify-center shrink-0">
                    <FileText strokeWidth={1.5} className="w-4 h-4 text-(--color-accent)" aria-hidden="true" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-(--color-ink) font-mono">{file.name}</div>
                    <div className="text-xs text-(--color-ink-faint) font-mono">
                      {(file.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => { e.stopPropagation(); onRemoveFile() }}
                    aria-label={`Remove ${file.name}`}
                    className="ml-1"
                  >
                    <X strokeWidth={1.5} />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload strokeWidth={1.5} className="w-6 h-6 text-(--color-ink-faint) mx-auto mb-2" aria-hidden="true" />
                  <div className="text-sm text-(--color-ink-dim)">Drop your resume here</div>
                  <div className="text-xs text-(--color-ink-faint) mt-1">or click to browse — PDF or Word (.docx), up to 10 MB</div>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="jobDescription" className="eyebrow">
                Job Description
              </label>
              <AnimatePresence>
                {pasteNotice && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[10px] font-mono text-(--color-accent)"
                  >
                    {pasteNotice}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            {/* Tells the user why the field arrived pre-filled — an
                auto-populated textarea with no explanation reads as a
                bug. Dismissible because it stops being useful once read. */}
            <AnimatePresence>
              {jobContextNotice && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-(--color-accent)/20 bg-(--color-accent)/5 px-3 py-2"
                >
                  <span className="text-xs text-(--color-ink-dim)">
                    Filled from <span className="font-medium text-(--color-ink)">{jobContextNotice}</span>
                  </span>
                  <button
                    type="button"
                    onClick={onDismissJobContextNotice}
                    aria-label="Dismiss job description notice"
                    className="shrink-0 text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <Textarea
              id="jobDescription"
              value={jobDescription}
              onChange={(e) => onJobDescriptionChange(e.target.value)}
              onPaste={onJobDescriptionPaste}
              placeholder="Paste the job posting you are targeting…"
              rows={7}
              style={{ minHeight: 320 }}
            />
            <div className="text-[10px] font-mono text-(--color-ink-faint) text-right mt-1.5">
              {jobDescription.length.toLocaleString()} characters
            </div>
          </div>

          <AnimatePresence>
            {hasError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <InlineError message={error} />
              </motion.div>
            )}
          </AnimatePresence>

          <Button type="submit" disabled={!file} className="w-fit">
            Run the scan
          </Button>
        </form>

        <div className="card px-8 py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-(--color-accent-tint) flex items-center justify-center mx-auto mb-4">
            <FileText strokeWidth={1.5} className="w-6 h-6 text-(--color-accent)" aria-hidden="true" />
          </div>
          <p className="text-sm text-(--color-ink-faint) max-w-xs mx-auto leading-relaxed">
            Run a scan to see your signal strength, the skill gaps, and exactly what to fix.
          </p>
        </div>
      </div>
    </motion.div>
  )
}
