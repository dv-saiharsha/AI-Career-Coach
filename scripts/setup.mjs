#!/usr/bin/env node
/**
 * One-command onboarding: `npm run setup` from the repo root.
 *
 * Creates env files from the templates, builds the backend virtualenv and
 * installs both dependency sets. Every step is skippable and idempotent, so
 * re-running after a pull is safe and cheap.
 *
 * Deliberately does NOT run database migrations. The Supabase database is
 * shared across the team, so applying a schema change is a decision a person
 * makes, not something a setup script does on their behalf.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'

const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s)
const step = (n, s) => console.log(`\n${dim(`[${n}/4]`)} ${s}`)

function run(cmd, args, cwd) {
  // shell on Windows: Node >= 20 throws EINVAL spawning a .cmd without one.
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env, shell: isWin && cmd.endsWith('.cmd') })
  if (r.error) {
    console.error(`\nFailed to run ${cmd}: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// ── 1. env files ─────────────────────────────────────────────────────────────
step(1, 'Environment files')
let createdEnv = false
for (const [template, target] of [
  ['frontend/.env.local.example', 'frontend/.env.local'],
  ['backend/.env.example', 'backend/.env'],
]) {
  const src = join(root, template)
  const dst = join(root, target)
  if (!existsSync(src)) {
    console.log(`  !  ${target.padEnd(28)} template missing`)
  } else if (existsSync(dst)) {
    console.log(`  =  ${target.padEnd(28)} already exists, left untouched`)
  } else {
    copyFileSync(src, dst)
    console.log(`  +  ${target.padEnd(28)} created`)
    createdEnv = true
  }
}

// ── 2. python venv ───────────────────────────────────────────────────────────
step(2, 'Python virtualenv')
const python = isWin
  ? join(root, 'backend', '.venv', 'Scripts', 'python.exe')
  : join(root, 'backend', '.venv', 'bin', 'python')

if (existsSync(python)) {
  console.log('  =  backend/.venv already exists')
} else {
  console.log('  +  creating backend/.venv')
  run(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv'], join(root, 'backend'))
}

// ── 3. backend deps ──────────────────────────────────────────────────────────
step(3, 'Backend dependencies')
run(python, ['-m', 'pip', 'install', '--upgrade', '--quiet', 'pip', 'setuptools', 'wheel'], join(root, 'backend'))
run(python, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], join(root, 'backend'))
console.log('  ok backend/requirements.txt installed')

// ── 4. frontend deps ─────────────────────────────────────────────────────────
step(4, 'Frontend dependencies')
run(npm, ['ci'], join(root, 'frontend'))

console.log(`\n${dim('Setup complete.')}`)
if (createdEnv) {
  console.log(
    '\nFill in the new env files before starting:\n' +
      '  backend/.env         DB_URL, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SECRET_API_KEY\n' +
      '  frontend/.env.local  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\n' +
      '\nAsk a teammate for shared dev credentials — the database is shared, and a\n' +
      'fresh Supabase project will not have the schema.'
  )
}
console.log(
  '\nThen:\n' +
    '  npm run migrate   apply database migrations (review them first — shared DB)\n' +
    '  npm run dev       start backend + frontend together\n'
)
