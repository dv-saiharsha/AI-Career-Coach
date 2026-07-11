'use client';

import { motion } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import { FileSearch, MessageSquareCode, Target, BarChart2 } from 'lucide-react';
import { useAccentPalette } from '../../lib/useAccentPalette';

const BARS = [42, 58, 65, 71, 74, 80, 84, 82, 87, 84, 88, 91];

export function ProductShowcase() {
  const { ref, inView } = useInView({ threshold: 0.15, triggerOnce: true });
  const palette = useAccentPalette();
  const STAT_CARDS = [
    { icon: FileSearch, label: 'Resumes Analyzed', value: '12', color: palette.accent },
    { icon: MessageSquareCode, label: 'Interview Sessions', value: '28', color: palette.accentLight },
    { icon: Target, label: 'Avg ATS Score', value: '84%', color: palette.accentLighter },
    { icon: BarChart2, label: 'Interview Score', value: '78', color: palette.accent },
  ];

  return (
    <section id="features" ref={ref} className="py-24 px-4 border-t border-[var(--color-canvas-line-soft)] relative bg-[var(--color-canvas-deep)] overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-[var(--color-accent)]/6 rounded-full blur-[180px] pointer-events-none" />

      <div className="max-w-5xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="section-eyebrow-violet mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            The dashboard
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
            Everything under control.
          </h2>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto">
            One view of every resume score, every mock interview, and exactly what to fix next.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-2xl overflow-hidden border border-[var(--color-canvas-line)] shadow-[0_40px_120px_-20px_rgba(var(--color-accent-rgb),0.25)]"
        >
          {/* Browser chrome */}
          <div className="flex items-center gap-4 bg-[var(--color-canvas-raise)] border-b border-[var(--color-canvas-line)] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
            </div>
            <div className="flex-1 max-w-sm mx-auto bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-full px-4 py-1.5 text-center text-xs text-[var(--color-ink-faint)] font-mono">
              app.aicareercoach.com/dashboard
            </div>
          </div>

          {/* Mock dashboard */}
          <div className="bg-[var(--color-canvas)] p-6 md:p-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              {STAT_CARDS.map(({ icon: Icon, label, value, color }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.4 + i * 0.08 }}
                  className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-4"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${color}15` }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="text-xl font-display font-bold text-[var(--color-ink)]">{value}</div>
                  <div className="text-xs text-[var(--color-ink-dim)] mt-0.5">{label}</div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.4, delay: 0.7 }}
              className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="text-sm font-semibold text-[var(--color-ink)]">Performance Over Time</div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />ATS Score</div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--color-accent-light)]" />Interview</div>
                </div>
              </div>
              <div className="flex items-end gap-2 h-24">
                {BARS.map((v, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={inView ? { height: `${v}%` } : {}}
                    transition={{ duration: 0.6, delay: 0.8 + i * 0.03, ease: 'easeOut' }}
                    className="flex-1 rounded-t-sm bg-gradient-to-t from-[var(--color-accent)]/50 to-[var(--color-accent)] min-h-[4px]"
                  />
                ))}
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
