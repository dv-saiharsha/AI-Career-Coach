#!/usr/bin/env node
/**
 * Contrast gate for the deep-violet palette.
 *
 * Part 7 requires every body-text token to clear WCAG AA (4.5:1) against its
 * own surface, in both themes, verified by measurement rather than by eye.
 * This is that measurement. It reads the values from src/app/globals.css so
 * the check cannot drift from what actually ships.
 *
 * Exits non-zero on any failure. Run it in CI alongside typecheck and lint.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

/* The two theme blocks, sliced out by their selectors. `--` declarations are
   then read from each. */
function block(selector) {
  const start = css.indexOf(selector + ' {')
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unterminated block: ${selector}`)
}

function vars(src) {
  const out = {}
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = vars(block(':root'))
const dark = { ...light, ...vars(block(":root[data-theme='dark']")) }

const hex = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}
const lin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const lum = (h) => {
  const [r, g, b] = hex(h).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

const SURFACES = ['--canvas', '--canvas-deep', '--canvas-raise', '--canvas-elevated']
const TEXT = [
  '--ink',
  '--ink-subtle',
  '--ink-muted',
  '--ink-faint',
  '--accent-text',
  '--semantic-success',
  '--semantic-warning',
  '--semantic-danger',
]
/* Both stops of the 145deg primary gradient must carry the white label. */
const GRADIENT_STOPS = (t) => [...t['--gradient-accent'].matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])

const AA = 4.5
let failures = 0

for (const [name, t] of [
  ['dark (primary)', dark],
  ['light', light],
]) {
  console.log(`\n──── ${name} ────`)
  for (const token of TEXT) {
    const value = t[token]
    if (!value?.startsWith('#')) {
      console.log(`  ${token.padEnd(20)} SKIPPED (not a literal colour: ${value})`)
      continue
    }
    const worst = Math.min(...SURFACES.map((s) => ratio(value, t[s])))
    const ok = worst >= AA
    if (!ok) failures++
    console.log(
      `  ${token.padEnd(20)} ${value}  worst ${worst.toFixed(2)}:1  ${ok ? 'pass' : 'FAIL'}`
    )
  }
  const stops = GRADIENT_STOPS(t)
  const worstStop = Math.min(...stops.map((s) => ratio(t['--on-accent'], s)))
  const ok = worstStop >= AA
  if (!ok) failures++
  console.log(
    `  ${'on-accent on gradient'.padEnd(20)} ${stops.join(' -> ')}  worst ${worstStop.toFixed(2)}:1  ${ok ? 'pass' : 'FAIL'}`
  )
}

if (failures) {
  console.error(`\n${failures} token(s) below WCAG AA ${AA}:1. Fix before shipping.`)
  process.exit(1)
}
console.log(`\nAll text tokens clear WCAG AA ${AA}:1 on every surface, in both themes.`)
