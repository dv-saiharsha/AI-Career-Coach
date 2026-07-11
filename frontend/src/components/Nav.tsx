'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../lib/AuthContext'
import Mark from './Seal'

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-mono font-semibold text-[16px] tracking-tight no-underline text-ink">
      <Mark size="sm" />
      Career&nbsp;Coach
    </Link>
  )
}

export default function Nav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const links = [
    { to: '/resume', label: 'Resume scan' },
    { to: '/interview', label: 'Interview coach' },
    ...(user ? [{ to: '/history', label: 'History' }] : []),
  ]

  const handleLogout = () => {
    logout()
    router.push('/')
  }

  return (
    <nav className="sticky top-0 z-40 bg-canvas/95 backdrop-blur-md border-b border-canvas-line">
      <div className="max-w-[1180px] mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between h-[72px]">
          <Wordmark />

          <ul className="hidden md:flex items-center gap-9 text-[14.5px] font-sans text-ink-dim list-none m-0 p-0">
            {links.map((l) => (
              <li key={l.to}>
                <Link
                  href={l.to}
                  className={`no-underline transition-colors hover:text-ink ${pathname === l.to ? 'text-ink' : ''}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden md:flex items-center gap-5">
            {user ? (
              <>
                <span className="font-mono text-[12px] text-ink-dim max-w-[160px] truncate">{user.email}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="font-mono text-[13px] text-ink-dim hover:text-ink underline underline-offset-2 bg-transparent border-0 cursor-pointer p-0"
                >
                  Log out
                </button>
              </>
            ) : (
              <Link href="/login" className="font-mono text-[13.5px] text-ink-dim hover:text-ink no-underline">
                Sign in
              </Link>
            )}

            <Link
              href="/resume"
              className="inline-block font-mono font-semibold text-sm bg-ok text-[#0c1f17] border border-ok px-[18px] py-[10px] rounded-sm no-underline transition-transform hover:-translate-y-px"
            >
              Scan your resume
            </Link>
          </div>

          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="md:hidden inline-flex flex-col justify-center gap-[5px] w-9 h-9 -mr-2"
          >
            <span className={`block h-px w-6 bg-ink transition-transform ${open ? 'translate-y-[6px] rotate-45' : ''}`} />
            <span className={`block h-px w-6 bg-ink transition-opacity ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-px w-6 bg-ink transition-transform ${open ? '-translate-y-[6px] -rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      <div
        className={`md:hidden overflow-hidden border-t border-canvas-line transition-[max-height] duration-300 ease-out ${
          open ? 'max-h-96' : 'max-h-0 border-t-0'
        }`}
      >
        <ul className="flex flex-col gap-1 px-5 py-4 list-none m-0">
          {links.map((l) => (
            <li key={l.to}>
              <Link
                href={l.to}
                className={`block py-2.5 text-[15px] font-sans no-underline ${pathname === l.to ? 'text-ink' : 'text-ink-dim'}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="pt-1">
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                className="block py-2.5 text-[15px] font-sans text-ink-dim bg-transparent border-0 cursor-pointer p-0"
              >
                Log out ({user.email})
              </button>
            ) : (
              <Link href="/login" className="block py-2.5 text-[15px] font-sans no-underline text-ink-dim">
                Sign in
              </Link>
            )}
          </li>
          <li className="pt-2">
            <Link
              href="/resume"
              className="inline-block font-mono font-semibold text-sm bg-ok text-[#0c1f17] px-[18px] py-[10px] rounded-sm no-underline"
            >
              Scan your resume
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  )
}
