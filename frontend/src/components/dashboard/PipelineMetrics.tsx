'use client'

import { motion } from 'framer-motion'
import { KanbanSquare, Target } from 'lucide-react'
import type { PipelineMetrics as Metrics } from '@/lib/apiClient'

/**
 * Headline pipeline numbers.
 *
 * Both figures distinguish "nothing measured" from "measured badly". An
 * average of null renders as an em dash, never 0% — a user with one unscored
 * application should not be told their resume matches nothing.
 */
export function PipelineMetrics({ metrics }: { metrics: Metrics }) {
  const { total_applied, average_match_score, scored_applications, total_applications } = metrics

  const cards = [
    {
      icon: KanbanSquare,
      label: 'Applications sent',
      value: total_applied === 0 ? null : String(total_applied),
      sub:
        total_applications > total_applied
          ? `${total_applications - total_applied} saved, not yet sent`
          : total_applied === 0
            ? 'Nothing sent yet'
            : 'Across your pipeline',
    },
    {
      icon: Target,
      label: 'Average match',
      value: average_match_score === null ? null : `${average_match_score}%`,
      sub:
        average_match_score === null
          ? 'No applications scored yet'
          : `Based on ${scored_applications} of ${total_applications}`,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map(({ icon: Icon, label, value, sub }, index) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.06 }}
          className="card p-5"
        >
          <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)]/10">
            <Icon strokeWidth={1.5} className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
          <div className="font-display text-xl font-bold tabular-nums text-[var(--color-accent)]">
            {value ?? <span className="text-[var(--color-ink-faint)]">&mdash;</span>}
          </div>
          <div className="mt-0.5 text-xs font-medium text-[var(--color-ink)]">{label}</div>
          <div className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{sub}</div>
        </motion.div>
      ))}
    </div>
  )
}
