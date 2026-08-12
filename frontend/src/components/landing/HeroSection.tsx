'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { TextReveal } from '@/components/ui/text-reveal'
import { HeroJourney } from './HeroJourney'
import { fadeUp, springSoft, staggerContainer } from '@/lib/motion'

export function HeroSection() {
  const reduce = useReducedMotion()

  return (
    <section className="grain relative overflow-hidden pb-24 pt-36 sm:pt-40 md:pb-32 md:pt-48">
      <AmbientGlow />

      <div className="shell grid grid-cols-1 items-center gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        {/* Copy column */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={staggerContainer(0.08)}
          className="flex flex-col items-start text-left"
        >
          <motion.div
            variants={fadeUp}
            className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-canvas-line bg-canvas-raise/70 px-3.5 py-1.5 backdrop-blur-md"
          >
            <span className="relative flex size-1.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ink opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-ink" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
              AI-powered career coaching
            </span>
          </motion.div>

          {/* Emphasis comes from tone, not from an oblique — italic sans reads
              as a slanted roman rather than a true italic. */}
          <h1 className="max-w-2xl text-[46px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[60px] lg:text-[68px]">
            <TextReveal>Land the role you</TextReveal>{' '}
            <span className="text-ink-faint">
              <TextReveal delay={0.22}>actually want.</TextReveal>
            </span>
          </h1>

          <motion.p
            variants={fadeUp}
            className="mt-7 max-w-lg text-[17px] leading-relaxed text-ink-dim sm:text-lg"
          >
            Before a human ever opens your resume, an algorithm has already decided whether
            they will. We show you exactly what it sees — and get you ready for the interview
            it leads to.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">
                Analyze my resume
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/how-it-works">See how it works</Link>
            </Button>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2.5">
                {['A', 'J', 'M', 'S', 'R'].map((letter) => (
                  <Avatar key={letter} className="size-8 border-2 border-canvas">
                    <AvatarFallback className="bg-canvas-elevated text-[10px] text-ink-subtle">
                      {letter}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <p className="text-sm text-ink-dim">
                <span className="font-medium text-ink">50,000+</span> job seekers coached
              </p>
            </div>

            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-3.5 fill-warning text-warning" aria-hidden="true" />
              ))}
              <span className="ml-1 text-sm font-medium text-ink">4.9</span>
              <span className="sr-only">average rating, 5 stars</span>
            </div>
          </motion.div>
        </motion.div>

        {/* Live product showcase */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...springSoft, delay: 0.2 }}
          className="relative mx-auto w-full max-w-md lg:max-w-none"
        >
          <HeroJourney />
        </motion.div>
      </div>
    </section>
  )
}
