'use client'

/**
 * What a strong answer to one interview question looks like, and why.
 * Extracted verbatim from interview/page.tsx (1,331 lines, five components
 * inline). Behaviour unchanged.
 */

import { useState } from 'react'
import { CheckCircle2, Lightbulb, Sparkles } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import type { ModelAnswerState } from './interviewShared'

export function ModelAnswerPanel({
  modelAnswer,
  onRetry,
}: {
  modelAnswer: ModelAnswerState | undefined
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)

  const status = modelAnswer?.status ?? 'loading'
  const data = modelAnswer?.data ?? null
  // The answer is prefetched on session start. If the user clicks before that
  // background fetch finishes, we show a brief "preparing" state and auto-reveal
  // the moment it's ready — but in the common case it's already ready = instant.
  const showContent = open && status === 'ready' && data

  const handleClick = () => {
    if (status === 'error') { onRetry(); setOpen(true); return }
    setOpen(v => !v)
  }

  return (
    <div className="mt-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleClick}
        aria-expanded={open}
        className="h-auto gap-1.5 px-0 font-mono text-xs uppercase tracking-widest text-ink-subtle hover:bg-transparent hover:text-ink"
      >
        {open && status === 'loading' ? (
          <Spinner className="size-3.5" label="Loading" />
        ) : (
          <Lightbulb strokeWidth={1.5} className="w-3.5 h-3.5" />
        )}
        {showContent
          ? 'Hide the answer'
          : open && status === 'loading'
            ? 'Preparing answer…'
            : status === 'error'
              ? 'Retry loading answer'
              : 'Show me the answer'}
      </Button>

      {open && status === 'error' && (
        <p className="text-xs text-(--color-error) mt-2">
          Could not load the answer. Check the API is running, then retry.
        </p>
      )}

        {showContent && data && (
          <div
           
           
           
           
            className="overflow-hidden panel-enter"
          >
            <div
              className="mt-3 rounded-[10px] p-4 space-y-4"
              style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent-tint)' }}
            >
              {data.ideal_answer && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 flex items-center gap-1.5">
                    <Sparkles strokeWidth={1.5} className="w-3 h-3 text-(--color-accent)" />
                    Model answer
                  </span>
                  <p className="text-sm text-(--color-ink) leading-relaxed whitespace-pre-line">{data.ideal_answer}</p>
                </div>
              )}

              {data.example && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 block">Example</span>
                  <p className="text-sm text-(--color-ink-subtle) leading-relaxed whitespace-pre-line pl-3" style={{ borderLeft: '3px solid var(--color-accent)' }}>
                    {data.example}
                  </p>
                </div>
              )}

              {data.plain_explanation && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 block">In plain terms</span>
                  <p className="text-sm text-(--color-ink-dim) leading-relaxed whitespace-pre-line">{data.plain_explanation}</p>
                </div>
              )}

              {data.key_points.length > 0 && (
                <div>
                  <span className="eyebrow text-[10px] mb-2 block">What the interviewer wants to hear</span>
                  <ul className="space-y-1.5">
                    {data.key_points.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-(--color-ink-subtle) leading-relaxed">
                        <CheckCircle2 strokeWidth={1.5} className="w-3.5 h-3.5 text-(--color-accent) mt-0.5 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  )
}

/* ─── Question Card ──────────────────────────────────────────── */
