'use client'

import type { ReactNode } from 'react'
import { AuthProvider } from '../lib/AuthContext'
import { ThemeProvider } from '../lib/ThemeContext'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  )
}
