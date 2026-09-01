import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

/* Regression suite for 931dd32.
 *
 * The nav capsule's background lived on the same ::before as its scroll-driven
 * shadow, and the whole rule sat inside `@supports (animation-timeline:
 * scroll())` and `prefers-reduced-motion: no-preference`. Out of either guard
 * the pseudo-element did not exist, so the sticky nav had no surface at all
 * and page content scrolled through the links.
 *
 * That is invisible to typecheck and lint, and it is close to invisible to
 * visual review too: nobody reviews with reduced motion turned on. So it is
 * asserted against the *compiled* stylesheet rather than the source, because
 * what matters is which rules survive the cascade, not how they were written.
 */

const ROOT = path.resolve(__dirname, '..')
let css = ''

beforeAll(async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8')
  const result = await postcss([tailwind()]).process(source, {
    from: path.join(ROOT, 'src/app/globals.css'),
  })
  css = result.css
}, 60_000)

/** The declaration blocks for a selector that sit outside every at-rule. */
function unconditionalBlocks(selector: string): string[] {
  const root = postcss.parse(css)
  const blocks: string[] = []
  root.walkRules((rule) => {
    if (rule.parent?.type !== 'root') return
    const matches = rule.selectors?.some((s) => s.replace(/::/g, ':').trim() === selector)
    if (matches) blocks.push(rule.toString())
  })
  return blocks
}

describe('CSS that must survive every guard', () => {
  it('gives the nav capsule a surface outside any at-rule', () => {
    const blocks = unconditionalBlocks('.nav-capsule:before')
    expect(blocks.length).toBeGreaterThan(0)

    const combined = blocks.join('\n')
    // Without these three the sticky nav is transparent.
    expect(combined).toMatch(/content\s*:/)
    expect(combined).toMatch(/background\s*:/)
    expect(combined).toMatch(/box-shadow\s*:/)
  })

  it('keeps only the fade behind the scroll-driven guard', () => {
    const root = postcss.parse(css)
    let guarded = ''
    root.walkAtRules('supports', (at) => {
      if (!at.params.includes('animation-timeline')) return
      at.walkRules((rule) => {
        if (rule.selector.includes('nav-capsule')) guarded += rule.toString() + '\n'
      })
    })

    expect(guarded).toMatch(/animation-timeline\s*:/)
    // The surface must not be re-declared here, or the guard owns it again.
    expect(guarded).not.toMatch(/background\s*:/)
    expect(guarded).not.toMatch(/content\s*:/)
  })

  it('hides revealable content only where scripting can reveal it again', () => {
    // The reveal system sets opacity:0 on [data-reveal]. If that ever escapes
    // its `scripting: enabled` guard, content becomes permanently invisible
    // to anyone whose JavaScript failed to load.
    const blocks = unconditionalBlocks('[data-reveal]')
    for (const block of blocks) {
      expect(block).not.toMatch(/opacity\s*:\s*0/)
    }

    const root = postcss.parse(css)
    let guarded = false
    root.walkAtRules('media', (at) => {
      if (!at.params.includes('scripting')) return
      at.walkRules((rule) => {
        if (rule.selector.includes('data-reveal') && rule.toString().includes('opacity')) {
          guarded = true
        }
      })
    })
    expect(guarded).toBe(true)
  })
})
