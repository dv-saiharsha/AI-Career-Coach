'use client';

import { useMemo, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { FileSearch, MessageSquareCode, Trophy, Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const ROAD_HEIGHT = 560;
const CENTER_X = 60;
const AMPLITUDE = 42;

const CHECKPOINTS = [
  {
    key: 'predict',
    num: '01',
    title: 'Predict',
    icon: FileSearch,
    body: 'Know before you apply.',
    topPct: 6,
  },
  {
    key: 'practice',
    num: '02',
    title: 'Practice',
    icon: MessageSquareCode,
    body: 'Rehearse the room.',
    topPct: 50,
  },
  {
    key: 'land',
    num: '03',
    title: 'Land',
    icon: Trophy,
    body: 'Walk in ready.',
    topPct: 94,
  },
];

// x(f) = CENTER_X + A*sin(2π(f-f0)/period) — chosen so x == CENTER_X exactly
// at each checkpoint fraction (0.06, 0.50, 0.94 are evenly spaced by 0.44).
const F0 = 0.06;
const PERIOD = 0.88;
function roadX(fraction: number) {
  return CENTER_X + AMPLITUDE * Math.sin((2 * Math.PI * (fraction - F0)) / PERIOD);
}

function buildRoadPath() {
  const samples = 48;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const y = f * ROAD_HEIGHT;
    const x = roadX(f);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function CheckpointCard({ cp }: { cp: (typeof CHECKPOINTS)[number] }) {
  if (cp.key === 'predict') {
    return (
      <div className="glass-card-violet px-4 py-3">
        <p className="font-mono text-xs text-[var(--color-ink-subtle)] leading-relaxed">
          &bull; <span className="lint-err">Responsible for</span> checkout services.
        </p>
        <div className="lint-comment mt-1.5 text-[10px]">{'// weak verb, ATS-penalized'}</div>
      </div>
    );
  }
  if (cp.key === 'practice') {
    const rows = [
      { label: 'Structure', value: 90 },
      { label: 'Delivery', value: 78 },
    ];
    return (
      <div className="glass-card-violet px-4 py-3 space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-[var(--color-ink-dim)]">{r.label}</span>
              <span className="text-[var(--color-accent-lighter)] font-semibold tabular-nums">{r.value}%</span>
            </div>
            <div className="h-1 bg-[var(--color-canvas-line-soft)] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)]" style={{ width: `${r.value}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="glass-card-violet px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--color-ink-faint)] font-display font-bold tabular-nums">62%</span>
        <span className="text-[var(--color-ink-faint)]">&rarr;</span>
        <span className="text-[var(--color-accent-lighter)] font-display font-bold tabular-nums">91%</span>
      </div>
      <div className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
        <Check className="w-3.5 h-3.5" />
        Ready
      </div>
    </div>
  );
}

export function FeatureReveal() {
  const roadRef = useRef<HTMLDivElement>(null);
  const basePathRef = useRef<SVGPathElement>(null);
  const progressPathRef = useRef<SVGPathElement>(null);
  const travelerRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const pathD = useMemo(() => buildRoadPath(), []);

  useGSAP(() => {
    gsap.set(cardRefs.current, { opacity: 0, y: 16 });

    const totalLength = progressPathRef.current?.getTotalLength() ?? 0;
    if (progressPathRef.current) {
      progressPathRef.current.style.strokeDasharray = `${totalLength}`;
      progressPathRef.current.style.strokeDashoffset = `${totalLength}`;
    }

    const trigger = ScrollTrigger.create({
      trigger: roadRef.current,
      start: 'top 75%',
      end: 'bottom 45%',
      scrub: 0.5,
      onUpdate: (self) => {
        const pct = self.progress * 100;
        if (progressPathRef.current) {
          progressPathRef.current.style.strokeDashoffset = `${totalLength * (1 - self.progress)}`;
        }
        if (travelerRef.current && progressPathRef.current) {
          const pt = progressPathRef.current.getPointAtLength(totalLength * self.progress);
          travelerRef.current.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`;
        }

        CHECKPOINTS.forEach((cp, i) => {
          const lit = pct >= cp.topPct;
          const dot = dotRefs.current[i];
          const card = cardRefs.current[i];
          if (dot) {
            const alreadyLit = dot.dataset.lit === 'true';
            if (lit !== alreadyLit) {
              dot.dataset.lit = String(lit);
              gsap.to(dot, {
                scale: lit ? 1.25 : 1,
                boxShadow: lit ? '0 0 24px 6px rgba(var(--color-accent-rgb),0.65)' : '0 0 0 rgba(0,0,0,0)',
                duration: 0.4,
                ease: 'back.out(2)',
              });
            }
          }
          if (card) {
            const alreadyLit = card.dataset.lit === 'true';
            if (lit !== alreadyLit) {
              card.dataset.lit = String(lit);
              gsap.to(card, { opacity: lit ? 1 : 0, y: lit ? 0 : 16, duration: 0.45, ease: 'power2.out' });
            }
          }
        });
      },
    });

    return () => trigger.kill();
  }, { scope: roadRef });

  return (
    <section id="how-it-works" className="relative bg-[var(--color-canvas)] py-24 px-4 overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-[var(--color-accent)]/6 rounded-full blur-[180px] pointer-events-none" />

      <div className="max-w-3xl mx-auto relative text-center mb-16">
        <span className="section-eyebrow-violet mb-4 inline-flex">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          How it works
        </span>
        <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
          Three checkpoints.
          <br />
          <span className="gradient-text-violet">One outcome.</span>
        </h2>
        <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto">
          Scroll through the road below — every stage lights up as you reach it.
        </p>
      </div>

      <div ref={roadRef} className="relative max-w-2xl mx-auto" style={{ height: `${ROAD_HEIGHT}px` }}>
        <svg
          width={CENTER_X + AMPLITUDE + 20}
          height="100%"
          viewBox={`0 0 ${CENTER_X + AMPLITUDE + 20} ${ROAD_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute left-0 top-0"
        >
          {/* Base road — always fully visible, dim */}
          <path ref={basePathRef} d={pathD} fill="none" stroke="var(--color-ink)" strokeOpacity={0.12} strokeWidth={3} strokeLinecap="round" />
          {/* Traveled portion — bright, revealed with scroll */}
          <path
            ref={progressPathRef}
            d={pathD}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={3}
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 6px rgba(var(--color-accent-rgb),0.65))' }}
          />
        </svg>
        {/* Traveler dot */}
        <div
          ref={travelerRef}
          className="absolute left-0 top-0 w-3 h-3 rounded-full bg-[var(--color-accent-lighter)]"
          style={{ boxShadow: '0 0 22px 6px rgba(var(--color-accent-rgb),0.85)' }}
        />

        {CHECKPOINTS.map((cp, i) => {
          const Icon = cp.icon;
          return (
            <div key={cp.key}>
              {/* Checkpoint node — sits exactly on the road at its top% */}
              <div
                ref={(el) => { dotRefs.current[i] = el; }}
                data-lit="false"
                className="group absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full border-2 flex items-center justify-center bg-[var(--color-canvas-line-soft)] border-[var(--color-canvas-line)] data-[lit=true]:bg-[var(--color-accent)] data-[lit=true]:border-[var(--color-accent-lighter)] transition-colors duration-300 z-10"
                style={{ top: `${cp.topPct}%`, left: `${CENTER_X}px` }}
              >
                <Icon className="w-4 h-4 text-[var(--color-ink-dim)] group-data-[lit=true]:text-white transition-colors duration-300" />
              </div>

              {/* Label + card — top edge aligned with the dot's center, flows downward */}
              <div
                ref={(el) => { cardRefs.current[i] = el; }}
                data-lit="false"
                className="absolute left-0 right-0 pl-[140px] sm:pl-[160px]"
                style={{ top: `calc(${cp.topPct}% - 12px)` }}
              >
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-xs font-mono tracking-widest text-[var(--color-accent-dim)] font-bold">{cp.num}</span>
                  <h3 className="text-xl md:text-2xl font-display font-bold text-[var(--color-ink)]">{cp.title}</h3>
                </div>
                <p className="text-[var(--color-accent-lighter)] font-medium text-sm mb-3">{cp.body}</p>
                <div className="max-w-[220px] sm:max-w-xs">
                  <CheckpointCard cp={cp} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
