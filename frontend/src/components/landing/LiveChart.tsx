'use client';

import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

const POINTS = 24;
const TICK_MS = 1100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic seed (no Math.random) so server and client render the same
 * initial path — randomization only starts client-side, after mount, in the
 * tick interval below. */
function seedSeries(base: number, spread: number, min: number, max: number): number[] {
  const series: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const wave = Math.sin(i * 0.7) * spread * 0.5 + Math.sin(i * 0.31) * spread * 0.3;
    series.push(clamp(base + wave, min, max));
  }
  return series;
}

/** A `d` path (not `points`) so the line is smoothly CSS-transitionable —
 * `points` isn't a CSS geometry property browsers animate, `d` is. */
function toPathD(series: number[], min: number, max: number): string {
  const range = max - min || 1;
  return series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * 100;
      const y = 26 - ((value - min) / range) * 22 - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

/** A genuinely live-updating dual-line chart — each series random-walks
 * every tick rather than animating in once and freezing. */
export function LiveChart({ colorA, colorB }: { colorA: string; colorB: string }) {
  const reduce = usePrefersReducedMotion();
  const [seriesA, setSeriesA] = useState(() => seedSeries(82, 5, 60, 98));
  const [seriesB, setSeriesB] = useState(() => seedSeries(74, 6, 50, 92));

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setSeriesA((prev) => [...prev.slice(1), clamp(prev[prev.length - 1] + (Math.random() - 0.5) * 6, 60, 98)]);
      setSeriesB((prev) => [...prev.slice(1), clamp(prev[prev.length - 1] + (Math.random() - 0.5) * 7, 50, 92)]);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <svg viewBox="0 0 100 26" className="w-full h-24" preserveAspectRatio="none">
      <path
        d={toPathD(seriesB, 40, 100)}
        fill="none"
        stroke={colorB}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.75}
        style={reduce ? undefined : { transition: `d ${TICK_MS * 0.85}ms ease` }}
      />
      <path
        d={toPathD(seriesA, 40, 100)}
        fill="none"
        stroke={colorA}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={reduce ? undefined : { transition: `d ${TICK_MS * 0.85}ms ease` }}
      />
    </svg>
  );
}
