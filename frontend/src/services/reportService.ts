import jsPDF from 'jspdf'
import { http, HttpError } from '@/lib/http'
import type { AnalysisResult } from '@/types/resume'

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** A minimal client-side PDF built only from fields the real API actually
 * returns (ats_score, missing/matched skills, suggestions) — a fallback of
 * last resort, not a replica of the backend's report, so it makes no claims
 * about breakdowns or bullet-level detail it has no data for. */
function buildFallbackPdf(analysis: AnalysisResult): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const primary: [number, number, number] = [37, 99, 235]
  const text: [number, number, number] = [15, 23, 42]
  const muted: [number, number, number] = [100, 116, 139]
  const margin = 20
  let y = 25

  doc.setFillColor(...primary)
  doc.rect(0, 0, 210, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...primary)
  doc.text('HIRELOOM', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text('RESUME ANALYSIS SUMMARY (offline copy — generated in your browser)', margin, y + 6)
  y += 20

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(margin, y, 170, 20, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...text)
  doc.text(`ATS Score: ${analysis.ats_score}`, margin + 5, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(`Scanned ${new Date(analysis.created_at).toLocaleDateString()}`, margin + 110, y + 12)
  y += 32

  const section = (title: string, items: string[], emptyLabel: string) => {
    if (y > 265) {
      doc.addPage()
      y = 25
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...text)
    doc.text(title, margin, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    if (items.length === 0) {
      doc.setTextColor(...muted)
      doc.text(emptyLabel, margin + 2, y)
      y += 7
      return
    }
    items.forEach((item) => {
      if (y > 280) {
        doc.addPage()
        y = 25
      }
      doc.setTextColor(...text)
      const lines = doc.splitTextToSize(`• ${item}`, 168)
      doc.text(lines, margin + 2, y)
      y += lines.length * 5 + 1.5
    })
    y += 5
  }

  section('Matched Skills', analysis.matched_skills, 'None recorded for this scan.')
  section('Missing Skills', analysis.missing_skills, 'None recorded for this scan.')
  section('Suggestions', analysis.suggestions, 'None recorded for this scan.')

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text(`HireLoom — Page ${i} of ${pageCount}`, 105, 290, { align: 'center' })
  }

  return doc.output('blob')
}

export const reportService = {
  /** Downloads the backend-generated feedback PDF (GET /resume/report/{id}).
   *
   * If that request fails for a reason that isn't the server actually
   * answering (offline, DNS, a dropped connection — anything that never got
   * an HTTP response) and a full analysis payload for this scan is already
   * in hand, falls back to a plain client-generated PDF rather than leaving
   * the user with nothing. A real error response (404 analysis not found,
   * 5xx) is surfaced as-is instead of masked by a fallback that would just
   * be guessing at different content.
   */
  downloadReport: async (analysisId: number, fallbackAnalysis?: AnalysisResult | null): Promise<void> => {
    try {
      const { data } = await http.get<Blob>(`/resume/report/${analysisId}`, { responseType: 'blob' })
      triggerBlobDownload(data, `hireloom-resume-report-${analysisId}.pdf`)
    } catch (err) {
      if (err instanceof HttpError || !fallbackAnalysis) throw err
      triggerBlobDownload(buildFallbackPdf(fallbackAnalysis), `hireloom-resume-report-${analysisId}.pdf`)
    }
  },

  /** The candidate's original uploaded file (GET /resume/file/{id}), as a
   * blob — used both to open it in a new tab and to embed it inline as a
   * preview. 404s when the original file wasn't kept for this scan (see
   * ResumeOnFile.can_rescan). */
  getOriginalFileBlob: async (analysisId: number): Promise<Blob> => {
    const { data } = await http.get<Blob>(`/resume/file/${analysisId}`, { responseType: 'blob' })
    return data
  },

  /** Opens the candidate's original uploaded file in a new tab — "view
   * original", distinct from the generated feedback report. */
  viewOriginalFile: async (analysisId: number): Promise<void> => {
    const data = await reportService.getOriginalFileBlob(analysisId)
    const url = URL.createObjectURL(data)
    window.open(url, '_blank', 'noopener,noreferrer')
    // Revoked after a tick rather than immediately — the new tab needs the
    // blob URL to still be valid when it starts loading it.
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  },
}
