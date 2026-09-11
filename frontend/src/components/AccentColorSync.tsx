'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { getUserProfile } from '@/lib/apiClient'
import { applyAccentColor } from '@/lib/accentColor'

/**
 * Applies the signed-in user's saved accent color on every load, and
 * re-applies it whenever the light/dark toggle flips — the color is solved
 * per theme (see lib/accentColor.ts), not a single value reused across both,
 * so a theme change alone requires recomputing it.
 *
 * Renders nothing. Shares the ['user', 'profile'] query with the Profile
 * page and onboarding, so mounting this in AppProviders costs no extra
 * request when either of those is also on screen.
 */
export function AccentColorSync() {
  const { resolvedTheme } = useTheme()
  const { data: profile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: getUserProfile,
    // A stale accent color for a few seconds after a fresh sign-in is a
    // smaller cost than a blocking request before first paint everywhere
    // else that query is used with a longer staleTime.
    staleTime: 30_000,
  })

  useEffect(() => {
    // Unresolved until next-themes mounts client-side — skip rather than
    // apply against a theme that might immediately flip under it.
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return
    applyAccentColor(profile?.accent_color, resolvedTheme)
  }, [profile?.accent_color, resolvedTheme])

  return null
}
