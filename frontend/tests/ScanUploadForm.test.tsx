/**
 * The single-resume constraint: only one resume is kept per account, so the
 * dropzone and the "on file" card are never both live — showing a way to
 * drop a second file in while one is already stored would silently create
 * exactly the multi-resume situation this is meant to prevent. Deleting the
 * one on file is what brings the dropzone back.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScanUploadForm } from '@/components/resume/ScanUploadForm'
import type { ResumeOnFile } from '@/lib/apiClient'

const ON_FILE: ResumeOnFile = {
  has_resume: true,
  can_rescan: true,
  analysis_id: 21,
  filename: 'resume.pdf',
  ats_score: 47,
  band: 'DEVELOPING',
  scanned_at: '2026-09-04T10:07:13Z',
}

function noop() {}

function renderForm(overrides: Partial<React.ComponentProps<typeof ScanUploadForm>> = {}) {
  return render(
    <ScanUploadForm
      file={null}
      jobDescription=""
      hasError={false}
      error=""
      dragOver={false}
      pasteNotice={null}
      jobContextNotice={null}
      fileInputRef={{ current: null }}
      onDragOver={noop}
      onDragLeave={noop}
      onDrop={noop}
      onPickFile={noop}
      onRemoveFile={noop}
      onJobDescriptionChange={noop}
      onJobDescriptionPaste={noop}
      onDismissJobContextNotice={noop}
      onSubmit={(e) => e.preventDefault()}
      {...overrides}
    />,
  )
}

describe('the dropzone, with no resume on file', () => {
  it('is shown', () => {
    renderForm({ onFile: { has_resume: false, can_rescan: false } })
    expect(screen.getByText(/drop your resume here/i)).toBeInTheDocument()
  })
})

describe('the dropzone, with a resume already on file', () => {
  it('is hidden — the only way to a different resume is deleting this one', () => {
    renderForm({ onFile: ON_FILE, onDeleteOnFile: vi.fn() })
    expect(screen.queryByText(/drop your resume here/i)).not.toBeInTheDocument()
    expect(screen.getByText('resume.pdf')).toBeInTheDocument()
  })

  it('offers no delete action when the caller does not wire one up', () => {
    renderForm({ onFile: ON_FILE })
    expect(screen.queryByRole('button', { name: /delete resume/i })).not.toBeInTheDocument()
  })
})

describe('deleting the resume on file', () => {
  it('requires a second click to confirm before calling through', async () => {
    const onDeleteOnFile = vi.fn().mockResolvedValue(undefined)
    renderForm({ onFile: ON_FILE, onDeleteOnFile })

    const button = screen.getByRole('button', { name: /delete resume on file/i })
    fireEvent.click(button)
    expect(onDeleteOnFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /confirm delete resume/i }))
    expect(onDeleteOnFile).toHaveBeenCalledWith(21)
    await waitFor(() => expect(screen.getByRole('button', { name: /delete resume on file/i })).toBeEnabled())
  })
})
