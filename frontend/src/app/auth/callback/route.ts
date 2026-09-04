import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Landing point for every Supabase redirect flow: signup confirmation,
 * password reset, and social sign-in. Supabase sends the user here with a
 * `code`, which is exchanged server-side for a session cookie (PKCE), then we
 * continue to wherever the flow needs to go.
 */

/**
 * `next` arrives from the query string, so it is attacker-controlled. Only a
 * relative path with a single leading slash is allowed: `//evil.com` and
 * `/\evil.com` are both protocol-relative URLs that browsers resolve to
 * another origin, which would turn this route into an open redirect usable for
 * credential phishing.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard'
  return raw
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  // The provider itself can fail or be cancelled before any code is issued;
  // it reports that here rather than as an exchange failure.
  const providerError = searchParams.get('error')
  if (providerError) {
    const description = searchParams.get('error_description') ?? providerError
    // access_denied is the user backing out at the consent screen. That is a
    // normal choice, not an error worth shouting about.
    const reason = providerError === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed'
    return NextResponse.redirect(
      `${origin}/login?error=${reason}&detail=${encodeURIComponent(description)}`
    )
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(
      `${origin}/login?error=oauth_exchange_failed&detail=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
