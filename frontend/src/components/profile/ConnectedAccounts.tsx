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

      <p className="pt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Google is the only sign-in provider ApplyCenter accepts. Each enabled provider is a party
        trusted to vouch for your email address, so the list is kept as short as it can be.
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
