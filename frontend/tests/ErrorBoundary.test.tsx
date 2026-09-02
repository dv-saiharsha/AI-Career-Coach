import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/* This is what the dashboard TypeError earlier in this session actually
 * looked like: a field an older API response didn't carry, read with no
 * guard, throwing during render and taking the whole page down with it.
 * ErrorBoundary exists so that failure mode is contained to one panel. */

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    const data: { length?: number } = {}
    // The exact shape of bug this boundary exists for — no optional
    // chaining, reading straight off a field that may not be there.
    return <span>{data.length!.toString()}</span>
  }
  return <span>ok</span>
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary label="The test panel">
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('catches a render-time exception and shows a labelled fallback', () => {
    // React logs the caught error to the console by default; silence it so
    // the expected failure doesn't read as a real test failure in output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary label="The job feed">
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The job feed hit a problem.')
    expect(screen.queryByText('ok')).not.toBeInTheDocument()

    spy.mockRestore()
  })

  it('recovers on retry once the underlying problem is gone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Harness() {
      const [broken, setBroken] = useState(true)
      return (
        <div>
          <button onClick={() => setBroken(false)}>fix upstream data</button>
          <ErrorBoundary label="The job feed">
            <Bomb shouldThrow={broken} />
          </ErrorBoundary>
        </div>
      )
    }

    render(<Harness />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Fix the underlying cause first — a retry that re-renders the same
    // broken input just throws again, which is not what "try again" promises.
    fireEvent.click(screen.getByText('fix upstream data'))
    fireEvent.click(screen.getByText('Try again'))

    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    spy.mockRestore()
  })

  it('clears the fallback when a resetKey changes, without a manual retry', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(
      <ErrorBoundary label="The job feed" resetKeys={['search-a']}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // A new search term, with content that no longer throws — mirrors
    // navigating from a crashed query to a different, working one.
    rerender(
      <ErrorBoundary label="The job feed" resetKeys={['search-b']}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    spy.mockRestore()
  })

  it('does not reset on an unrelated re-render when resetKeys are unchanged', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(
      <ErrorBoundary label="The job feed" resetKeys={['search-a']}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Same resetKeys, and the child would no longer throw — but nothing
    // actually changed about *why* it crashed, so it should stay caught
    // rather than flicker open on every unrelated parent render.
    rerender(
      <ErrorBoundary label="The job feed" resetKeys={['search-a']}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    spy.mockRestore()
  })
})
