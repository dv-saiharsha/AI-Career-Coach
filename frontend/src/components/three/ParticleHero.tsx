'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';

type Point = { x: number; y: number; kind: 'frame' | 'tile' | 'line' | 'peak' | 'bar' | 'grid' };

/* ── Virtual dashboard blueprint (assembled shape, in local units) ───── */
function sampleRoundedRect(cx: number, cy: number, w: number, h: number, r: number, step: number): [number, number][] {
  const pts: [number, number][] = [];
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  for (let x = x0 + r; x <= x1 - r; x += step) { pts.push([x, y0]); pts.push([x, y1]); }
  for (let y = y0 + r; y <= y1 - r; y += step) { pts.push([x0, y]); pts.push([x1, y]); }
  const corners: [number, number, number, number][] = [
    [x0 + r, y0 + r, Math.PI, 1.5 * Math.PI],
    [x1 - r, y0 + r, 1.5 * Math.PI, 2 * Math.PI],
    [x1 - r, y1 - r, 0, 0.5 * Math.PI],
    [x0 + r, y1 - r, 0.5 * Math.PI, Math.PI],
  ];
  for (const [ccx, ccy, a0, a1] of corners) {
    for (let a = a0; a <= a1; a += step / r) pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
  }
  return pts;
}

function sampleLine(x0: number, y0: number, x1: number, y1: number, step: number): [number, number][] {
  const pts: [number, number][] = [];
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.floor(dist / step));
  for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  return pts;
}

function samplePolyline(nodes: [number, number][], step: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < nodes.length - 1; i++) pts.push(...sampleLine(nodes[i][0], nodes[i][1], nodes[i + 1][0], nodes[i + 1][1], step));
  return pts;
}

function sampleCircle(cx: number, cy: number, r: number, step: number): [number, number][] {
  const pts: [number, number][] = [];
  const n = Math.max(6, Math.floor((2 * Math.PI * r) / step));
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

function buildBlueprint(): Point[] {
  const points: Point[] = [];

  // Outer frame
  sampleRoundedRect(0, 0, 560, 340, 18, 5).forEach(([x, y]) => points.push({ x, y, kind: 'frame' }));

  // Window controls
  [-250, -232, -214].forEach((x) => sampleCircle(x, -148, 4.5, 3).forEach(([px, py]) => points.push({ x: px, y: py, kind: 'frame' })));

  // Header divider
  sampleLine(-260, -128, 260, -128, 6).forEach(([x, y]) => points.push({ x, y, kind: 'frame' }));

  // Three KPI tiles
  [-172, 0, 172].forEach((cx) => {
    sampleRoundedRect(cx, -78, 150, 62, 10, 4).forEach(([x, y]) => points.push({ x, y, kind: 'tile' }));
    sampleLine(cx - 55, -90, cx - 15, -90, 4).forEach(([x, y]) => points.push({ x, y, kind: 'tile' }));
    sampleLine(cx - 55, -68, cx + 10, -68, 4).forEach(([x, y]) => points.push({ x, y, kind: 'tile' }));
  });

  // Chart gridlines (faint)
  [30, 65, 100, 135].forEach((y) => sampleLine(-250, y, 250, y, 10).forEach(([x, gy]) => points.push({ x, y: gy, kind: 'grid' })));

  // Rising line graph (the heartbeat line)
  const graphNodes: [number, number][] = [
    [-250, 118], [-190, 132], [-150, 100], [-105, 138], [-60, 40], [-25, 78], [15, -10], [60, 55], [100, -55], [145, 5], [185, -95], [250, -120],
  ];
  samplePolyline(graphNodes, 3).forEach(([x, y]) => points.push({ x, y, kind: 'line' }));

  // Peak marker (pulses hardest)
  sampleCircle(250, -120, 7, 2).forEach(([x, y]) => points.push({ x, y, kind: 'peak' }));
  sampleCircle(185, -95, 5, 2.5).forEach(([x, y]) => points.push({ x, y, kind: 'peak' }));

  // Small bar sparkline beneath
  const barHeights = [14, 22, 18, 30, 26, 38, 34, 44];
  barHeights.forEach((h, i) => {
    const x = -246 + i * 34;
    sampleRoundedRect(x, 168 - h / 2, 20, h, 3, 3).forEach(([px, py]) => points.push({ x: px, y: py, kind: 'bar' }));
  });

  return points;
}

/* ── Particle model ───────────────────────────────────────────────── */
type Particle = {
  ox: number; oy: number; // scattered origin (local units)
  tx: number; ty: number; // assembled target (local units)
  seed: number;
  delay: number;
  kind: Point['kind'];
  glow: boolean;
};

function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function clamp01(t: number) { return Math.min(1, Math.max(0, t)); }

/** Rises 0->1 while assembling, holds, then falls back to 0 — the dashboard
 * disperses back into scattered dots as the visitor scrolls past it. */
function assemblyEnvelope(t: number) {
  if (t < 0.55) return t / 0.55;
  if (t < 0.8) return 1;
  return clamp01(1 - (t - 0.8) / 0.2);
}
function gauss(x: number, mu: number, sigma: number) { return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)); }

function heartbeat(t: number) {
  const period = 1.8;
  const phase = (t % period) / period;
  return gauss(phase, 0.08, 0.018) + 0.65 * gauss(phase, 0.155, 0.022);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Reads the current theme's accent colors from CSS vars so the canvas
 * (which can't see CSS) tracks the violet/amber toggle. */
function readAccentColors() {
  const style = getComputedStyle(document.documentElement);
  const accent = hexToRgb(style.getPropertyValue('--color-accent') || '#8B5CF6');
  const light = hexToRgb(style.getPropertyValue('--color-accent-light') || '#A78BFA');
  const lighter = hexToRgb(style.getPropertyValue('--color-accent-lighter') || '#C4B5FD');
  return { accent, light, lighter };
}

export default function ParticleHero({ progress }: { progress: MotionValue<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(0);
  const colorsRef = useRef<{ accent: [number, number, number]; light: [number, number, number]; lighter: [number, number, number] } | null>(null);

  const blueprint = useMemo(() => buildBlueprint(), []);

  const particles = useMemo<Particle[]>(() => {
    return blueprint.map((p, i) => {
      const angle = (i * 137.508 * Math.PI) / 180; // golden-angle scatter, deterministic
      const radius = 420 + ((i * 97) % 480);
      return {
        ox: Math.cos(angle) * radius,
        oy: Math.sin(angle) * radius * 0.7,
        tx: p.x,
        ty: p.y,
        seed: (i * 12.9898) % 6.283,
        delay: ((i * 61) % 100) / 100 * 0.55,
        kind: p.kind,
        glow: p.kind === 'line' || p.kind === 'peak',
      };
    });
  }, [blueprint]);

  useEffect(() => {
    const unsub = progress.on('change', (v) => { progressRef.current = v; });
    return () => unsub();
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    colorsRef.current = readAccentColors();
    const themeObserver = new MutationObserver(() => { colorsRef.current = readAccentColors(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let width = 0, height = 0, dpr = 1, scale = 1;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      scale = Math.min(width / 620, height / 420);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const baseT = progressRef.current;
      const cx = width / 2, cy = height / 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      const assemblyT = assemblyEnvelope(baseT);
      const lockFactor = clamp01((assemblyT - 0.9) / 0.1);
      const pulse = reduceMotion ? 0 : heartbeat(t) * lockFactor;

      for (const p of particles) {
        const localT = clamp01((assemblyT - p.delay) / (1 - p.delay || 1));
        const eased = easeOutCubic(localT);

        const driftAmp = reduceMotion ? 0 : (1 - eased) * 14;
        const swirl = reduceMotion ? 0 : Math.sin(t * 0.6 + p.seed) * driftAmp;
        const swirl2 = reduceMotion ? 0 : Math.cos(t * 0.8 + p.seed * 1.3) * driftAmp;

        const lx = p.ox + (p.tx - p.ox) * eased + swirl;
        const ly = p.oy + (p.ty - p.oy) * eased + swirl2;

        const sx = cx + lx * scale;
        const sy = cy + ly * scale;

        let baseAlpha = 0.12 + 0.8 * eased;
        let size = (0.9 + eased * 0.9) * scale * (p.kind === 'grid' || p.kind === 'frame' ? 0.85 : 1.15);

        if (p.glow) {
          baseAlpha = Math.min(1, baseAlpha + pulse * 0.6);
          size *= 1 + pulse * (p.kind === 'peak' ? 1.4 : 0.7);
        }
        const twinkle = reduceMotion ? 0 : Math.sin(t * 2.4 + p.seed) * 0.08;
        const alpha = clamp01(baseAlpha + twinkle);

        const colors = colorsRef.current ?? readAccentColors();
        let color: string;
        if (p.kind === 'peak') color = `rgba(${colors.lighter.join(',')}, ${alpha})`;
        else if (p.kind === 'line') color = `rgba(${colors.lighter.join(',')}, ${alpha})`;
        else if (p.kind === 'tile' || p.kind === 'bar') color = `rgba(${colors.light.join(',')}, ${alpha})`;
        else if (p.kind === 'grid') color = `rgba(${colors.accent.join(',')}, ${alpha * 0.35})`;
        else color = `rgba(${colors.accent.join(',')}, ${alpha * 0.7})`;

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(sx, sy, Math.max(0.6, size), 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft glow burst at the peak when the heartbeat fires
      if (pulse > 0.15) {
        const peakX = cx + 250 * scale;
        const peakY = cy - 120 * scale;
        const glowRgb = (colorsRef.current ?? readAccentColors()).lighter.join(',');
        const grad = ctx.createRadialGradient(peakX, peakY, 0, peakX, peakY, 70 * scale);
        grad.addColorStop(0, `rgba(${glowRgb},${0.35 * pulse})`);
        grad.addColorStop(1, `rgba(${glowRgb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(peakX, peakY, 70 * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); themeObserver.disconnect(); };
  }, [particles]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
