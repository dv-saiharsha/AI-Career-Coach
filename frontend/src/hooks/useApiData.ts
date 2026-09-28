import { useEffect, useState } from 'react'

interface UseApiDataResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/** Fetch-on-mount for a single service call — the `data`/`loading`/`error`
 *  shape repeated across every page's own useEffect before this existed. */
export function useApiData<T>(fetcher: () => Promise<T>): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { data, loading, error }
}
