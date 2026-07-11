'use client';

import { motion } from 'framer-motion';

const COMPANIES = [
  'Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Netflix', 'Stripe', 'Figma',
  'Notion', 'Linear', 'Vercel', 'OpenAI'
];

export function TrustedSection() {
  return (
    <section className="relative py-16 overflow-hidden border-t border-[var(--color-canvas-line)]">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-accent)]/[0.03] to-transparent pointer-events-none" />
      
      <div className="text-center mb-8 px-4">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">
          Trusted by candidates at top companies
        </p>
      </div>

      {/* Marquee */}
      <div className="relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,white_10%,white_90%,transparent)]">
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 25, ease: 'linear', repeat: Infinity }}
          className="flex shrink-0 gap-12 pr-12"
        >
          {[...COMPANIES, ...COMPANIES].map((company, i) => (
            <div
              key={`${company}-${i}`}
              className="flex items-center shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-accent-lighter)] transition-colors cursor-default font-display font-semibold text-lg tracking-tight"
            >
              {company}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
