'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Upload, ScanLine, Sparkles, FileCheck2, MessageSquareCode, FileText } from 'lucide-react'
import { ScoreRing } from '../ScoreRing'

const EASE = [0.22, 1, 0.36, 1] as const

const STAGES = [
  { key: 'upload', label: 'Uploading resume', icon: Upload },
  { key: 'scan', label: 'Scanning against the JD', icon: ScanLine },
  { key: 'tailor', label: 'Tailoring your resume', icon: Sparkles },
  { key: 'result', label: 'Resume ready', icon: FileCheck2 },
  { key: 'interview', label: 'Prepare for the interview', icon: MessageSquareCode },
] as const

const STAGE_MS = 2200
const CHART_PATH = 'M0,54 L20,46 L40,50 L60,28 L80,34 L100,10 L120,16 L140,4'
const TAILOR_SKILLS = ['Kubernetes', 'Terraform', 'GraphQL']

export function HeroJourney() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), STAGE_MS)
    return () => clearInterval(id)
  }, [])

  const current = STAGES[stage]
  const StageIcon = current.icon

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {/* Header: step tracker */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {STAGES.map((s, i) => (
            <span
              key={s.key}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: i === stage ? 20 : 6,
                background: i <= stage ? 'var(--primary)' : 'var(--border)',
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <StageIcon className="h-3 w-3" />
          <AnimatePresence mode="wait">
            <motion.span
              key={current.key}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
            >
              {current.label}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      {/* Stage content */}
      <div className="relative h-[220px] overflow-hidden rounded-xl border border-border bg-background/60">
        <AnimatePresence mode="wait">
          {current.key === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full flex-col items-center justify-center gap-4 px-8"
            >
              <motion.div
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-none"
              >
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium text-foreground">resume.pdf</span>
              </motion.div>
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-raised">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'var(--gradient-brand)' }}
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: STAGE_MS / 1000 - 0.4, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>
          )}

          {current.key === 'scan' && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full items-center justify-center"
            >
              <div className="relative w-40 rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-col gap-2">
                  {[0.9, 0.7, 0.95, 0.5, 0.8, 0.6].map((w, i) => (
                    <div key={i} className="h-1.5 rounded-full bg-surface-raised" style={{ width: `${w * 100}%` }} />
                  ))}
                </div>
                <motion.div
                  className="absolute inset-x-0 h-8"
                  style={{
                    background:
                      'linear-gradient(180deg, transparent, color-mix(in srgb, var(--primary) 25%, transparent) 50%, transparent)',
                  }}
                  initial={{ top: '-20%' }}
                  animate={{ top: '110%' }}
                  transition={{ duration: 1.3, repeat: Infinity, ease: 'linear' }}
                />
              </div>
            </motion.div>
          )}

          {current.key === 'tailor' && (
            <motion.div
              key="tailor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full flex-col items-center justify-center gap-2.5"
            >
              {TAILOR_SKILLS.map((skill, i) => (
                <motion.div
                  key={skill}
                  initial={{ opacity: 0, x: -12, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ delay: 0.25 + i * 0.3, duration: 0.35, ease: EASE }}
                  className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3.5 py-1.5"
                >
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="text-xs font-medium text-foreground">+ {skill}</span>
                </motion.div>
              ))}
            </motion.div>
          )}

          {current.key === 'result' && (
            <motion.div
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full flex-col items-center justify-center gap-4"
            >
              <div className="flex items-center gap-5">
                <ScoreRing value={92} size={76} strokeWidth={7} />
                <div>
                  <div className="text-sm font-semibold text-foreground">ATS Match Score</div>
                  <div className="mt-1 text-xs text-ink-dim">18/20 keywords matched to the JD</div>
                </div>
              </div>
              <svg viewBox="0 0 140 60" className="h-12 w-36 overflow-visible">
                <motion.path
                  d={CHART_PATH}
                  fill="none"
                  stroke="url(#journey-chart-gradient)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                />
                <defs>
                  <linearGradient id="journey-chart-gradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--primary)" />
                    <stop offset="100%" stopColor="var(--accent)" />
                  </linearGradient>
                </defs>
              </svg>
            </motion.div>
          )}

          {current.key === 'interview' && (
            <motion.div
              key="interview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-full items-center justify-center"
            >
              <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--gradient-brand)' }}>
                  {/* on-accent, not white: --gradient-brand starts at --ink,
                      which is cream in dark mode. */}
                  <MessageSquareCode className="h-4 w-4 text-on-accent" />
                </div>
                <div>
                  <div className="text-xs font-medium text-foreground">Interview Coach</div>
                  <div className="mt-2 flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-muted"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
