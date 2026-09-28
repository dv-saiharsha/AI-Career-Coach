import { supabase } from '@/lib/supabase'

/* Best-effort live progress for one resume scan.

   The backend publishes real "scan_stage" events to the account's SSE stream
   (GET /api/events/stream — see backend/app/modules/events/router.py and
   resume_analyzer/progress.py) as /analyze actually moves through extracting
   -> checking -> analyzing -> reconciling -> diagnostics. That stream needs a
   Bearer token the browser's native EventSource cannot attach, so it's read
   here by hand with fetch + a ReadableStream reader instead.

   This intentionally does not go through lib/http.ts: that client always
   awaits a full response body (json/blob), and a long-lived stream is read
   incrementally instead. Every failure here — offline, a proxy that buffers
   or drops SSE, an older browser — is swallowed silently; the caller's own
   simulated step progression is what carries the UI in that case, and a scan
   must never fail because progress reporting did. */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

const SCAN_STAGE_EVENT = 'scan_stage'

/** Subscribe to this account's event stream, forwarding only the scan_stage
 * events for `scanId` (the same id sent as the `scan_id` form field to
 * /resume/analyze). Returns an abort function; call it once the request this
 * is tracking has settled, so the stream doesn't outlive its caller. */
export function subscribeToScanStages(scanId: string, onStage: (stage: string) => void): () => void {
  const controller = new AbortController()

  void (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const response = await fetch(`${BASE_URL}/events/stream`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          let eventType = 'message'
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }

          if (eventType === SCAN_STAGE_EVENT && data) {
            try {
              const parsed = JSON.parse(data) as { scan_id?: string; stage?: string }
              if (parsed.scan_id === scanId && parsed.stage) onStage(parsed.stage)
            } catch {
              // Malformed frame — ignore and keep reading.
            }
          }

          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // Aborted on cleanup, or the stream never connected. No progress is a
      // degraded experience, not an error — the fallback ticker covers it.
    }
  })()

  return () => controller.abort()
}
