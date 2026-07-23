import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'

// Landing point for both signup-confirmation and password-reset email
// links — Supabase sends the user here with a `code` param, we exchange it
// for a session, then continue on to wherever the flow actually needs
// (dashboard for a fresh signup, /reset-password to set a new password).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`)
}
