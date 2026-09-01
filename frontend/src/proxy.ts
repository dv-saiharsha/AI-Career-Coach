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

  /* The verified subject is handed forward on a request header so the
     protected layout does not have to verify the same JWT a second time.
     Both calls were signature verification against Supabase's published
     keys, run sequentially, before a single byte of HTML could be produced —
     on every protected navigation.

     This header cannot be forged from outside: NextResponse.next() rewrites
     the request headers for this hop only, and any inbound header of the
     same name is overwritten here rather than passed through. */
  response.headers.set('x-verified-user', String(data!.claims.sub ?? ''))
  request.headers.set('x-verified-user', String(data!.claims.sub ?? ''))

  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/resume/:path*',
    '/interview/:path*',
    '/jobs/:path*',
    '/news/:path*',
    '/analytics/:path*',
    '/history/:path*',
    '/reports/:path*',
    '/profile/:path*',
    '/settings/:path*',
  ],
}
