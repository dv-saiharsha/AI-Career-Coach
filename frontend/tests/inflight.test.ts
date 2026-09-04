/**
 * The in-flight counter that drives NetworkActivityBar.
 *
 * The bar is only as honest as this count, and the failure that matters is
 * one-directional: a counter that fails to decrement pins the bar on
 * permanently, which trains the user to ignore it. The error path is the one
 * that would do it, since a request that throws still has to release its
 * slot — so that is what most of this file tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}))

const load = async () => {
  vi.resetModules()
  return import('@/lib/http')
}

const ok = () =>
  new Response(JSON.stringify({ fine: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('in-flight tracking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a request while it is in flight and not after', async () => {
    const { http, onInflightChange } = await load()
    let release: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      }),
    )

    const seen: number[] = []
    onInflightChange((count) => seen.push(count))

    const pending = http.get('/anything')
    expect(seen.at(-1)).toBe(1)

    release(ok())
    await pending
    expect(seen.at(-1)).toBe(0)
  })

  it('returns to zero when the request throws', async () => {
    /* The leak that would pin the bar on forever. A decrement written at the
       success return instead of in a finally passes the test above and fails
       this one. */
    const { http, onInflightChange } = await load()
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))

    let latest = -1
    onInflightChange((count) => {
      latest = count
    })

    await expect(http.get('/anything')).rejects.toThrow('offline')
    expect(latest).toBe(0)
  })

  it('returns to zero on a non-2xx, which throws from a different place', async () => {
    const { http, onInflightChange } = await load()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: 'nope' }), { status: 429 }),
    )

    let latest = -1
    onInflightChange((count) => {
      latest = count
    })

    await expect(http.get('/anything')).rejects.toThrow('nope')
    expect(latest).toBe(0)
  })

  it('counts overlapping requests rather than flipping a boolean', async () => {
    /* Two requests, the first finishing while the second is still open. A
       boolean would call the app idle here and hide the bar with work still
       running. */
    const { http, onInflightChange } = await load()
    const releases: Array<(value: Response) => void> = []
    vi.mocked(fetch).mockImplementation(
      () => new Promise<Response>((resolve) => releases.push(resolve)),
    )

    let latest = -1
    onInflightChange((count) => {
      latest = count
    })

    const first = http.get('/one')
    const second = http.get('/two')
    // The count rises synchronously, but fetch is only reached after the
    // bearer token is awaited — so wait for the transport to actually issue
    // both before releasing them.
    expect(latest).toBe(2)
    await vi.waitFor(() => expect(releases).toHaveLength(2))

    releases[0](ok())
    await first
    expect(latest).toBe(1)

    releases[1](ok())
    await second
    expect(latest).toBe(0)
  })

  it('gives a new subscriber the current count immediately', async () => {
    /* A component mounting mid-request must not have to wait for the next
       change to learn something is already running. */
    const { http, onInflightChange } = await load()
    let release: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      }),
    )

    const pending = http.get('/anything')
    let onMount = -1
    onInflightChange((count) => {
      if (onMount === -1) onMount = count
    })
    expect(onMount).toBe(1)

    release(ok())
    await pending
  })
})
