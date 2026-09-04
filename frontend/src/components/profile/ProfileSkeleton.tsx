'use client'

/**
 * The profile page's shape while its query is pending.
 *
 * The page previously rendered the real form straight away against empty
 * defaults and hydrated it when the request landed, so every field was blank
 * for as long as the round trip took and then filled in at once. Nothing was
 * technically missing, which is why it survived review — but an empty form
 * is a worse lie than an obvious placeholder, because it reads as "you have
 * not filled this in" rather than "this is still loading".
 *
 * The boxes below deliberately match the real layout's sizes: 20-unit hero
 * band, size-20 avatar, two-column field grids. A skeleton that resizes on
 * load reintroduces the shift it exists to prevent.
 */

import { Skeleton } from '@/components/ui/skeleton'

function FieldRow() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading your profile">
      <div className="glass-card overflow-hidden">
        <Skeleton className="h-20 w-full rounded-none" />
        <div className="-mt-10 flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <Skeleton className="size-20 rounded-full ring-4 ring-canvas-raise" />
            <div className="space-y-2 pb-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-52" />
            </div>
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <div className="glass-card space-y-5 p-6">
        <Skeleton className="h-4 w-44" />
        <FieldRow />
        <FieldRow />
      </div>

      <div className="glass-card space-y-5 p-6">
        <Skeleton className="h-4 w-36" />
        <FieldRow />
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-32 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </div>
      </div>

      <span className="sr-only">Loading your profile…</span>
    </div>
  )
}
