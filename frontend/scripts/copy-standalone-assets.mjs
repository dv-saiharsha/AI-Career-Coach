/**
 * Copy static assets into the standalone build.
 *
 * `output: "standalone"` in next.config.ts emits .next/standalone/server.js
 * with a traced, minimal node_modules — which is the whole point, and why the
 * Docker image is small. What it deliberately does NOT copy is .next/static
 * and public/, on the grounds that a real deployment usually serves those
 * from a CDN.
 *
 * The Dockerfile already handles that (it copies both in as separate layers).
 * Running the same server locally did not, so every CSS and JS chunk 404'd and
 * the page came up unstyled or blank. `next start` prints a warning steering
 * you toward `node .next/standalone/server.js`, so that is a path people
 * actually take, and it was broken.
 *
 * This runs as postbuild so the local standalone output matches what Docker
 * assembles. It is additive — nothing is deleted, and it is a no-op when no
 * standalone build exists (a plain `next build` without the standalone flag,
 * or a build that failed before emitting one).
 */

import { cp, access } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

if (!(await exists(standalone))) {
  // Not an error: a build without `output: "standalone"` has nothing to fill.
  console.log('No standalone output — skipping asset copy.')
  process.exit(0)
}

const copies = [
  { from: join(root, '.next', 'static'), to: join(standalone, '.next', 'static'), label: '.next/static' },
  { from: join(root, 'public'), to: join(standalone, 'public'), label: 'public' },
]

for (const { from, to, label } of copies) {
  if (!(await exists(from))) {
    // public/ is genuinely optional; a project without one is not broken.
    console.log(`Skipped ${label} (not present).`)
    continue
  }
  await cp(from, to, { recursive: true, force: true })
  console.log(`Copied ${label} into the standalone build.`)
}
