'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/lib/AuthContext'
import { CommandPaletteProvider } from '@/components/CommandPalette'
import { ToastProvider } from '@/components/ui/toast'

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
      /* Dark is the primary, designed-first theme; light is a real second
         theme, not a fallback. enableSystem stays off because the choice is
         a product decision the user makes with the toggle, and a silent OS
         swap on first paint is a worse first impression than one consistent
         one. */
      defaultTheme="dark"
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
            {/* Both mounted at the root so ⌘K and confirmation toasts work on
                every route, public or not. */}
            <CommandPaletteProvider>
              <ToastProvider>{children}</ToastProvider>
            </CommandPaletteProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  )
}
