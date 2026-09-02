'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

/**
 * Contains a render-time exception to the panel it wraps, not the route.
 *
 * `src/app/error.tsx` already catches anything that escapes a whole route
 * segment, but that is Next's per-segment boundary — one thrown error
 * anywhere on the page takes the entire page down and replaces it with a
 * generic "something went wrong" screen. That is what actually happened
 * earlier this session: a dashboard TypeError from reading `.length` off a
 * field an older API response didn't carry took out the whole dashboard,
 * including three panels that had nothing to do with the one that crashed.
 *
 * This is the finer-grained version, for the handful of panels where a
 * fetch failure or a shape mismatch is plausible enough to plan for: the
 * job feed, the ATS score generator, an interview session, the applications
 * board. Wrapping every component would be its own kind of noise — this is
 * for panels whose failure mode is "some rows didn't crash the boundary
 * around them," not for static layout that either works or doesn't build.
 *
 * Hand-written rather than react-error-boundary: this codebase's toast,
 * presence and reveal systems are all hand-rolled for the same reason —
 * class components already give React error boundaries for free, and a
 * dependency for forty lines of code is a worse trade than the forty lines.
 */

interface Props {
  children: ReactNode
  /** Named in the fallback: "The job feed hit a problem." Written as a
   *  subject, not a fragment, so it reads as a sentence on its own. */
  label: string
  /** The boundary clears itself when any of these change — e.g. a query
   *  key or a route param — so navigating away from the crash and back
   *  gets a fresh mount instead of a permanently tripped fallback. */
  resetKeys?: unknown[]
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Same posture as app/error.tsx: this boundary has no logging service to
    // call into, so an unstructured console entry is the honest option
    // rather than losing the error entirely.
    console.error(`[ErrorBoundary: ${this.props.label}]`, error, info.componentStack)
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.error || !this.props.resetKeys) return
    const changed = this.props.resetKeys.some((key, i) => key !== prevProps.resetKeys?.[i])
    if (changed) this.setState({ error: null })
  }

  private retry = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    // Deliberately quieter than app/error.tsx's full-page version: this
    // fires inside an otherwise-working page, so a big centred icon-in-a-
    // circle treatment would overstate what actually happened — one panel,
    // not the app.
    return (
      <div className="card flex flex-col items-center gap-2 p-6 text-center" role="alert">
        <TriangleAlert className="size-4 text-(--color-error)" strokeWidth={1.5} aria-hidden="true" />
        <p className="text-sm font-medium text-ink">{this.props.label} hit a problem.</p>
        <p className="text-xs text-ink-faint">The rest of the page is unaffected.</p>
        <button type="button" onClick={this.retry} className="btn-secondary mt-1 text-xs">
          Try again
        </button>
      </div>
    )
  }
}
