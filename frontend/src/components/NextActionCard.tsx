import Link from 'next/link'
import { ArrowRight, Sparkles, type LucideIcon } from 'lucide-react'
import type { NextAction } from '@/lib/apiClient'

/**
 * The {key,label,description,href,priority} next-action shape is shared
 * across Resume Review, the Mock Interview report, and the Career
 * Dashboard — this card was duplicated byte-for-byte in the first two
 * before being extracted here. Icon resolution stays with each caller
 * (their action keys differ), so this only owns the shared presentation.
 */
export function NextActionCard({ action, icon: Icon = Sparkles }: { action: NextAction; icon?: LucideIcon }) {
  return (
    <Link href={action.href} className="card card-hover p-4 flex items-start gap-3 group">
      <span className="w-8 h-8 rounded-full bg-(--color-accent-tint) flex items-center justify-center shrink-0">
        <Icon strokeWidth={1.5} className="w-4 h-4 text-(--color-accent)" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-(--color-ink)">
          {action.label}
          <ArrowRight
            strokeWidth={1.5}
            className="w-3 h-3 text-(--color-ink-faint) transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
        <span className="block text-xs text-(--color-ink-dim) mt-0.5 leading-relaxed">
          {action.description}
        </span>
      </span>
    </Link>
  )
}
