#!/usr/bin/env node
/**
 * Runs the backend and frontend together as one foreground process.
 *
 *   node scripts/run.mjs          dev  — uvicorn --reload + next dev
 *   node scripts/run.mjs --prod   prod — uvicorn + next start (needs a build)
 *
 * Deliberately dependency-free. Pulling in concurrently would mean a root
 * package-lock.json and a root node_modules for one utility, and would add an
 * `npm install` at the repo root to the onboarding path.
 *
 * Behaviour that matters:
 *   - Preflights the venv and node_modules and explains the fix, rather than
 *     letting ENOENT surface as a stack trace.
 *   - Output is line-prefixed per service so interleaved logs stay readable.
 *   - Ctrl+C stops both. If either exits on its own, the other is stopped too,
 *     so a crashed backend never leaves an orphaned frontend behind.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const prod = process.argv.includes('--prod')
const isWin = process.platform === 'win32'

const BACKEND_PORT = process.env.BACKEND_PORT || '8000'
const FRONTEND_PORT = process.env.PORT || '3000'

const colors = { backend: '\x1b[35m', frontend: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' }
const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (c, s) => (useColor ? `${c}${s}${colors.reset}` : s)

function die(message, fix) {
  console.error(`\n${paint('\x1b[31m', 'Cannot start:')} ${message}\n`)
  if (fix) console.error(`${fix}\n`)
  process.exit(1)
}

// ── Preflight ────────────────────────────────────────────────────────────────
const venvPython = isWin
  ? join(root, 'backend', '.venv', 'Scripts', 'python.exe')
  : join(root, 'backend', '.venv', 'bin', 'python')

if (!existsSync(venvPython)) {
  die(
    `no Python virtualenv at backend/.venv`,
    isWin
      ? '  cd backend\n  python -m venv .venv\n  .venv\\Scripts\\python.exe -m pip install -r requirements.txt'
      : '  cd backend\n  python3 -m venv .venv\n  .venv/bin/python -m pip install -r requirements.txt'
  )
}

if (!existsSync(join(root, 'frontend', 'node_modules'))) {
  die('frontend dependencies are not installed', '  cd frontend\n  npm ci')
}

if (!existsSync(join(root, 'backend', '.env'))) {
  console.warn(
    paint(colors.dim, 'warning: backend/.env is missing — run scripts/setup-env.sh (or .bat) and fill it in\n')
  )
}

if (prod && !existsSync(join(root, 'frontend', '.next'))) {
  die('no production build found', '  npm run build')
}

// ── Launch ───────────────────────────────────────────────────────────────────

/**
 * The dev backend listens on every interface, not just loopback.
 *
 * uvicorn defaults to 127.0.0.1 and this script did not override it — correct
 * for the web app, and it makes the mobile app impossible to develop against.
 * A phone on the same Wi-Fi reaches the machine by its LAN address, where
 * nothing was listening, so every request failed as "couldn't reach
 * ApplyCenter" and read like a network fault rather than a bind address.
 *
 * The trade is real: this exposes the dev API to the local network, so on a
 * shared or public one anybody on it can reach the port. Every route still
 * requires a Supabase JWT, and this is the development path only — the
 * production container publishes its port explicitly. Set
 * BACKEND_HOST=127.0.0.1 to opt back out.
 */
const BACKEND_HOST = process.env.BACKEND_HOST ?? (prod ? '127.0.0.1' : '0.0.0.0')

const uvicornArgs = ['-m', 'uvicorn', 'app.main:app', '--port', BACKEND_PORT, '--host', BACKEND_HOST]
if (!prod) uvicornArgs.push('--reload')

/** First non-internal IPv4 address, for the "reach this from a phone" line. */
function lanAddress() {
  const candidates = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      /* WSL and Docker install virtual adapters whose addresses look local
         and route nowhere a phone can follow. Next advertises one of these as
         its Network URL, which is where the confusion starts. Ranked last
         rather than hidden: on a machine with no other adapter, a
         wrong-looking address still beats no address at all. */
      candidates.push({ address: addr.address, virtual: /vEthernet|WSL|Docker|Hyper-V/i.test(name) })
    }
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual))
  return candidates[0]?.address ?? null
}

const services = [
  { name: 'backend', color: colors.backend, cmd: venvPython, args: uvicornArgs, cwd: join(root, 'backend') },
  {
    name: 'frontend',
    color: colors.frontend,
    cmd: isWin ? 'npm.cmd' : 'npm',
    args: ['run', prod ? 'start' : 'dev'],
    cwd: join(root, 'frontend'),
    // Node >= 20 refuses to spawn a .cmd without a shell (CVE-2024-27980
    // hardening) and throws EINVAL. npm on Windows *is* npm.cmd.
    shell: isWin,
  },
]

const children = []
let shuttingDown = false

function stopAll(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      // taskkill: on Windows, killing npm.cmd leaves the node child running.
      if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    }
  }
  setTimeout(() => process.exit(code), 300)
}

console.log(
  `\n${paint(colors.dim, prod ? 'Starting ApplyCenter (production)…' : 'Starting ApplyCenter (development)…')}\n` +
    `  backend   http://localhost:${BACKEND_PORT}  ${paint(colors.dim, `(docs at /docs)`)}\n` +
    `  frontend  http://localhost:${FRONTEND_PORT}\n` +
    (BACKEND_HOST === '0.0.0.0' && lanAddress()
      ? `  mobile    http://${lanAddress()}:${BACKEND_PORT}/api  ${paint(colors.dim, '(put this in mobile/.env as EXPO_PUBLIC_API_URL)')}\n`
      : '') +
    `${paint(colors.dim, '  Ctrl+C stops both.')}\n`
)

for (const svc of services) {
  const child = spawn(svc.cmd, svc.args, { cwd: svc.cwd, env: process.env, shell: svc.shell ?? false })
  children.push(child)

  const label = paint(svc.color, svc.name.padEnd(8))
  const relay = (stream, out) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) out.write(`${label} │ ${line}\n`)
    })
  }
  relay(child.stdout, process.stdout)
  relay(child.stderr, process.stderr)

  child.on('error', (err) => {
    console.error(`${label} │ failed to start: ${err.message}`)
    stopAll(1)
  })

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(`${label} │ ${paint(colors.dim, `exited (${code ?? 'signal'}), stopping the other service`)}`)
    stopAll(code ?? 1)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0))
