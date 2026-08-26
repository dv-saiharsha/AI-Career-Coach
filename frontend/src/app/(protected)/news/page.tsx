'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Scale } from 'lucide-react'
import { getDashboardOverview, type DashboardOverview } from '@/lib/apiClient'
import { PolicyNewsPanel } from '@/components/dashboard/PolicyNewsPanel'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Immigration policy filings, on their own page.
 *
 * Reuses PolicyNewsPanel rather than restyling the same content: one renderer
 * means the disclaimer, the unreachable-feed state, and the "no impact rating"
 * decision cannot drift between here and the dashboard.
 */
export default function PolicyNewsPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDashboardOverview()
      .then((data) => {
        if (!cancelled) setOverview(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
          <Scale strokeWidth={1.5} className="h-3 w-3" />
          Federal Register
        </span>
        <h1 className="mt-2 font-display text-2xl font-medium italic text-[var(--color-ink)] md:text-3xl">
          F-1 and H-1B filings.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Proposed and final rules affecting student and work visas, straight from the
          government&apos;s own record. Nothing here is written by ApplyCenter — every item links to
          the document it describes.
        </p>
      </motion.div>

      {failed ? (
        <div className="card p-6">
          <p className="text-sm text-[var(--color-ink-dim)]">
            Couldn&apos;t load filings. Check that the API is running and try again.
          </p>
        </div>
      ) : !overview ? (
        <div className="card space-y-3 p-6">
          <Skeleton className="h-3 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <PolicyNewsPanel articles={overview.news} reachable={overview.news_reachable} />
        </motion.div>
      )}
    </div>
  )
}
