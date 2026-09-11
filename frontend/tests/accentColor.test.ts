/**
 * A single hex cannot clear WCAG AA against both a near-white and a
 * near-black canvas at once — measured directly: the shipped default blue
 * (#1d4ed8) is 6.42:1 on light but only 2.95:1 on dark, well under the 4.5:1
 * floor. So a user's pick is re-solved per theme rather than applied
 * verbatim; these tests are what would catch a regression back to "just use
 * the hex the user typed."
 */

import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS,
  applyAccentColor,
  deriveSignalForTheme,
  isValidHexColor,
} from '@/lib/accentColor'

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [lumA, lumB] = [relativeLuminance(a), relativeLuminance(b)]
  const [hi, lo] = lumA > lumB ? [lumA, lumB] : [lumB, lumA]
  return (hi + 0.05) / (lo + 0.05)
}

const CANVAS_LIGHT = '#fafafa'
const CANVAS_DARK = '#0a0a0a'
const MIN_CONTRAST = 4.5

describe('isValidHexColor', () => {
  it('accepts a plain 6-digit hex', () => {
    expect(isValidHexColor('#7c5cff')).toBe(true)
    expect(isValidHexColor('#7C5CFF')).toBe(true)
  })

  it('rejects anything else, including CSS-injection-shaped strings', () => {
    expect(isValidHexColor('purple')).toBe(false)
    expect(isValidHexColor('rgb(124, 92, 255)')).toBe(false)
    expect(isValidHexColor('#7c5cf')).toBe(false)
    expect(isValidHexColor('7c5cff')).toBe(false)
    expect(isValidHexColor('#7c5cff; }body{display:none')).toBe(false)
  })
})

describe('deriveSignalForTheme', () => {
  const candidates = [
    ...ACCENT_PRESETS.map((p) => p.hex),
    '#808080', // near-gray, near-zero saturation
    '#ffff00', // pure yellow — already very light
    '#00ffff', // pure cyan
    '#ff00ff', // pure magenta
    '#0a0a0a', // as dark as a color can be
    '#fafafa', // as light as a color can be
  ]

  it.each(candidates)('%s clears AA on the light canvas once solved for light', (hex) => {
    const solved = deriveSignalForTheme(hex, 'light')
    expect(contrastRatio(solved, CANVAS_LIGHT)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it.each(candidates)('%s clears AA on the dark canvas once solved for dark', (hex) => {
    const solved = deriveSignalForTheme(hex, 'dark')
    expect(contrastRatio(solved, CANVAS_DARK)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('produces a different value per theme for the same input — never the raw hex reused', () => {
    const light = deriveSignalForTheme('#1d4ed8', 'light')
    const dark = deriveSignalForTheme('#1d4ed8', 'dark')
    expect(light).not.toBe(dark)
  })

  it('preserves the hue rather than collapsing everything toward grayscale', () => {
    // Solving lightness must not touch hue/saturation — a red pick should
    // still read as red once solved, in both themes.
    const [r, g, b] = hexToRgb(deriveSignalForTheme('#ff0000', 'dark'))
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })
})

describe('applyAccentColor', () => {
  it('sets --signal to the theme-solved value, not the raw pick', () => {
    applyAccentColor('#1d4ed8', 'dark')
    const applied = document.documentElement.style.getPropertyValue('--signal')
    expect(applied.trim()).toBe(deriveSignalForTheme('#1d4ed8', 'dark'))
    expect(applied.trim()).not.toBe('#1d4ed8')
  })

  it('clears back to the CSS default when passed null', () => {
    applyAccentColor('#1d4ed8', 'dark')
    applyAccentColor(null, 'dark')
    expect(document.documentElement.style.getPropertyValue('--signal')).toBe('')
  })
})
