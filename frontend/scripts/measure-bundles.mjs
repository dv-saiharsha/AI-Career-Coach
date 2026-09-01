#!/usr/bin/env node
/**
 * First Load JS per route, gzipped.
 *
 * Next 16 with Turbopack prints the route table without the First Load JS
 * column that Webpack builds used to carry, so there is no build output to
 * read the budget off. This reconstructs it from what the browser is actually
 * told to fetch.
 *
 * Two sources, because the two kinds of route record it differently:
 *
 *   Prerendered (○) routes have a real .html in .next/server/app. Its script
 *   tags are exactly what a first visit downloads, so those are summed
 *   directly — no inference involved.
 *
 *   Dynamic (ƒ) routes are rendered per request and have no .html to read.
 *   Their client modules come from the route's own
 *   page_client-reference-manifest.js, mapped back to chunks.
 *
 * Sizes are gzip level 9 over the raw chunk. That is a close stand-in for
 * what a CDN serves, and slightly pessimistic against brotli, which is the
 * right direction for a budget. The noModule polyfill bundle is excluded
 * from both paths — no modern browser fetches it.
 *
 * Usage:
 *   node scripts/measure-bundles.mjs                 # table
 *   node scripts/measure-bundles.mjs --json          # machine-readable
 *   node scripts/measure-bundles.mjs --baseline f.json   # diff against a run
 *   node scripts/measure-bundles.mjs --save f.json   # write a baseline
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NEXT = path.join(ROOT, '.next')
const APP = path.join(NEXT, 'server', 'app')

/* Part 6's ceilings. Marketing is the stricter one because it is the first
   thing anyone loads and the least of it is their own choice. */
const BUDGET_MARKETING = 120
const BUDGET_APP = 180

const MARKETING = new Set([
  '/',
  '/features',
  '/pricing',
  '/how-it-works',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
])

const sizeCache = new Map()

function gzipSize(chunkPath) {
  if (sizeCache.has(chunkPath)) return sizeCache.get(chunkPath)
  let size = 0
  try {
    size = zlib.gzipSync(fs.readFileSync(chunkPath), { level: 9 }).length
  } catch {
    size = 0
  }
  sizeCache.set(chunkPath, size)
  return size
}

/** /_next/static/chunks/x.js -> <root>/.next/static/chunks/x.js */
function resolveChunk(url) {
  return path.join(NEXT, url.replace(/^\/_next\//, ''))
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Prerendered routes: read the script tags out of the emitted HTML. */
function fromHtml() {
  const routes = []
  for (const file of walk(APP).filter((f) => f.endsWith('.html'))) {
    const name = path
      .relative(APP, file)
      .replace(/\\/g, '/')
      .replace(/\.html$/, '')
      .replace(/\(([^)]+)\)\//g, '')
    if (name.startsWith('_')) continue

    /* noModule scripts are the legacy polyfill bundle. A modern browser
       never fetches them, so counting them would overstate every route by
       the same ~39 KB and make the budget meaningless. */
    const html = fs.readFileSync(file, 'utf8')
    const urls = [
      ...new Set(
        [...html.matchAll(/<script[^>]*src="(\/_next\/static\/[^"]+\.js)"[^>]*>/g)]
          .filter((m) => !/noModule/i.test(m[0]))
          .map((m) => m[1]),
      ),
    ]
    routes.push({
      route: name === 'index' ? '/' : `/${name}`,
      kind: 'static',
      chunks: urls.length,
      bytes: urls.reduce((total, url) => total + gzipSize(resolveChunk(url)), 0),
    })
  }
  return routes
}

/**
 * Dynamic routes: the client-reference manifest names every client module the
 * route pulls in, each carrying its chunk list. Union them, then add the
 * shared entry chunks every document loads regardless.
 */
function fromManifests() {
  const shared = new Set()
  const buildManifest = path.join(NEXT, 'build-manifest.json')
  if (fs.existsSync(buildManifest)) {
    const manifest = JSON.parse(fs.readFileSync(buildManifest, 'utf8'))
    // polyfillFiles is the noModule bundle — excluded here for the same
    // reason it is filtered out of the HTML path.
    for (const f of manifest.rootMainFiles ?? []) {
      shared.add(path.join(NEXT, f))
    }
  }

  const routes = []
  for (const file of walk(APP).filter((f) => f.endsWith('page_client-reference-manifest.js'))) {
    const route =
      '/' +
      path
        .relative(APP, path.dirname(file))
        .replace(/\\/g, '/')
        .replace(/\(([^)]+)\)\//g, '')

    /* The manifest is a JS file whose last statement assigns a JSON blob to
       globalThis.__RSC_MANIFEST[route]. Parse from that assignment, not from
       the first brace in the file — the first brace belongs to the
       `|| {}` fallback on the line above it. */
    const source = fs.readFileSync(file, 'utf8')
    const assignment = source.lastIndexOf('] = {')
    if (assignment === -1) continue
    const start = source.indexOf('{', assignment)
    const end = source.lastIndexOf('}')
    if (start === -1 || end === -1) continue

    let parsed
    try {
      parsed = JSON.parse(source.slice(start, end + 1))
    } catch {
      continue
    }

    const chunks = new Set(shared)
    for (const mod of Object.values(parsed.clientModules ?? {})) {
      for (const chunk of mod.chunks ?? []) {
        // Already absolute request paths (/_next/static/chunks/x.js).
        if (typeof chunk === 'string' && chunk.endsWith('.js')) {
          chunks.add(resolveChunk(chunk))
        }
      }
    }

    let bytes = 0
    for (const chunk of chunks) bytes += gzipSize(chunk)
    routes.push({ route: route === '/' ? '/' : route, kind: 'dynamic', chunks: chunks.size, bytes })
  }
  return routes
}

function budgetFor(route) {
  return MARKETING.has(route) ? BUDGET_MARKETING : BUDGET_APP
}

function collect() {
  const seen = new Map()
  for (const row of [...fromHtml(), ...fromManifests()]) {
    // A route emitted as HTML is measured from the HTML — that is the ground
    // truth for what ships, where the manifest is a reconstruction.
    if (seen.has(row.route) && seen.get(row.route).kind === 'static') continue
    seen.set(row.route, row)
  }
  return [...seen.values()]
    .map((r) => ({ ...r, kb: +(r.bytes / 1024).toFixed(1), budget: budgetFor(r.route) }))
    .sort((a, b) => b.kb - a.kb)
}

function main() {
  if (!fs.existsSync(APP)) {
    console.error('No build found. Run `npm run build` first.')
    process.exit(1)
  }

  const rows = collect()
  const args = process.argv.slice(2)

  const saveAt = args.indexOf('--save')
  if (saveAt !== -1 && args[saveAt + 1]) {
    fs.writeFileSync(args[saveAt + 1], JSON.stringify(rows, null, 2))
    console.log(`Baseline written to ${args[saveAt + 1]}`)
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  let baseline = null
  const baseAt = args.indexOf('--baseline')
  if (baseAt !== -1 && args[baseAt + 1] && fs.existsSync(args[baseAt + 1])) {
    baseline = new Map(
      JSON.parse(fs.readFileSync(args[baseAt + 1], 'utf8')).map((r) => [r.route, r.kb]),
    )
  }

  console.log('\nFirst Load JS, gzipped\n')
  const head = `${'ROUTE'.padEnd(24)}${'JS'.padStart(9)}${'BUDGET'.padStart(9)}${'OVER'.padStart(9)}`
  console.log(baseline ? `${head}${'CHANGE'.padStart(10)}` : head)
  console.log('-'.repeat(baseline ? 61 : 51))

  let over = 0
  for (const row of rows) {
    const excess = row.kb - row.budget
    if (excess > 0) over++
    let line =
      row.route.padEnd(24) +
      `${row.kb}`.padStart(9) +
      `${row.budget}`.padStart(9) +
      (excess > 0 ? `+${excess.toFixed(1)}` : 'ok').padStart(9)
    if (baseline) {
      const was = baseline.get(row.route)
      const delta = was === undefined ? null : row.kb - was
      line +=
        delta === null
          ? 'new'.padStart(10)
          : (delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`).padStart(10)
    }
    console.log(line)
  }

  console.log(
    `\n${rows.length} routes, ${over} over budget. ` +
      `Marketing ceiling ${BUDGET_MARKETING} KB, app ceiling ${BUDGET_APP} KB.\n`,
  )
}

main()
