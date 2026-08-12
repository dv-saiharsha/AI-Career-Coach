#!/usr/bin/env node
/**
 * Runs a command with the backend virtualenv's Python, from backend/.
 *
 *   node scripts/backend.mjs -m pytest -q
 *   node scripts/backend.mjs -m alembic upgrade head
 *
 * Exists so root scripts don't hardcode `.venv\Scripts\python.exe`, which is
 * wrong on macOS and Linux, and so a missing venv reports the fix rather than
 * an ENOENT.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const python = isWin
  ? join(root, 'backend', '.venv', 'Scripts', 'python.exe')
  : join(root, 'backend', '.venv', 'bin', 'python')

if (!existsSync(python)) {
  console.error('\nNo Python virtualenv at backend/.venv. Create it with:\n')
  console.error(
    isWin
      ? '  cd backend\n  python -m venv .venv\n  .venv\\Scripts\\python.exe -m pip install -r requirements.txt\n'
      : '  cd backend\n  python3 -m venv .venv\n  .venv/bin/python -m pip install -r requirements.txt\n'
  )
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/backend.mjs <args passed to python>')
  process.exit(1)
}

const child = spawn(python, args, { cwd: join(root, 'backend'), stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
child.on('error', (err) => {
  console.error(`Failed to run backend command: ${err.message}`)
  process.exit(1)
})
