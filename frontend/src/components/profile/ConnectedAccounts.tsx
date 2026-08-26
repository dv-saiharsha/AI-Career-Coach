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

      {/*
        LinkedIn is rendered as unavailable rather than as a button, because
        the integration people expect from it cannot currently be built.

        LinkedIn's generally-available OAuth product is Sign In with LinkedIn
        (OpenID Connect), whose scopes — openid, profile, email — return a
        name, an email and a picture. Positions and endorsements sit behind
        r_fullprofile and the Talent/Marketing partner programmes, which are
        not self-serve. So "import your work history" is not a matter of
        wiring up a button; the scope does not exist to request.

        Shipping the button anyway would mean either a dead control or one
        that connects an account and then imports nothing — and the user finds
        out only after granting access to their LinkedIn profile.
      */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-dashed border-[var(--color-canvas-line)] p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-canvas-deep)] text-[var(--color-ink-faint)]">
            <span className="text-xs font-semibold lowercase">in</span>
          </span>
          <div>
            <p className="text-xs font-semibold text-[var(--color-ink)]">LinkedIn</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              Importing work history would need a LinkedIn partner scope that isn&apos;t open to
              general applications. Until that changes, uploading your resume gets your roles in
              faster than LinkedIn would — the builder reads them out of the file.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-canvas-deep)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-ink-faint)]">
          Unavailable
        </span>
      </div>
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
