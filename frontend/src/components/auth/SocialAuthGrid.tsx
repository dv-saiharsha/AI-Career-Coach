'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import {
  signInWithOAuth,
  OAUTH_PROVIDERS,
  PROVIDER_LABELS,
  type OAuthProvider,
} from '@/lib/auth/oauth'
import { ease } from '@/lib/motion'
import { cn } from '@/lib/utils'

/* Brand marks as inline SVG. currentColor everywhere except Google, whose
   four-colour mark is a trademark requirement — it must not be recoloured, so
   it is the one exception to the token rule and works on cream and obsidian
   alike. */
const ICONS: Record<OAuthProvider, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.55-2.03-6.46-4.76H1.69v2.98A11.5 11.5 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.54 14.66a6.9 6.9 0 0 1 0-4.4V7.28H1.69a11.5 11.5 0 0 0 0 10.36l3.85-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.2 15.1 0 12 0A11.5 11.5 0 0 0 1.69 7.28l3.85 2.98C6.45 7.53 9 4.75 12 4.75Z"
      />
    </svg>
  ),
}

export interface SocialAuthGridProps {
  /** Where to land after a successful sign-in. */
  next?: string
  /** Copy on the divider. Signup and signin read differently. */
  dividerLabel?: string
  className?: string
}

/**
 * Provider sign-in buttons.
 *
 * Every provider ends at the same place, so there is no separate "sign up with"
 * flow: an unknown verified email creates an account, a known one links to it.
 */
export function SocialAuthGrid({
  next = '/dashboard',
  dividerLabel = 'or continue with',
  className,
}: SocialAuthGridProps) {
  const [pending, setPending] = React.useState<OAuthProvider | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function start(provider: OAuthProvider) {
    setError(null)
    setPending(provider)
    try {
      await signInWithOAuth(provider, { next })
      // On success the browser is navigating away — deliberately leave the
      // spinner running so the button cannot be double-fired mid-redirect.
    } catch (err) {
      setPending(null)
      // "Unsupported provider: provider is not enabled" is what Supabase
      // returns when a provider is switched off in the dashboard. Shown raw
      // it reads as a bug in the site; named plainly it tells the user this
      // route is unavailable and to use the other one.
      const raw = err instanceof Error ? err.message : ''
      const notEnabled = /not enabled|unsupported provider/i.test(raw)
      setError(
        notEnabled
          ? `${PROVIDER_LABELS[provider]} sign-in isn't available yet. Use the other option for now.`
          : raw || `Could not reach ${PROVIDER_LABELS[provider]}. Try again.`
      )
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          {dividerLabel}
        </span>
        <Separator className="flex-1" />
      </div>

      {/* Columns follow the provider count: a fixed two-column grid left
          the single remaining button at half width against empty space. */}
      <div className={cn('grid gap-3', OAUTH_PROVIDERS.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {OAUTH_PROVIDERS.map((provider) => {
          const busy = pending === provider
          return (
            <Button
              key={provider}
              type="button"
              variant="outline"
              onClick={() => start(provider)}
              disabled={pending !== null}
              aria-label={`Continue with ${PROVIDER_LABELS[provider]}`}
              className="justify-center gap-2.5"
            >
              {busy ? <Spinner label={`Connecting to ${PROVIDER_LABELS[provider]}`} /> : ICONS[provider]}
              <span>{PROVIDER_LABELS[provider]}</span>
            </Button>
          )
        })}
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={ease}
            className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
