'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/lib/AuthContext'
import { CommandPaletteProvider } from '@/components/CommandPalette'

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      storageKey="aicc_theme"
      disableTransitionOnChange
    >
      {/* CSS handles declarative animations, but Framer drives its own via JS
          and ignores the media query unless told to. "user" makes every
          motion component in the tree honour the OS setting by default. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/* Mounted at the root so ⌘K works on every route, public or not. */}
            <CommandPaletteProvider>{children}</CommandPaletteProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}
