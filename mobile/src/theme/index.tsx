import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { palette, type Palette } from './tokens'

export * from './tokens'

/**
 * Theme, and the one place the app decides what colour anything is.
 *
 * Three states rather than two, matching the web: dark, light, or follow the
 * device. "System" is the default here where the web defaults to dark — a
 * phone has a real, deliberate OS-level setting that a browser tab does not,
 * and overriding it is the wrong default on a device someone has already
 * told what they want.
 *
 * The choice persists through AsyncStorage rather than SecureStore. It is a
 * preference, not a secret, and SecureStore round-trips through the keychain
 * for every read.
 */

type ThemeChoice = 'light' | 'dark' | 'system'

interface ThemeValue {
  colors: Palette
  scheme: 'light' | 'dark'
  choice: ThemeChoice
  setChoice: (choice: ThemeChoice) => void
}

const STORAGE_KEY = 'applycenter.theme'

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [choice, setChoiceState] = useState<ThemeChoice>('system')

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (cancelled) return
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setChoiceState(stored)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<ThemeValue>(() => {
    const scheme = choice === 'system' ? (system ?? 'dark') : choice
    return {
      scheme,
      colors: palette[scheme],
      choice,
      setChoice: (next) => {
        setChoiceState(next)
        void AsyncStorage.setItem(STORAGE_KEY, next)
      },
    }
  }, [choice, system])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
