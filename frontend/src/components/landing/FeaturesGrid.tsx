'use client'

import { motion } from 'framer-motion'
import { FileSearch, MessageSquareCode, Target, ListChecks, Mic, LineChart, Check, Sparkles } from 'lucide-react'
import { HoverBorderGradient } from '../aceternity/HoverBorderGradient'

const FEATURE_GROUPS = [
  {
    icon: FileSearch,
    title: 'AI Resume Analyzer',
    description: 'Score your resume against any job description before a human ever sees it.',
    points: ['ATS match score', 'Missing skills detection', 'Keyword coverage analysis', 'Line-by-line suggestions'],
  },
  {
    icon: MessageSquareCode,
    title: 'Interview Coach',
    description: 'Practice the exact round you’re walking into, then see where you actually stand.',
    points: ['Technical & behavioral questions', 'AI feedback on every answer', 'Session history & scores', 'Role-specific question sets'],
  },
]

const SECONDARY = [
  { icon: Target, label: 'Keyword-level ATS scoring' },
  { icon: ListChecks, label: 'Prioritized improvement checklist' },
  { icon: Mic, label: 'Realistic mock interviews' },
  { icon: LineChart, label: 'Progress tracked over time' },
]

export function FeaturesGrid() {
  return (
    <section id="features" className="border-t border-border py-28 px-6 sm:py-36">
      <div className="mx-auto max-w-[1280px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6 }}
          className="mx-auto mb-16 max-w-2xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            What you get
          </span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Two tools. One outcome.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink-dim">
            Everything you need to go from application to offer — built to catch what a
            recruiter&apos;s scanner catches, and rehearse what they&apos;ll actually ask.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {FEATURE_GROUPS.map((group, i) => {
            const Icon = group.icon
            return (
              <motion.div
                key={group.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                <HoverBorderGradient containerClassName="h-full" className="flex h-full flex-col p-8">
                  <div
                    className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ background: 'var(--gradient-brand)' }}
                  >
                    <Icon className="h-6 w-6 text-on-accent" />
                  </div>
                  <h3 className="font-display text-2xl font-semibold text-foreground">{group.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-ink-dim">{group.description}</p>
                  <ul className="mt-6 space-y-3">
                    {group.points.map((point) => (
                      <li key={point} className="flex items-center gap-3 text-sm text-foreground">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10">
                          <Check className="h-3 w-3 text-success" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </HoverBorderGradient>
              </motion.div>
            )
          })}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {SECONDARY.map(({ icon: Icon, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.06 }}
              className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-5"
            >
              <Icon className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium leading-snug text-foreground">{label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
