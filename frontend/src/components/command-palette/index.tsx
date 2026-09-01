'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'

/* ────────────────────────────────────────────────────────────────────────
   COMMAND PALETTE — open state, without a provider

   This was a React context wrapping the whole application at the root, which
   meant cmdk and the palette's twenty icons were in the initial graph of
   every route, including the marketing pages where ⌘K is a convenience
   nobody has asked for yet.

   Open/closed is one boolean shared by the whole document. A module-level
   store expresses that directly and costs nothing to read, where a context
   needed a provider above every consumer — and the provider was where the
   weight came from, not the state.

   useSyncExternalStore rather than a hand-rolled subscription so the value
   is correct across concurrent renders, and so the server snapshot is
   explicitly `false` instead of a hydration mismatch waiting to happen.
   ──────────────────────────────────────────────────────────────────────── */

let paletteOpen = false
/* Latches on the first open and never resets — it is the answer to "has the
   dialog's chunk been asked for yet", which is a one-way door. Kept in the
   store rather than derived in an effect so mounting the dialog is a plain
   render, not a render followed by a state write. */
let paletteRequested = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return paletteOpen
}

/** The palette is never open during SSR — there has been no keystroke yet. */
function getServerSnapshot() {
  return false
}

function getRequestedSnapshot() {
  return paletteRequested
}

/** Nothing has been requested during SSR either. */
function getRequestedServerSnapshot() {
  return false
}

export function setPaletteOpen(next: boolean) {
  if (paletteOpen === next) return
  paletteOpen = next
  if (next) paletteRequested = true
  emit()
}

export function togglePalette() {
  setPaletteOpen(!paletteOpen)
}

/** Read the palette from anywhere — the nav trigger, an empty state, a hint. */
export function useCommandPalette() {
  const open = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return React.useMemo(
    () => ({ open, setOpen: setPaletteOpen, toggle: togglePalette }),
    [open],
  )
}

/* The dialog is the only thing that imports cmdk. ssr:false because it
   renders nothing until it is open, so there is no markup worth
   prerendering — and prerendering it would defeat the point by putting it
   back in the server graph. */
const PaletteDialog = dynamic(() => import('./PaletteDialog'), { ssr: false })

/**
 * Mounted once in the root layout. Owns the ⌘K listener — a handful of bytes
 * — and pulls the dialog in only after the palette has been opened for the
 * first time. Once loaded it stays mounted, so reopening is instant and the
 * close transition still has something to run on.
 */
export function CommandPaletteMount() {
  const { open, toggle } = useCommandPalette()
  const requested = React.useSyncExternalStore(
    subscribe,
    getRequestedSnapshot,
    getRequestedServerSnapshot,
  )

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return

      // ⌘K inside a text field belongs to the field (it is "delete to end of
      // line" on macOS), unless the palette is already open — in which case
      // the focused element is the palette's own input and ⌘K should close it.
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing && !open) return

      e.preventDefault()
      toggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggle, open])

  return requested ? <PaletteDialog /> : null
}
