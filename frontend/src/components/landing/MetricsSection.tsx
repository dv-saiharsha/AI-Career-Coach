'use client';

import { useInView } from 'react-intersection-observer';
import CountUp from 'react-countup';
import { Reveal, RevealGroup } from '@/lib/reveal';

const METRICS = [
  { value: 94, suffix: '%', label: 'ATS prediction accuracy', decimals: 0 },
  { value: 50000, suffix: '+', label: 'job seekers coached', decimals: 0, format: true },
  { value: 3.2, suffix: 'x', label: 'more interview callbacks', decimals: 1 },
  { value: 200, suffix: '+', label: 'ATS systems validated against', decimals: 0 },
];

export function MetricsSection() {
  const { ref, inView } = useInView({ threshold: 0.3, triggerOnce: true });

  return (
    <section ref={ref} className="py-16 md:py-28 lg:py-36 px-4 border-t border-[var(--color-canvas-line-soft)] relative overflow-hidden bg-[var(--color-canvas-deep)]">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[var(--color-accent)]/8 rounded-full blur-[160px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative">
        <Reveal className="text-center mb-16">
          <span className="eyebrow mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            By the numbers
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4">
            Your score is one upload away.
          </h2>
        </Reveal>

        {/* useInView stays only to gate the counters — a number that has
            already finished counting before it is on screen is a number
            nobody saw count. The reveal itself is the shared observer. */}
        <RevealGroup className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {METRICS.map((m) => (
            <Reveal key={m.label} className="text-center">
              <div className="text-4xl md:text-5xl font-display font-bold gradient-text-violet mb-2 tabular-nums">
                {inView ? (
                  <CountUp end={m.value} duration={2} decimals={m.decimals} separator="," />
                ) : (
                  '0'
                )}
                {m.suffix}
              </div>
              <div className="text-sm text-[var(--color-ink-dim)] max-w-[180px] mx-auto leading-snug">{m.label}</div>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
