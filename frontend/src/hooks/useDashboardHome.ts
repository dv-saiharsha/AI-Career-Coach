import { useEffect, useState } from 'react'
import { dashboardService } from '@/services/dashboardService'
import type { DashboardHomeSchema } from '@/types/dashboard'

interface UseDashboardHomeResult {
  data: DashboardHomeSchema | null
  loading: boolean
  error: Error | null
}

/* Shared across every mount (Sidebar's readiness widget AND DashboardPage
   both use this) so navigating around the app fires ONE request to this
   expensive endpoint — not one per component. Without this, Sidebar (always
   mounted) and DashboardPage independently double-fetched the same
   five-engine aggregate on every visit to /dashboard, competing for the same
   single-worker backend and making the page feel like it hangs. */
let cachedData: DashboardHomeSchema | null = null
let inFlight: Promise<DashboardHomeSchema> | null = null
const subscribers = new Set<() => void>()

function notify() {
  subscribers.forEach((fn) => fn())
}

function load(): Promise<DashboardHomeSchema> {
  if (cachedData) return Promise.resolve(cachedData)
  if (!inFlight) {
    inFlight = dashboardService
      .getHome()
      .then((result) => {
        cachedData = result
        return result
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

export function useDashboardHome(): UseDashboardHomeResult {
  const [data, setData] = useState<DashboardHomeSchema | null>(cachedData)
  const [loading, setLoading] = useState(!cachedData)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const onUpdate = () => setData(cachedData)
    subscribers.add(onUpdate)

    if (!cachedData) {
      load()
        .then((result) => {
          setData(result)
          notify()
        })
        .catch((err) => {
          setError(err instanceof Error ? err : new Error(String(err)))
        })
        .finally(() => {
          setLoading(false)
        })
    }

    return () => {
      subscribers.delete(onUpdate)
    }
  }, [])

  return { data, loading, error }
}
