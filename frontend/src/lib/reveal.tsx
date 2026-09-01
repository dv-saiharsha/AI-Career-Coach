'use client'

import * as React from 'react'

/* ────────────────────────────────────────────────────────────────────────
   SCROLL REVEAL

   One IntersectionObserver for the whole document, shared by every target.
   One observer per element was measurably the wrong shape: a landing page
   reveals forty-odd elements, and forty observers is forty separate
   callback queues the browser has to service on every scroll.

   The observer sets a data attribute and unobserves. It never touches React
   state, so a reveal costs zero renders — the transition itself lives in CSS
   (see the SCROLL REVEAL block in globals.css, which also carries the
   reduced-motion and no-JS guards).

   Reveals fire once and never reverse. An element that has arrived stays
   arrived; scrolling back up does not re-animate it.
   ──────────────────────────────────────────────────────────────────────── */

/** Roughly 13% of the element inside the viewport. */
const THRESHOLD = 0.13

/** Interval between siblings in a staggered group. */
const STAGGER_MS = 80

/**
 * Past this many children a group reveals as one block. Six children at
 * 80ms already makes the last one wait 400ms; more than that and someone on
 * a slow connection is watching an animation instead of reading.
 */
const STAGGER_MAX = 6

type Handler = (el: Element) => void

let observer: IntersectionObserver | null = null
const handlers = new WeakMap<Element, Handler>()

/**
 * True when the user has not asked for reduced motion. Read at observe time
 * rather than cached at module scope, so a user changing the OS setting
 * mid-session is honoured on the next mount.
 */
function motionAllowed() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getObserver() {
  if (observer) return observer
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const handler = handlers.get(entry.target)
        /* Unobserve before running the handler: reveals fire once, and
           leaving a settled element in the observer means the browser keeps
           computing intersections for it for the life of the page. */
        observer?.unobserve(entry.target)
        handlers.delete(entry.target)
        handler?.(entry.target)
      }
    },
    { threshold: THRESHOLD }
  )
  return observer
}

function observe(el: Element, handler: Handler) {
  handlers.set(el, handler)
  getObserver().observe(el)
  return () => {
    handlers.delete(el)
    observer?.unobserve(el)
  }
}

function markRevealed(el: Element) {
  ;(el as HTMLElement).dataset.revealed = ''
}

/**
 * Reveals `ref`'s element when it scrolls into view.
 *
 * Under reduced motion nothing is observed at all — the CSS never applies a
 * hidden state in that case, so the element is already in its final form.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el || !motionAllowed()) return
    return observe(el, markRevealed)
  }, [])

  return ref
}

/**
 * Reveals every `[data-reveal]` descendant of `ref`'s element in sequence
 * when the group scrolls into view.
 *
 * The stagger is applied to the whole group at once rather than by observing
 * each child, so the sequence reads as one gesture — children below the fold
 * do not restart it when they arrive individually.
 */
export function useRevealGroup<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el || !motionAllowed()) return

    return observe(el, (group) => {
      const children = group.querySelectorAll<HTMLElement>('[data-reveal]')
      const staggered = children.length <= STAGGER_MAX

      if (group.hasAttribute('data-reveal')) markRevealed(group)
      children.forEach((child, i) => {
        if (staggered) child.style.setProperty('--reveal-delay', `${i * STAGGER_MS}ms`)
        markRevealed(child)
      })
    })
  }, [])

  return ref
}

type RevealProps<E extends React.ElementType> = {
  as?: E
  /** Extra delay in ms, on top of any stagger from an enclosing group. */
  delay?: number
  children?: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<E>, 'as' | 'children'>

/**
 * A single element that reveals on scroll.
 *
 * Inside a `<RevealGroup>` it does not observe itself — the group drives the
 * sequence — so nesting one in the other is free rather than doubled up.
 */
export function Reveal<E extends React.ElementType = 'div'>({
  as,
  delay,
  style,
  children,
  ...rest
}: RevealProps<E>) {
  const inGroup = React.useContext(RevealGroupContext)
  const own = useReveal<HTMLElement>()
  const Comp = (as ?? 'div') as React.ElementType

  return (
    <Comp
      ref={inGroup ? undefined : own}
      data-reveal=""
      style={delay ? { ...style, '--reveal-delay': `${delay}ms` } : style}
      {...rest}
    >
      {children}
    </Comp>
  )
}

const RevealGroupContext = React.createContext(false)

type RevealGroupProps<E extends React.ElementType> = {
  as?: E
  children?: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<E>, 'as' | 'children'>

/**
 * Wraps a set of `<Reveal>` children and reveals them in sequence, 80ms
 * apart, up to six. Past six the whole group arrives at once.
 */
export function RevealGroup<E extends React.ElementType = 'div'>({
  as,
  children,
  ...rest
}: RevealGroupProps<E>) {
  const ref = useRevealGroup<HTMLElement>()
  const Comp = (as ?? 'div') as React.ElementType

  return (
    <RevealGroupContext.Provider value={true}>
      <Comp ref={ref} {...rest}>
        {children}
      </Comp>
    </RevealGroupContext.Provider>
  )
}
