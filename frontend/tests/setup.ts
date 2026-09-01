import '@testing-library/jest-dom/vitest'
import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

/**
 * React reports duplicate keys through console.error and then carries on
 * rendering, which is why the TrendChart bug shipped: nothing failed, the
 * chart just quietly had fewer points than the data.
 *
 * This turns that specific warning into a test failure. It is scoped to the
 * key warnings rather than all console.error, so a component that
 * legitimately logs an error in a test does not fail for it.
 */
const KEY_WARNINGS = ['same key', 'unique "key"', 'Each child in a list']

expect.extend({
  toHaveRenderedWithoutKeyWarnings(calls: unknown[][]) {
    const offending = calls.filter((args) =>
      KEY_WARNINGS.some((needle) => String(args[0] ?? '').includes(needle)),
    )
    return {
      pass: offending.length === 0,
      message: () =>
        offending.length === 0
          ? 'expected a React key warning, but none was logged'
          : `React logged ${offending.length} key warning(s):\n${offending
              .map((a) => '  ' + String(a[0]).split('\n')[0])
              .join('\n')}`,
    }
  },
})

declare module 'vitest' {
  interface Assertion {
    toHaveRenderedWithoutKeyWarnings(): void
  }
}
