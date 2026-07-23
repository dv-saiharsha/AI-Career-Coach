'use client'

import { useSyncExternalStore } from 'react'

export interface AccentPalette {
  accent: string
  accentDim: string
  accentLight: string
  accentLighter: string
  signalHigh: string
  signalMid: string
  signalLow: string
  inkDim: string
  inkFaint: string
}

const FALLBACK: AccentPalette = {
  accent: '#60A5FA',
  accentDim: '#2563EB',
  accentLight: '#93C5FD',
  accentLighter: '#DBEAFE',
  signalHigh: '#22C55E',
  signalMid: '#F59E0B',
  signalLow: '#EF4444',
  inkDim: '#94A3B8',
  inkFaint: '#64748B',
}

let cachedPalette: AccentPalette = FALLBACK
let cachedThemeAttr: string | null = null

function read(): AccentPalette {
  const themeAttr = document.documentElement.getAttribute('data-theme')
  if (cachedThemeAttr === themeAttr) return cachedPalette

  const style = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  cachedThemeAttr = themeAttr
  cachedPalette = {
    accent: get('--color-accent', FALLBACK.accent),
    accentDim: get('--color-accent-dim', FALLBACK.accentDim),
    accentLight: get('--color-accent-light', FALLBACK.accentLight),
    accentLighter: get('--color-accent-lighter', FALLBACK.accentLighter),
    signalHigh: get('--color-signal-high', FALLBACK.signalHigh),
    signalMid: get('--color-signal-mid', FALLBACK.signalMid),
    signalLow: get('--color-signal-low', FALLBACK.signalLow),
    inkDim: get('--color-ink-dim', FALLBACK.inkDim),
    inkFaint: get('--color-ink-faint', FALLBACK.inkFaint),
  }
  return cachedPalette
}

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function getServerSnapshot() {
  return FALLBACK
}

/** Live-updating theme accent colors as plain hex strings, for contexts that
 * can't read CSS vars directly (recharts fills, canvas, GSAP color tweens). */
export function useAccentPalette(): AccentPalette {
  return useSyncExternalStore(subscribe, read, getServerSnapshot)
}
