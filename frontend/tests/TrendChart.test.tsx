import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { TrendChart, type TrendPoint } from '@/components/charts/TrendChart'

/* Regression suite for 30d213f.
 *
 * Five element lists in TrendChart were keyed on `p.date`. A date is not
 * unique — uploading a resume, fixing something and uploading again on the
 * same day is ordinary use — so React deduplicated the children and the
 * chart silently rendered fewer points than it was given. Typecheck, lint
 * and the production build were all clean. */

let errors: unknown[][]

beforeEach(() => {
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Every point draws one dot and one hover target, whatever the dates say. */
function countMarks(container: HTMLElement) {
  return {
    dots: container.querySelectorAll('circle:not(.pt-dot)').length,
    hits: container.querySelectorAll('.pt-hit').length,
    rows: container.querySelectorAll('tbody tr').length,
  }
}

describe('TrendChart', () => {
  it('renders every point when several scans share a date', () => {
    const points: TrendPoint[] = [
      { date: 'Aug 26', score: 58 },
      { date: 'Aug 26', score: 64 },
      { date: 'Aug 26', score: 71 },
      { date: 'Sep 1', score: 73 },
    ]

    const { container } = render(<TrendChart id="t1" points={points} summary="s" fixedScale />)

    expect(errors).toHaveRenderedWithoutKeyWarnings()
    const marks = countMarks(container)
    expect(marks.dots).toBe(points.length)
    expect(marks.hits).toBe(points.length)
    expect(marks.rows).toBe(points.length)
  })

  it('keeps every point when the entire series is one date', () => {
    const points: TrendPoint[] = Array.from({ length: 6 }, (_, i) => ({
      date: '13 Apr',
      score: 40 + i,
    }))

    const { container } = render(<TrendChart id="t2" points={points} summary="s" fixedScale />)

    expect(errors).toHaveRenderedWithoutKeyWarnings()
    expect(countMarks(container).dots).toBe(6)
  })

  it('renders nothing rather than throwing on an empty series', () => {
    const { container } = render(<TrendChart id="t3" points={[]} summary="s" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('survives a single point, where the axis span would otherwise be zero', () => {
    const { container } = render(
      <TrendChart id="t4" points={[{ date: '1 Jan', score: 62 }]} summary="s" />,
    )
    expect(errors).toHaveRenderedWithoutKeyWarnings()
    expect(countMarks(container).dots).toBe(1)

    // A zero-width span must not produce NaN coordinates in the path.
    const path = container.querySelector('path')?.getAttribute('d') ?? ''
    expect(path).not.toContain('NaN')
  })

  it('survives an all-identical series on an auto scale', () => {
    const points: TrendPoint[] = [
      { date: 'a', score: 50 },
      { date: 'b', score: 50 },
      { date: 'c', score: 50 },
    ]
    const { container } = render(<TrendChart id="t5" points={points} summary="s" />)

    expect(errors).toHaveRenderedWithoutKeyWarnings()
    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('d')).not.toContain('NaN')
    }
  })

  it('gives every point a text equivalent, since the drawing is aria-hidden to readers', () => {
    const points: TrendPoint[] = [
      { date: 'Aug 26', score: 58, label: '26 August 2026' },
      { date: 'Aug 26', score: 64, label: '26 August 2026, second scan' },
    ]
    const { container } = render(<TrendChart id="t6" points={points} summary="s" fixedScale />)

    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('26 August 2026')
    expect(rows[1].textContent).toContain('second scan')
  })
})
