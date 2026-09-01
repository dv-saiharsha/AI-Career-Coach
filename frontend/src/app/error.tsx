'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

/**
 * Catches a render-time exception anywhere under this segment. Without this,
 * an unhandled error showed Next.js's default unstyled screen (or a blank
 * page in production) instead of something a user can act on.
 *
 * Deliberately minimal: this is the last line of defence, not a feature —
 * it has no access to whatever state caused the failure, so it can only
 * offer to retry the render or leave.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The one place in the app allowed to just log to console: this
    // component has no logging service to call into, and losing the error
    // entirely would be worse than an unstructured console entry.
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-(--color-error)/10 border border-(--color-error)/20">
        <TriangleAlert className="size-5 text-(--color-error)" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-(--color-ink)">Something went wrong.</h1>
        <p className="mt-1 max-w-sm text-sm text-(--color-ink-dim)">
          This page hit an unexpected error. It&apos;s been logged — try again, or head back to the dashboard.
        </p>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/dashboard" className="btn-ghost">
          Go to dashboard
        </Link>
      </div>
    </div>
  )
}
