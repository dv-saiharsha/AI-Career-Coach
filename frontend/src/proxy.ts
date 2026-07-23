import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Scoped to actual protected paths via the matcher below — public pages
// (landing, login, register, etc.) never invoke this at all, so they never
// depend on a live Supabase round-trip just to render.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // getClaims() validates the JWT signature against Supabase's published
  // public keys and refreshes the session cookie if needed — the current
  // Supabase-recommended way to check identity server-side (unlike
  // getSession(), which isn't guaranteed to revalidate the token).
  const { data, error } = await supabase.auth.getClaims()
  const isAuthed = !error && !!data?.claims

  if (!isAuthed) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('from', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/resume/:path*',
    '/interview/:path*',
    '/jobs/:path*',
    '/analytics/:path*',
    '/history/:path*',
    '/reports/:path*',
    '/achievements/:path*',
    '/profile/:path*',
    '/settings/:path*',
  ],
}
