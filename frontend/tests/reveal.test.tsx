import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Reveal, RevealGroup } from '@/lib/reveal'

/* Regression suite for the bug that made every job listing invisible.
 *
 * RevealGroup observes its container, fires once, marks the [data-reveal]
 * children that exist at that moment, and unobserves. Almost every group in
 * this product wraps a list that arrives from a fetch — so the group is on
 * screen and empty when the observer fires, marks nothing, and every row that
 * mounts afterwards keeps the hidden state with nothing left to clear it.
 *
 * Nothing failed. The page rendered, the counts above the list were correct,
 * and the list itself was blank. */

/** Fires every observed target immediately, the way an on-screen group does. */
function mockObserverFiringImmediately() {
  const instances: { cb: IntersectionObserverCallback; targets: Element[] }[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cb: IntersectionObserverCallback
      targets: Element[] = []
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
        instances.push(this)
      }
      observe(el: Element) {
        this.targets.push(el)
        this.cb(
          [{ target: el, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
      unobserve(el: Element) {
        this.targets = this.targets.filter((t) => t !== el)
      }
      disconnect() {
        this.targets = []
      }
    },
  )
  return instances
}

beforeEach(() => {
  mockObserverFiringImmediately()
  // The reveal system only observes when motion is allowed.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})

describe('RevealGroup', () => {
  it('marks the group itself, not only the children present when it fires', () => {
    const { container } = render(
      <RevealGroup data-testid="group">
        <Reveal>one</Reveal>
      </RevealGroup>,
    )
    expect(container.querySelector('[data-revealed-group]')).not.toBeNull()
  })

  it('marks children that exist at reveal time', () => {
    const { container } = render(
      <RevealGroup>
        <Reveal>one</Reveal>
        <Reveal>two</Reveal>
      </RevealGroup>,
    )
    expect(container.querySelectorAll('[data-reveal][data-revealed]')).toHaveLength(2)
  })

  it('leaves late children inside a group that has already revealed', () => {
    // The real case: the group renders empty while a fetch is in flight, the
    // observer fires because it is on screen, and the rows arrive after.
    function List({ items }: { items: string[] }) {
      return (
        <RevealGroup>
          {items.map((item) => (
            <Reveal key={item}>{item}</Reveal>
          ))}
        </RevealGroup>
      )
    }

    const { container, rerender } = render(<List items={[]} />)
    const group = container.querySelector('[data-revealed-group]')
    expect(group).not.toBeNull()

    rerender(<List items={['a', 'b', 'c']} />)

    const late = container.querySelectorAll('[data-reveal]')
    expect(late).toHaveLength(3)
    // They will not carry data-revealed — the observer is long gone. What
    // makes them visible is being inside the marked group, so that marker
    // is the thing this asserts.
    for (const el of late) {
      expect(el.closest('[data-revealed-group]')).not.toBeNull()
    }
  })
})
