import { createClient } from '@/lib/supabase/client'

/**
 * Two providers, deliberately.
 *
 * GitHub and LinkedIn were removed rather than hidden. Every enabled provider
 * is a way into an account, and Supabase links a new identity to an existing
 * user whenever the provider returns a matching verified email — so the set of
 * enabled providers is the set of parties trusted to vouch for an email
 * address. Keeping one nobody signs in with is unused attack surface, and
 * GitHub in particular only returns an email when the account has a verified
 * public or primary address, which made it the least reliable of the four.
 *
 * Removing them here is not the whole job: disable them in the Supabase
 * dashboard too, or the endpoints stay live even with no button pointing at
 * them.
 */
export type OAuthProvider = 'google' | 'apple'

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'apple']

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
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
  const requested = options?.next ?? '/dashboard'
  const next = /^\/(?!\/)/.test(requested) ? requested : '/dashboard'

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })

  if (error) throw error
  return data
}
