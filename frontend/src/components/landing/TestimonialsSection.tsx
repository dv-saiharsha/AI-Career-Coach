'use client'

import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { InfiniteMovingCards } from '../aceternity/InfiniteMovingCards'
import { Avatar, AvatarFallback } from '../ui/avatar'

const TESTIMONIALS = [
  {
    name: 'Priya Nair',
    role: 'Frontend Engineer, hired at a Series C startup',
    quote: 'The ATS score caught three keyword gaps I never would have noticed. Fixed my resume, got two callbacks the same week.',
    initials: 'PN',
  },
  {
    name: 'Marcus Chen',
    role: 'Product Manager',
    quote: 'Practicing the behavioral round against real feedback — not a friend guessing — changed how I structured every answer.',
    initials: 'MC',
  },
  {
    name: 'Aisha Osei',
    role: 'Data Scientist',
    quote: 'I ran my resume against four different job descriptions and watched the match score change in real time. Genuinely useful.',
    initials: 'AO',
  },
  {
    name: 'Daniel Kim',
    role: 'Backend Engineer',
    quote: 'The mock interview questions were specific to the role, not generic. That alone was worth it.',
    initials: 'DK',
  },
  {
    name: 'Sofia Torres',
    role: 'UX Designer',
    quote: 'Went from a 58 to a 91 ATS score after three rounds of suggestions. Landed the interview a week later.',
    initials: 'ST',
  },
  {
    name: 'James Whitfield',
    role: 'Engineering Manager',
    quote: 'Used it to sanity-check my own resume after a decade out of the job market. It found things I\'d never think to fix.',
    initials: 'JW',
  },
]

function TestimonialCard({ t }: { t: (typeof TESTIMONIALS)[number] }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-surface p-6">
      <div>
        <div className="mb-3 flex gap-0.5">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="h-3.5 w-3.5 fill-warning text-warning" />
          ))}
        </div>
        <p className="text-[15px] leading-relaxed text-foreground">&ldquo;{t.quote}&rdquo;</p>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback>{t.initials}</AvatarFallback>
        </Avatar>
        <div>
          <div className="text-sm font-semibold text-foreground">{t.name}</div>
          <div className="text-xs text-ink-dim">{t.role}</div>
        </div>
      </div>
    </div>
  )
}

export function TestimonialsSection() {
  return (
    <section className="border-t border-border py-28 sm:py-36">
      <div className="mx-auto max-w-[1280px] px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6 }}
          className="mx-auto mb-14 max-w-2xl text-center"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Candidates who&apos;ve used it</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Real scores. Real offers.
          </h2>
        </motion.div>
      </div>

      <InfiniteMovingCards items={TESTIMONIALS.map((t) => <TestimonialCard key={t.name} t={t} />)} speed="slow" />
    </section>
  )
}
