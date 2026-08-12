#!/usr/bin/env node
/**
 * Reports which auth providers Supabase currently has enabled.
 *
 *   npm run check:oauth
 *
 * Reads frontend/.env.local and queries the project's public auth settings, so
 * it needs no admin token — the publishable key is enough. Run it after
 * enabling each provider to confirm the dashboard actually saved, rather than
 * finding out from a failed sign-in.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'frontend', '.env.local')

if (!existsSync(envPath)) {
  console.error('\nfrontend/.env.local not found. Run `npm run setup` first.\n')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('\nNEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY missing from frontend/.env.local\n')
  process.exit(1)
}

const TARGETS = [
  ['google', 'Google'],
  ['github', 'GitHub'],
  ['linkedin_oidc', 'LinkedIn (OIDC)'],
  ['apple', 'Apple'],
]

const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).catch((e) => {
  console.error(`\nCould not reach Supabase: ${e.message}\n`)
  process.exit(1)
})

if (!res.ok) {
  console.error(`\nSupabase returned ${res.status}. Is the publishable key correct?\n`)
  process.exit(1)
}

const settings = await res.json()
const ext = settings.external ?? {}

console.log(`\nProject: ${url}`)
console.log(`Callback to register in every provider console:`)
console.log(`  ${url}/auth/v1/callback\n`)

let enabled = 0
for (const [id, label] of TARGETS) {
  const on = Boolean(ext[id])
  if (on) enabled++
  console.log(`  ${on ? '✓' : '·'}  ${label.padEnd(16)} ${on ? 'enabled' : 'not enabled'}`)
}
console.log(`\n  ${enabled}/${TARGETS.length} social providers enabled`)

// Account linking is only safe while emails are actually verified. With
// autoconfirm on, anyone who registers at an enabled provider using someone
// else's address inherits that account.
if (settings.mailer_autoconfirm) {
  console.log(
    '\n  WARNING: mailer_autoconfirm is ON. Emails are not verified, which makes\n' +
      '  automatic account linking an account-takeover path. Turn off\n' +
      '  "Allow unverified email logins" before enabling social providers.'
  )
} else {
  console.log('\n  ✓  Emails are verified (mailer_autoconfirm off) — linking is safe.')
}

console.log('\nSetup steps: docs/oauth-setup.md\n')
