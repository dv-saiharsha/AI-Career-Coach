'use client'

import { AlertTriangle, ExternalLink, FileText, Scale } from 'lucide-react'
import type { NewsArticle } from '@/lib/apiClient'

interface PolicyNewsPanelProps {
  articles: NewsArticle[]
  reachable: boolean
}

/**
 * Federal Register documents on F-1, OPT and H-1B.
 *
 * Every item is a real government document — title, agency, publication date
 * and link all come from the Federal Register's own API. Nothing on this panel
 * is written by ApplyCenter, and there is deliberately no "impact" rating: readers
 * make visa and travel decisions on this, and scoring a rule's consequence for
 * an individual is advice this product is not positioned to give.
 */
export function PolicyNewsPanel({ articles, reachable }: PolicyNewsPanelProps) {
  return (
    <div className="card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Scale strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
        <div className="eyebrow">Immigration policy</div>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-ink-dim)]">
        Recent F-1, OPT and H-1B documents from the{' '}
        <span className="text-[var(--color-ink)]">Federal Register</span> — the government&apos;s
        own record. Titles and dates are as published; read the source before acting.
      </p>

      {!reachable && (
        <div
          className="mb-3 flex items-start gap-2 rounded-[10px] border-l-[3px] py-2 pl-3 pr-4"
          style={{ borderLeftColor: 'var(--color-signal-mid)', background: 'var(--color-canvas)' }}
        >
          <AlertTriangle
            strokeWidth={1.5}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-signal-mid)]"
          />
          <p className="text-xs text-[var(--color-ink-dim)]">
            Couldn&apos;t reach the Federal Register. Nothing is shown rather than something
            possibly out of date.
          </p>
        </div>
      )}

      {articles.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-ink-faint)]">
          {reachable ? 'No recent filings matched.' : 'Feed unavailable.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {articles.map((article) => (
            <li key={article.id}>
              <a
                href={article.url ?? '#'}
                target="_blank"
                rel="noreferrer noopener"
                className="group block rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4 transition-colors"
                style={{
                  borderLeftColor: 'var(--color-canvas-line)',
                  background: 'var(--color-canvas)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium leading-snug text-[var(--color-ink)]">
                    {article.title}
                  </span>
                  <ExternalLink
                    strokeWidth={1.5}
                    className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--color-accent)]"
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">
                    <FileText strokeWidth={1.5} className="h-3 w-3" />
                    {article.type}
                  </span>
                  <span className="text-[10px] text-[var(--color-ink-faint)]">
                    {article.agency}
                  </span>
                  {article.published_at && (
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--color-ink-faint)]">
                      {article.published_at}
                    </span>
                  )}
                </div>
                {article.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--color-ink-dim)]">
                    {article.summary}
                  </p>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
        Informational only, not legal advice. Immigration rules change and a proposed rule is not
        a final one — check the linked document, and consult a licensed attorney or your
        institution&apos;s DSO before acting.
      </p>
    </div>
  )
}
