/**
 * The user-chosen accent color (Settings > Appearance) recolors exactly one
 * CSS custom property: --signal, the app's one deliberate hue (scores, chart
 * series, active indicators — see globals.css's own comment on why). Every
 * other structural color (buttons, borders, focus rings) stays the fixed
 * monochrome ink, unaffected by this.
 *
 * globals.css derives --signal-strong and --signal-bg from --signal via
 * color-mix(), so overriding this one variable per theme is the entire
 * client-side effect — nothing else needs to be set.
 *
 * WHY A SINGLE HEX ISN'T ENOUGH
 *
 * --signal already ships as two different hex values today — #1d4ed8 in
 * light, #7cb2ff in dark — not one color reused. That isn't a stylistic
 * choice: a color dark enough to read on a near-white canvas (light theme)
 * is, by construction, too dark to read on a near-black one (dark theme),
 * and the reverse. Measured directly — #1d4ed8 clears 6.42:1 on light but
 * only 2.95:1 on dark, well under the 4.5:1 AA floor globals.css's own
 * contrast gate (scripts/check-contrast.mjs) holds every token to.
 *
 * So a user's pick is treated as a hue + saturation, not a fixed color: the
 * lightness is re-solved per theme, searching outward from the picked value
 * until the result clears AA against that theme's own canvas. The same hue
 * the user chose, rendered at whatever lightness that theme actually needs.
 */

export const SIGNAL_CSS_VAR = '--signal'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value)
}

// The two canvas backgrounds --signal is actually read against (light and
// dark --canvas from globals.css).
const CANVAS_LIGHT = '#fafafa'
const CANVAS_DARK = '#0a0a0a'

// WCAG AA for normal text — --signal carries actual score numbers, not just
// decoration, so the decorative-element 3:1 floor isn't the right bar.
const MIN_CONTRAST = 4.5

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360
  s /= 100
  l /= 100
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255]
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

/** Every step from the picked lightness toward the boundary, stopping the
 *  moment contrast clears — the smallest nudge that makes the pick legible,
 *  not a fixed "always maximally dark/light" transform. Bounded at the 2%/98%
 *  lightness extremes: by that point luminance is dominated by black/white
 *  regardless of hue, so a solution always exists before the loop runs out. */
function solveLightness(hue: number, sat: number, seedL: number, canvas: string, direction: 1 | -1): number {
  let l = seedL
  for (let i = 0; i < 100; i++) {
    const [r, g, b] = hslToRgb(hue, sat, l)
    if (contrastRatio(rgbToHex(r, g, b), canvas) >= MIN_CONTRAST) return l
    l += direction
    if (l < 2 || l > 98) break
  }
  return Math.max(2, Math.min(98, l))
}

export type ResolvedTheme = 'light' | 'dark'

/**
 * The hue + saturation of `hex`, rendered at whatever lightness this theme's
 * canvas needs to clear AA — see the module docstring for why this can't be
 * the picked hex verbatim in both themes.
 */
export function deriveSignalForTheme(hex: string, theme: ResolvedTheme): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex))
  const canvas = theme === 'dark' ? CANVAS_DARK : CANVAS_LIGHT
  // Light needs a dark-enough color (search downward); dark needs a
  // light-enough one (search upward).
  const direction = theme === 'dark' ? 1 : -1
  const solvedL = solveLightness(h, s, l, canvas, direction)
  const [r, g, b] = hslToRgb(h, s, solvedL)
  return rgbToHex(r, g, b)
}

/** Applies (or clears) the accent override on the document root for the
 *  given resolved theme. null/undefined removes the inline override, which
 *  falls back to the theme's own default blue. */
export function applyAccentColor(hex: string | null | undefined, theme: ResolvedTheme): void {
  const root = document.documentElement
  if (hex) {
    root.style.setProperty(SIGNAL_CSS_VAR, deriveSignalForTheme(hex, theme))
  } else {
    root.style.removeProperty(SIGNAL_CSS_VAR)
  }
}

/** Curated hues — swatches are a starting hue, not a fixed color; the actual
 *  applied value is still solved per theme like any custom pick. */
export const ACCENT_PRESETS: { label: string; hex: string }[] = [
  { label: 'Blue', hex: '#1d4ed8' }, // the shipped default
  { label: 'Violet', hex: '#6d28d9' },
  { label: 'Teal', hex: '#0f766e' },
  { label: 'Rose', hex: '#be123c' },
  { label: 'Amber', hex: '#a16207' },
  { label: 'Emerald', hex: '#15803d' },
]
