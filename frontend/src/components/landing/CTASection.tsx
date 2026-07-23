'use client';

import { motion } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

export function CTASection() {
  const { ref, inView } = useInView({ threshold: 0.2, triggerOnce: true });

  return (
    <section className="py-24 px-4 border-t border-[var(--color-canvas-line-soft)] bg-[var(--color-canvas-deep)] relative overflow-hidden">
      {/* Calm drifting wisps — "everything under control" */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute bottom-0 left-[20%] w-32 h-64 bg-[var(--color-accent)]/[0.06] rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-0 left-[45%] w-24 h-56 bg-[var(--color-accent-lighter)]/[0.05] rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute bottom-0 left-[68%] w-28 h-60 bg-[var(--color-accent)]/[0.05] rounded-full blur-3xl animate-float-slow" />
      </div>

      <div className="max-w-4xl mx-auto relative">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative bg-gradient-to-br from-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-canvas))] to-[var(--color-canvas)] border border-[var(--color-accent)]/25 rounded-3xl p-12 md:p-16 text-center overflow-hidden"
        >
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[var(--color-accent)]/10 rounded-full blur-[80px]" />
          </div>
          <div className="absolute inset-0 rounded-3xl">
            <div className="absolute inset-px rounded-3xl border border-[var(--color-accent)]/10" />
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 rounded-full px-4 py-1.5 mb-6 text-xs font-semibold text-[var(--color-accent-lighter)] uppercase tracking-widest">
              <Sparkles className="w-3 h-3" />
              Free to start
            </div>

            <h2 className="text-4xl md:text-6xl font-display font-semibold tracking-tight mb-5">
              Ready to land
              <br />
              <span className="gradient-text-violet">your next role?</span>
            </h2>

            <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto mb-10 leading-relaxed">
              Join 50,000+ candidates who&apos;ve used Zenith to get more interviews and
              ace them. Start analyzing your resume for free — no credit card required.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/register"
                className="group flex items-center gap-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dim)] text-white px-8 py-4 rounded-full font-semibold text-base hover:scale-[1.03] active:scale-[0.97] transition-all shadow-[0_0_30px_rgba(var(--color-accent-rgb),0.45)]"
              >
                <Sparkles className="w-4 h-4" />
                Start free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/interview"
                className="flex items-center gap-2 text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors text-sm font-medium px-4 py-4"
              >
                Try mock interview
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 mt-10 text-xs text-[var(--color-ink-faint)]">
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                No credit card required
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                Cancel anytime
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                Enterprise-grade security
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                50,000+ candidates
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
