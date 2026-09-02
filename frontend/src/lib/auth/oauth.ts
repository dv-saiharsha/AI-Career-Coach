import { createClient } from '@/lib/supabase/client'

/**
 * One provider, deliberately.
 *
 * Every enabled provider is a party trusted to vouch for an email address:
 * Supabase links a new identity to an existing user whenever the provider
 * returns a matching verified email. So an enabled provider nobody signs in
 * with is unused attack surface pointed at every account, which is why GitHub,
 * LinkedIn and Apple were removed rather than hidden.
 *
 * Apple went last for a practical reason as well as a security one: its client
 * secret is a JWT that Apple caps at six months, so it fails silently and all
 * at once with no code change to blame. Shipping it needs an owner for that
 * renewal, not just the credentials.
 *
 * Removing them here is not the whole job — disable each in the Supabase
 * dashboard too, or the endpoints stay live with nothing pointing at them.
 */
export type OAuthProvider = 'google'

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google']

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
}

/**
 * Starts a provider redirect flow.
 *
 * On success the browser navigates away, so this does not resolve in any
 * meaningful sense — treat anything after the await as the failure path and
 * keep the caller's loading state set until navigation happens.
 *
 * Account linking is deliberately left to Supabase: when the provider returns
 * a *verified* email that matches an existing user, Supabase attaches the new
 * identity to that user rather than creating a second account. That behaviour
 * is only safe while "Allow unverified email logins" is off in the dashboard —
 * otherwise anyone who can create an account at any enabled provider using a
 * victim's address inherits the victim's ApplyCenter account. See docs/oauth-setup.md.
 */
export async function signInWithOAuth(
  provider: OAuthProvider,
  options?: { next?: string }
) {
  const supabase = createClient()

  // Relative, single-leading-slash only. The callback validates this again
  // server-side; this check just avoids sending an obviously bad value.
  const requested = options?.next ?? '/jobs'
  const next = /^\/(?!\/)/.test(requested) ? requested : '/jobs'

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })

  if (error) throw error
  return data
}
