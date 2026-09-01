'use client';

import { FileSearch, MessageSquareCode, Target, BarChart2 } from 'lucide-react';
import { useAccentPalette } from '../../lib/useAccentPalette';
import { LiveChart } from './LiveChart';
import { Reveal, RevealGroup } from '@/lib/reveal'

export function ProductShowcase() {
  const palette = useAccentPalette();
  const STAT_CARDS = [
    { icon: FileSearch, label: 'Resumes Analyzed', value: '12', color: palette.accent },
    { icon: MessageSquareCode, label: 'Interview Sessions', value: '28', color: palette.accentLight },
    { icon: Target, label: 'Avg ATS Score', value: '84%', color: palette.accentLighter },
    { icon: BarChart2, label: 'Interview Score', value: '78', color: palette.accent },
  ];

  return (
    <section id="product-preview" className="py-16 md:py-28 lg:py-36 px-4 border-t border-[var(--color-canvas-line-soft)] relative bg-[var(--color-canvas-deep)] overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-[var(--color-accent)]/6 rounded-full blur-[180px] pointer-events-none" />

      <div className="max-w-5xl mx-auto relative">
        <Reveal
         
         
         
          className="text-center mb-14"
        >
          <span className="eyebrow mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            The dashboard
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
            Everything under control.
          </h2>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto">
            One view of every resume score, every mock interview, and exactly what to fix next.
          </p>
        </Reveal>

        <Reveal
         
         
         
          className="relative rounded-2xl overflow-hidden border border-[var(--color-canvas-line)] shadow-[0_40px_120px_-20px_rgba(var(--glow-rgb),0.12)]"
        >
          {/* Browser chrome */}
          <div className="flex items-center gap-4 bg-[var(--color-canvas-raise)] border-b border-[var(--color-canvas-line)] px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
              <span className="w-3 h-3 rounded-full bg-[var(--color-ink-faint)]" />
            </div>
            <div className="flex-1 max-w-sm mx-auto bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-full px-4 py-1.5 text-center text-xs text-[var(--color-ink-faint)] font-mono">
              app.applycenter.com/dashboard
            </div>
          </div>

          {/* Mock dashboard */}
          <div className="bg-[var(--color-canvas)] p-6 md:p-8">
            <RevealGroup className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              {STAT_CARDS.map(({ icon: Icon, label, value, color }) => (
                <Reveal
                  key={label}
                 
                 
                 
                  className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-4"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: `${color}15` }}>
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="text-xl font-display font-bold text-[var(--color-ink)]">{value}</div>
                  <div className="text-xs text-[var(--color-ink-dim)] mt-0.5">{label}</div>
                </Reveal>
              ))}
            </RevealGroup>

            <Reveal
             
             
             
              className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-[var(--color-ink)]">Performance Over Time</div>
                  <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-[var(--color-accent-lighter)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-lighter)] animate-pulse" />
                    Live
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />ATS Score</div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--color-accent-light)]" />Interview</div>
                </div>
              </div>
              <LiveChart colorA={palette.accent} colorB={palette.accentLight} />
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
