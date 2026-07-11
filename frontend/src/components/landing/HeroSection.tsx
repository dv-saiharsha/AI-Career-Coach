'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, Bot, ChevronDown, Sparkles, Star } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import ScrambleText from '../ScrambleText';

const ParticleHero = dynamic(() => import('../three/ParticleHero'), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-transparent" />,
});

const HEADLINES: [string, string][] = [
  ['See the rejection', 'coming.'],
  ['Stop guessing.', 'Start knowing.'],
  ['Built to get you', 'hired.'],
  ['Know the outcome,', 'before you apply.'],
];

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });

  const cueOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0]);
  const contentOpacity = useTransform(scrollYProgress, [0.9, 1], [1, 0.55]);

  const [headlineIndex, setHeadlineIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHeadlineIndex((i) => (i + 1) % HEADLINES.length), 4200);
    return () => clearInterval(id);
  }, []);
  const [line1, line2] = HEADLINES[headlineIndex];

  return (
    <section ref={sectionRef} className="relative" style={{ height: '230vh' }}>
      <div className="sticky top-0 h-screen w-full overflow-hidden flex flex-col items-center justify-center bg-[var(--color-canvas-deep)]">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[10%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[var(--color-accent)]/10 rounded-full blur-[160px]" />
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        {/* Particle-assembly dashboard, scroll-scrubbed */}
        <div className="absolute inset-0 z-0">
          <ParticleHero progress={scrollYProgress} />
        </div>

        {/* Vignette so the assembled graphic doesn't fight the headline, CTAs, and trust row for legibility */}
        <div
          className="absolute inset-0 z-[5] pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 560px 680px at 50% 50%, color-mix(in srgb, var(--color-canvas) 92%, transparent) 0%, color-mix(in srgb, var(--color-canvas) 75%, transparent) 35%, color-mix(in srgb, var(--color-canvas) 40%, transparent) 60%, transparent 85%)',
          }}
        />

        <motion.div
          style={{ opacity: contentOpacity }}
          className="relative z-10 w-full max-w-5xl mx-auto px-5 flex flex-col items-center text-center"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 mb-8 backdrop-blur-md"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-lighter)] animate-pulse" />
            <span className="text-xs font-mono font-medium tracking-wide text-[var(--color-accent-lighter)] uppercase">
              AI-POWERED <span className="text-[var(--color-ink-dim)] normal-case ml-1">Interview Coach now scores delivery &amp; communication</span>
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
            className="text-[44px] sm:text-[68px] lg:text-[92px] leading-[1.03] tracking-tight font-display font-bold text-[var(--color-ink)] max-w-4xl mb-7 min-h-[1.1em] sm:min-h-[2.2em]"
          >
            <ScrambleText key={`${headlineIndex}-a`} text={line1} duration={550} />
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)] drop-shadow-[0_0_24px_rgba(var(--color-accent-rgb),0.35)]">
              <ScrambleText key={`${headlineIndex}-b`} text={line2} duration={550} delay={150} />
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25, ease: 'easeOut' }}
            className="text-lg md:text-xl text-[var(--color-ink-dim)] max-w-2xl mb-10 leading-relaxed"
          >
            AI Career Coach scores your resume against real ATS systems and rehearses your
            interview before it happens — so nothing catches you off guard.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
            className="flex flex-col sm:flex-row items-center gap-4"
          >
            <Link
              href="/register"
              className="flex items-center gap-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dim)] text-white px-8 py-4 rounded-full font-semibold text-[15px] hover:shadow-[0_0_28px_rgba(var(--color-accent-rgb),0.5)] hover:scale-[1.02] transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Start free
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
            <Link
              href="/how-it-works"
              className="flex items-center gap-2 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] text-[var(--color-ink)] px-8 py-4 rounded-full font-medium text-[15px] hover:bg-[var(--color-canvas-line)] transition-colors"
            >
              <Bot className="w-4 h-4 text-[var(--color-ink-dim)]" />
              See how it works
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="mt-8 flex items-center gap-4 md:gap-6 text-sm text-[var(--color-ink-dim)]"
          >
            <div className="flex items-center -space-x-2">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full border-2 border-[var(--color-canvas-deep)] bg-[var(--color-accent)]/20 backdrop-blur-sm flex items-center justify-center opacity-80"
                >
                  <span className="text-[8px] font-bold text-[var(--color-accent-lighter)]">{String.fromCharCode(65 + i)}</span>
                </div>
              ))}
            </div>
            <span>Trusted by <strong className="text-[var(--color-ink)]">50,000+</strong> job seekers</span>
            <span className="text-[var(--color-canvas-line)]">&bull;</span>
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-3 h-3 fill-[var(--color-accent-lighter)] text-[var(--color-accent-lighter)]" />
              ))}
              <span className="ml-1 text-[var(--color-ink)] tabular-nums">4.9/5</span>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          style={{ opacity: cueOpacity }}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none z-20"
        >
          <span className="text-[11px] font-mono font-semibold tracking-widest uppercase text-[var(--color-accent-lighter)]">
            Scroll to watch it build
          </span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="w-8 h-8 rounded-full border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 backdrop-blur-md flex items-center justify-center shadow-[0_0_16px_rgba(var(--color-accent-rgb),0.4)]"
          >
            <ChevronDown className="w-4 h-4 text-[var(--color-accent-lighter)]" />
          </motion.div>
        </motion.div>

        <div className="absolute w-full bottom-0 left-0 bg-gradient-to-t from-[var(--color-canvas-deep)] via-[var(--color-canvas-deep)]/70 to-transparent h-32 z-10 pointer-events-none" />
      </div>
    </section>
  );
}
