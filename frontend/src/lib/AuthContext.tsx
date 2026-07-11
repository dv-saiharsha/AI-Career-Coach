'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  type AuthUser,
  getStoredUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
} from './apiClient'

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUser(getStoredUser())
    setReady(true)
  }, [])

  const login = async (email: string, password: string) => {
    setUser(await apiLogin(email, password))
  }

  const register = async (email: string, password: string) => {
    setUser(await apiRegister(email, password))
  }

  const logout = () => {
    apiLogout()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
