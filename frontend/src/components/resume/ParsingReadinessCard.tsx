'use client'

import { AlertTriangle, Check, Columns2, HelpCircle } from 'lucide-react'
import type { ParsingReadiness } from '@/lib/apiClient'

interface ParsingReadinessCardProps {
  readiness?: ParsingReadiness | null
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--color-signal-low)',
  high: 'var(--color-signal-low)',
  medium: 'var(--color-signal-mid)',
}

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--color-signal-high)'
  if (score >= 60) return 'var(--color-signal-mid)'
  return 'var(--color-signal-low)'
}

export function ParsingReadinessCard({ readiness }: ParsingReadinessCardProps) {
  // Absent on scans stored before layout checking existed. Rendering nothing
  // is right — an empty card would imply the check ran and found nothing.
  if (!readiness) return null

  const {
    readiness_score,
    is_single_column,
    detected_headers,
    formatting_warnings,
    column_check_skipped_reason,
  } = readiness

  return (
    <div className="card space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Layout & parsing readiness</div>
          <p className="max-w-md text-xs leading-relaxed text-[var(--color-ink-dim)]">
            Whether a parser can read this file at all. Separate from your match score — a resume
            can name every keyword and still be unreadable if it&apos;s two-column or a scan.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-display text-2xl tabular-nums"
            style={{ color: scoreColor(readiness_score) }}
          >
            {readiness_score}
            <span className="text-sm text-[var(--color-ink-faint)]">%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          className="rounded-[10px] p-3.5"
          style={{ border: '1px solid var(--color-canvas-line)', background: 'var(--color-canvas)' }}
        >
          <span className="eyebrow mb-2 block text-[10px]">Column layout</span>
          <div className="flex items-start gap-2">
            {is_single_column === true && (
              <>
                <Check strokeWidth={2} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-signal-high)]" />
                <span className="text-sm text-[var(--color-ink)]">
                  Single column — reads cleanly top to bottom.
                </span>
              </>
            )}
            {is_single_column === false && (
              <>
                <Columns2 strokeWidth={1.5} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-signal-low)]" />
                <span className="text-sm text-[var(--color-ink)]">
                  Multi-column — parsers read across the gap and interleave the text.
                </span>
              </>
            )}
            {/* Explicitly "not checked", never a silent pass. */}
            {is_single_column === null && (
              <>
                <HelpCircle strokeWidth={1.5} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                <span className="text-sm text-[var(--color-ink-dim)]">
                  Not checked
                  {column_check_skipped_reason ? ` — ${column_check_skipped_reason.toLowerCase()}` : ''}.
                </span>
              </>
            )}
          </div>
        </div>

        <div
          className="rounded-[10px] p-3.5"
          style={{ border: '1px solid var(--color-canvas-line)', background: 'var(--color-canvas)' }}
        >
          <span className="eyebrow mb-2 block text-[10px]">
            Sections found ({detected_headers.length})
          </span>
          {detected_headers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {detected_headers.map((header) => (
                <span key={header} className="chip capitalize">
                  {header}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-ink-dim)]">
              None recognised. Parsers locate your history by its headings.
            </p>
          )}
        </div>
      </div>

      {formatting_warnings.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {formatting_warnings.map((warning) => (
            <div
              key={warning.issue}
              className="rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4"
              style={{
                borderLeftColor: SEVERITY_COLOR[warning.severity] ?? 'var(--color-signal-mid)',
                background: 'var(--color-canvas)',
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  strokeWidth={1.5}
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: SEVERITY_COLOR[warning.severity] ?? 'var(--color-signal-mid)' }}
                />
                <span className="text-sm font-medium text-[var(--color-ink)]">{warning.issue}</span>
              </div>
              {/* The detail is the actionable half — what to actually change. */}
              <p className="mt-1 pl-5.5 text-xs leading-relaxed text-[var(--color-ink-dim)]">
                {warning.detail}
              </p>
            </div>
          ))}
        </div>
      )}

      {formatting_warnings.length === 0 && (
        <p className="text-xs text-[var(--color-ink-faint)]">
          No formatting problems detected.
        </p>
      )}
    </div>
  )
}
