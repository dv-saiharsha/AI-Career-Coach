'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { FileSearch, MessageSquareCode, TrendingUp, Sparkles } from 'lucide-react'
import ScrambleText from '../ScrambleText'

type Mode = 'login' | 'register'

const CONTENT: Record<Mode, { eyebrow: string; phrases: string[]; supporting: string }> = {
  register: {
    eyebrow: 'Join the platform',
    phrases: ['Own your next offer.', 'Stop applying blind.', 'Built to get you hired.', 'Your career, your rules.'],
    supporting:
      "Every top candidate has a system. This is yours — built by people who got tired of black-box rejections and decided to fix it.",
  },
  login: {
    eyebrow: 'Welcome back',
    phrases: ['Good to have you back.', 'Pick up where you left off.', 'Your progress, waiting for you.', 'Right where you left it.'],
    supporting: 'Your scores, your practice sessions, your progress — exactly as you left them. Sign in to keep building your edge.',
  },
}

const BENEFITS = [
  { icon: FileSearch, text: 'Real ATS scoring across 200+ systems, not guesswork' },
  { icon: MessageSquareCode, text: 'AI interview coach with live delivery feedback' },
  { icon: TrendingUp, text: 'One-click resume fixes when something is flagged' },
]

export function AuthShowcase({ mode = 'register' }: { mode?: Mode }) {
  const { eyebrow, phrases, supporting } = CONTENT[mode]
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % phrases.length), 3400)
    return () => clearInterval(id)
  }, [phrases.length])

  return (
    <div className="relative hidden lg:flex flex-col justify-between h-full w-full overflow-hidden bg-[var(--color-canvas-deep)] p-12 xl:p-16">
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 -translate-x-1/2 w-[560px] h-[560px] bg-[var(--color-accent)]/10 rounded-full blur-[160px]" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[360px] bg-[var(--color-accent-lighter)]/5 rounded-full blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-[var(--color-canvas-line)] to-transparent" />

      <Link href="/" className="relative z-10 flex items-center gap-2.5 w-fit">
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--color-accent)] to-[var(--color-accent-light)] shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.4)]" />
        <span className="font-display font-semibold text-[var(--color-ink)] text-lg">AI Career Coach</span>
      </Link>

      <div className="relative z-10">
        <span className="section-eyebrow-violet mb-6 inline-flex">
          <Sparkles className="w-3 h-3" />
          {eyebrow}
        </span>
        <h2 className="text-4xl xl:text-5xl font-display font-bold text-[var(--color-ink)] leading-[1.1] min-h-[2.2em]">
          <motion.span
            key={index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="inline-block"
          >
            <ScrambleText key={index} text={phrases[index]} duration={650} />
          </motion.span>
        </h2>
        <p className="text-[var(--color-ink-dim)] text-lg mt-6 max-w-md leading-relaxed">{supporting}</p>
      </div>

      <div className="relative z-10 space-y-4">
        {BENEFITS.map(({ icon: Icon, text }, i) => (
          <motion.div
            key={text}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.15 + i * 0.1 }}
            className="flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-[var(--color-accent-lighter)]" />
            </div>
            <span className="text-sm text-[var(--color-ink-subtle)]">{text}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
