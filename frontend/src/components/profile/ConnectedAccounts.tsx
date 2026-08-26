'use client'

import { CheckCircle2, Mail, ShieldCheck } from 'lucide-react'

import { useAuth } from '@/lib/AuthContext'

/**
 * Which auth providers are actually linked to this account.
 *
 * Every "connected" state here is read from Supabase's identities array, not
 * held in local state. The version that toggles a boolean on click renders
 * "Connected (Sync Active)" the instant you press it, while nothing has been
 * connected and nothing is syncing — which is a claim about the user's data,
 * not a styling choice.
 */
export function ConnectedAccounts() {
  const { user } = useAuth()
  const providers = user?.providers ?? []

  return (
    <div className="glass-card space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
        <ShieldCheck strokeWidth={1.5} className="h-4 w-4 text-[var(--color-ink-faint)]" />
        Connected accounts
      </h2>

      <ProviderRow
        icon={<span className="text-xs font-semibold">G</span>}
        name="Google"
        detail={
          providers.includes('google')
            ? 'Signing you in, and the source of your name and photo'
            : 'Not linked to this account'
        }
        connected={providers.includes('google')}
      />

      <ProviderRow
        icon={<Mail strokeWidth={1.5} className="h-4 w-4" />}
        name="Email and password"
        detail={
          providers.includes('email')
            ? `Sign in with ${user?.email}`
            : 'This account has no password set'
        }
        connected={providers.includes('email')}
      />

      {/* Apple is listed because it is an enabled sign-in route, not because
          this account uses it. `passed` here is read from the identities
          array like the others — a row that claimed "Active" from local state
          would be asserting a link that may not exist. */}
      <ProviderRow
        icon={
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M17.05 12.54c-.03-2.75 2.25-4.07 2.35-4.13-1.28-1.87-3.27-2.13-3.98-2.16-1.7-.17-3.31 1-4.17 1-.86 0-2.19-.98-3.6-.95-1.85.03-3.55 1.07-4.5 2.72-1.92 3.33-.49 8.26 1.38 10.96.91 1.32 2 2.8 3.42 2.75 1.37-.06 1.89-.89 3.55-.89 1.65 0 2.12.89 3.57.86 1.47-.02 2.41-1.34 3.31-2.67 1.04-1.53 1.47-3.01 1.5-3.09-.03-.01-2.88-1.1-2.91-4.38l.08-.02ZM14.3 4.3c.76-.92 1.27-2.2 1.13-3.47-1.09.04-2.41.72-3.19 1.64-.7.81-1.31 2.11-1.15 3.36 1.21.09 2.45-.62 3.21-1.53Z" />
          </svg>
        }
        name="Apple"
        detail={
          providers.includes('apple')
            ? 'Signing you in with Apple'
            : 'Not linked to this account'
        }
        connected={providers.includes('apple')}
      />

      <p className="pt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Google and Apple are the only sign-in providers ApplyCenter accepts. Each enabled provider
        is a party trusted to vouch for your email address, so the list is kept short on purpose.
      </p>

    </div>
  )
}

function ProviderRow({
  icon,
  name,
  detail,
  connected,
}: {
  icon: React.ReactNode
  name: string
  detail: string
  connected: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-canvas-line)] p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-canvas-deep)] text-[var(--color-ink-subtle)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-ink)]">{name}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-ink-faint)]">{detail}</p>
        </div>
      </div>
      {connected ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-success)]/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--color-success)]">
          <CheckCircle2 strokeWidth={2} className="h-3 w-3" />
          Active
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-[var(--color-canvas-deep)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-ink-faint)]">
          Not linked
        </span>
      )}
    </div>
  )
}
