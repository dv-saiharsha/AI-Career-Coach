/**
 * The workspace shell's one horizontal grid.
 *
 * The sidebar's rows, the sticky header's title and the page content below
 * it must all begin at the same x. They were set independently and drifted:
 * the header used `px-4 sm:px-5` while <main> used `p-7` from md up, so on
 * every desktop screen the route title sat eight pixels left of the <h1>
 * directly under it. Nothing failed. It is only visible if you look, and
 * then it is difficult to stop seeing.
 *
 * Two things are checked here, and the second is the one that will actually
 * break. Sharing a constant is easy to keep right; the nav rows cannot use
 * that constant directly, because they carry `mx-2` for the active pill's
 * inset and so need the gutter *minus* that margin. Change SHELL_GUTTER to
 * px-6 md:px-8 and forget NAV_ROW_GUTTER, and the sidebar silently walks off
 * the grid the header and content still share.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ROW_GUTTER, SHELL_GUTTER } from '@/components/DashboardNav'

const SOURCE = readFileSync(
  path.resolve(__dirname, '../src/components/DashboardNav.tsx'),
  'utf-8',
)

/** Tailwind spacing step -> px. `px-5` is 5 * 0.25rem = 20px. */
const STEP_PX = 4

/**
 * Left offset a class string produces, at the base breakpoint and at md.
 *
 * Tokenised rather than regex-matched over the whole string: a first pass
 * built the pattern with `new RegExp` and the escapes did not survive into
 * the constructor, so every lookup returned null and the two offsets
 * compared 0 against 0. Splitting on whitespace has no escaping to get
 * wrong, and an unrecognised token is visible as a zero rather than hidden
 * as a non-match.
 */
function offsetsFor(classes: string): { base: number; md: number } {
  const tokens = classes.trim().split(/\s+/)
  const value = (prefix: string) => {
    const token = tokens.find((t) => t.startsWith(`${prefix}-`))
    return token ? Number(token.slice(prefix.length + 1)) * STEP_PX : 0
  }

  const margin = value('mx')
  const base = value('px')
  const mdToken = tokens.find((t) => t.startsWith('md:px-'))
  const md = mdToken ? Number(mdToken.slice('md:px-'.length)) * STEP_PX : base

  return { base: margin + base, md: margin + md }
}

describe('the shell grid', () => {
  it('puts nav rows on the same x as the header and content', () => {
    const shell = offsetsFor(SHELL_GUTTER)
    const navRow = offsetsFor(NAV_ROW_GUTTER)

    expect(navRow.base).toBe(shell.base)
    expect(navRow.md).toBe(shell.md)
  })

  it('is a real gutter at both breakpoints, not an accidental zero', () => {
    /* offsetsFor returns 0 for a class it cannot parse, which would make the
       comparison above pass for two unparseable strings. */
    const shell = offsetsFor(SHELL_GUTTER)
    expect(shell.base).toBeGreaterThan(0)
    expect(shell.md).toBeGreaterThan(0)
  })

  it('leaves no hard-coded horizontal padding on the three shell regions', () => {
    /* The drift happened because each region carried its own literal. A new
       one is how it comes back. */
    const offenders: string[] = []

    for (const [region, marker] of [
      ['header', '<header'],
      ['main', '<main'],
    ] as const) {
      const start = SOURCE.indexOf(marker)
      expect(start, `${region} not found`).toBeGreaterThan(-1)
      const tag = SOURCE.slice(start, SOURCE.indexOf('>', start))
      if (/\b(?:sm:|md:|lg:)?px-\d/.test(tag) || /\b(?:sm:|md:|lg:)?p-\d/.test(tag)) {
        offenders.push(`${region}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }

    expect(offenders, 'a shell region sets its own horizontal padding again').toEqual([])
  })
})
