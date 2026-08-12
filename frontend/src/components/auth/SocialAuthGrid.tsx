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
  linkedin_oidc: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05a3.75 3.75 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.6-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3Z" />
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.75 2.25-4.07 2.35-4.13-1.28-1.87-3.27-2.13-3.98-2.16-1.7-.17-3.31 1-4.17 1-.86 0-2.19-.98-3.6-.95-1.85.03-3.55 1.07-4.5 2.72-1.92 3.33-.49 8.26 1.38 10.96.91 1.32 2 2.8 3.42 2.75 1.37-.06 1.89-.89 3.55-.89 1.65 0 2.12.89 3.57.86 1.47-.02 2.41-1.34 3.31-2.67 1.04-1.53 1.47-3.01 1.5-3.09-.03-.01-2.88-1.1-2.91-4.38l.08-.02ZM14.3 4.3c.76-.92 1.27-2.2 1.13-3.47-1.09.04-2.41.72-3.19 1.64-.7.81-1.31 2.11-1.15 3.36 1.21.09 2.45-.62 3.21-1.53Z" />
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
      setError(
        err instanceof Error
          ? err.message
          : `Could not reach ${PROVIDER_LABELS[provider]}. Try again.`
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

      <div className="grid grid-cols-2 gap-3">
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
