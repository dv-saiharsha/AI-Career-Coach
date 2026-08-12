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

/* Light-theme values from the Porcelain & Obsidian palette. These are what
   SSR and the first paint use, so they must match :root — the old blue
   defaults flashed a foreign palette before hydration. */
const FALLBACK: AccentPalette = {
  accent: '#0f172a',
  accentDim: '#1e293b',
  accentLight: '#3b4453',
  accentLighter: '#64748b',
  signalHigh: '#3f5a42',
  signalMid: '#8a5a17',
  signalLow: '#8e332b',
  inkDim: '#5e6472',
  inkFaint: '#6a6f7f',
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
  data: ['#2f3a4c', '#7a6a55', '#a67c52', '#55684f', '#8c5648', '#6b6478'],
  grid: '#e4e0d8',
  axis: '#6a6f7f',
  surface: '#ffffff',
  border: '#e4e0d8',
  ink: '#0f172a',
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
