'use client'

/**
 * What we hold, and how to take it back.
 *
 * This was a "coming soon" panel while the endpoint behind it was already
 * built and tested. The export reaches the three tables that hold a person's
 * data without carrying their user_id — interview answers, interview
 * questions, application history — which is the part an export written the
 * obvious way silently misses.
 *
 * Retention is stated here in plain words rather than linked to a policy.
 * Someone on this screen is asking what happens to their CV, and the answer
 * fits in two lines.
 */

import { useState } from 'react'
import { Download, FileJson, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { downloadMyData } from '@/lib/apiClient'

export function PrivacySection() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadMyData()
      toast({
        title: 'Your data is downloading',
        description: 'Check your downloads folder for the JSON file.',
      })
    } catch {
      toast({
        title: 'Could not build your export',
        description: 'Something went wrong on our side. Try again in a moment.',
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-ink">Privacy</h2>

      <div className="rounded-xl border border-canvas-line p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <Shield className="size-4 text-accent" aria-hidden="true" />
          What we hold
        </div>
        <p className="text-xs leading-relaxed text-ink-dim">
          Your CV and the text extracted from it, the job descriptions you paste, your
          applications and their notes, and your mock-interview answers. Your CV is read to
          score it and that is all — it is not sold, listed, or shown to employers.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">
          All of it is kept until you remove it. Deleting your account deletes every record
          above.
        </p>
      </div>

      <div className="rounded-xl border border-canvas-line p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
          <FileJson className="size-4 text-accent" aria-hidden="true" />
          Download your data
        </div>
        <p className="mb-4 text-xs leading-relaxed text-ink-dim">
          A JSON file of every record tied to your account, including your interview answers
          and application history. Uploaded CVs are referenced rather than embedded — download
          those individually from your scan history.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={handleExport}
          loading={exporting}
          loadingLabel="Preparing your data"
        >
          {!exporting && <Download />}
          {exporting ? 'Preparing…' : 'Download my data'}
        </Button>
      </div>
    </div>
  )
}
