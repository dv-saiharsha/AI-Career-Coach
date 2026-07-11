'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useAuth } from '../../lib/AuthContext'
import { DashboardNav } from '../../components/DashboardNav'

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`)
    }
  }, [ready, user, router, pathname])

  if (!ready || !user) return null

  return (
    <DashboardNav>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </DashboardNav>
  )
}
