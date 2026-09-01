import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Deliberately narrow.
 *
 * This exists because four defects have now passed `tsc`, `eslint` and a
 * green production build and were only found by a human loading a page. The
 * suite covers the two shapes that actually caused them, and is not an
 * attempt at coverage:
 *
 *   1. List rendering over data that repeats. TrendChart keyed five element
 *      lists on a date; two scans on the same day silently dropped points.
 *   2. CSS that degrades behind a guard. The nav capsule's background lived
 *      inside a prefers-reduced-motion guard, so reduced-motion users got a
 *      transparent sticky nav.
 *
 * Neither is visible to static analysis, and the second is not reliably
 * visible to visual review either — nobody reviews with reduced motion on.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
