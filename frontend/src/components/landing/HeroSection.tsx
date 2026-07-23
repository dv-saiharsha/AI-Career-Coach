'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Star } from 'lucide-react'
import Link from 'next/link'
import { AuroraBackground } from '../aceternity/AuroraBackground'
import { Spotlight } from '../aceternity/Spotlight'
import { TextGenerateEffect } from '../aceternity/TextGenerateEffect'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { HeroJourney } from './HeroJourney'

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-40 pb-24 md:pt-48 md:pb-32">
      <AuroraBackground />
      <Spotlight />

      <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        {/* Copy column */}
        <div className="flex flex-col items-start text-left">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3.5 py-1.5 backdrop-blur-md"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-light opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-light" />
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              AI-powered career coaching
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-xl text-[42px] font-display font-bold leading-[1.06] tracking-tight text-foreground sm:text-[56px] lg:text-[64px]"
          >
            Land your{' '}
            <span className="gradient-text-brand">dream job</span> with AI
          </motion.h1>

          <div className="mt-6 max-w-lg text-lg leading-relaxed text-muted sm:text-xl">
            <TextGenerateEffect
              words="Before a human ever opens your resume, an algorithm already decided if they would. We show you exactly what it sees — and get you ready for the interview it leads to."
              delay={0.3}
            />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            className="mt-9"
          >
            <Button asChild size="lg" className="bg-[image:none] bg-primary shadow-none hover:bg-primary-dim hover:opacity-100">
              <Link href="/register">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mt-10 flex items-center gap-4"
          >
            <div className="flex -space-x-2.5">
              {['A', 'J', 'M', 'S', 'R'].map((letter) => (
                <Avatar key={letter} className="h-8 w-8 border-2 border-background">
                  <AvatarFallback className="text-[10px]">{letter}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            <div className="text-sm text-muted">
              <span className="font-semibold text-foreground">50,000+</span> job seekers coached
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-warning text-warning" />
              ))}
              <span className="ml-1 text-sm font-medium text-foreground">4.9</span>
            </div>
          </motion.div>
        </div>

        {/* Animated AI dashboard mockup */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-md lg:max-w-none"
        >
          <HeroJourney />
        </motion.div>
      </div>
    </section>
  )
}
