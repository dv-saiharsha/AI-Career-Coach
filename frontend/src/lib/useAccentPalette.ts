'use client'

import { useSyncExternalStore } from 'react'

export interface AccentPalette {
  accent: string
  /** The system's one hue. Metrics, score figures, emphasised phrases. */
  signal: string
  accentDim: string
  accentLight: string
  accentLighter: string
  signalHigh: string
  signalMid: string
  signalLow: string
  inkDim: string
  inkFaint: string
}

/* Light-theme values, and they must stay identical to :root in globals.css.
   These are what SSR and the first paint use, so a stale entry here is a
   visible flash of a foreign palette before hydration — which is exactly what
   these were: they were still the retired Porcelain & Obsidian values long
   after that system was replaced. */
const FALLBACK: AccentPalette = {
  accent: '#0a0a0a',
  signal: '#1d4ed8',
  accentDim: '#333333',
  accentLight: '#404040',
  accentLighter: '#6b6b6b',
  signalHigh: '#22704d',
  signalMid: '#7d5516',
  signalLow: '#8f3e3c',
  inkDim: '#525252',
  inkFaint: '#6b6b6b',
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
    signal: get('--color-signal', FALLBACK.signal),
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

export interface ChartTheme {
  /** Categorical series colours, WCAG-checked against both canvases. */
  data: [string, string, string, string, string, string]
  grid: string
  axis: string
  surface: string
  border: string
  ink: string
}

const CHART_FALLBACK: ChartTheme = {
  data: ['#1d4ed8', '#525252', '#22704d', '#7d5516', '#8f3e3c', '#737373'],
  grid: '#e5e5e5',
  axis: '#6b6b6b',
  surface: '#ffffff',
  border: '#e5e5e5',
  ink: '#0a0a0a',
}

let cachedChart: ChartTheme = CHART_FALLBACK
let cachedChartTheme: string | null = null

function readChart(): ChartTheme {
  const themeAttr = document.documentElement.getAttribute('data-theme')
  if (cachedChartTheme === themeAttr) return cachedChart

  const style = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback

  cachedChartTheme = themeAttr
  cachedChart = {
    data: [
      get('--color-data-1', CHART_FALLBACK.data[0]),
      get('--color-data-2', CHART_FALLBACK.data[1]),
      get('--color-data-3', CHART_FALLBACK.data[2]),
      get('--color-data-4', CHART_FALLBACK.data[3]),
      get('--color-data-5', CHART_FALLBACK.data[4]),
      get('--color-data-6', CHART_FALLBACK.data[5]),
    ],
    grid: get('--color-canvas-line', CHART_FALLBACK.grid),
    axis: get('--color-ink-faint', CHART_FALLBACK.axis),
    surface: get('--color-canvas-raise', CHART_FALLBACK.surface),
    border: get('--color-canvas-line', CHART_FALLBACK.border),
    ink: get('--color-ink', CHART_FALLBACK.ink),
  }
  return cachedChart
}

function getChartServerSnapshot() {
  return CHART_FALLBACK
}

/**
 * The 6-stop data ramp plus chart chrome, resolved to concrete colours.
 *
 * Recharts writes stroke/fill as SVG *attributes*, where `var()` does not
 * resolve — so chart colour has to come through JS rather than CSS.
 */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, readChart, getChartServerSnapshot)
}
