'use client';

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ProductShowcase } from '../../components/landing/ProductShowcase';
import { CTASection } from '../../components/landing/CTASection';
import { useAccentPalette } from '../../lib/useAccentPalette';
import { spring, springSoft } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

function buildPhases(palette: ReturnType<typeof useAccentPalette>) { return [
  {
    phase: 'Phase 1',
    title: 'Resume Optimization',
    color: palette.accent,
    steps: [
      {
        num: '01',
        title: 'Upload Your Resume',
        desc: 'Drag and drop your PDF or DOCX file. Our file processor validates format, size, and readability. Parsing begins immediately.',
        detail: 'Supports: PDF (recommended), DOCX. Max size: 10MB. Processing: < 3 seconds.',
      },
      {
        num: '02',
        title: 'AI Parses Resume',
        desc: 'Our NLP pipeline extracts every section of your resume: contact info, summary, experience, education, skills, certifications, and projects.',
        detail: 'Technology: GPT-4 + custom resume parsing model. Accuracy: 99%.',
      },
      {
        num: '03',
        title: 'Skill Extraction',
        desc: 'Every skill is identified, categorized (hard/soft/tools/domains), and weighted by recency and context within your career narrative.',
        detail: 'Skill library: 1,200+ skills. Categories: Technical, Soft, Domain, Tools, Certs.',
      },
      {
        num: '04',
        title: 'Compare with Job Description',
        desc: 'Paste any job description. Our AI aligns your skills, experience, and language against what the role is actually asking for.',
        detail: 'Analysis depth: 5 layers — keywords, skills, experience level, industry signals, ATS patterns.',
      },
      {
        num: '05',
        title: 'Generate ATS Score',
        desc: 'A precision ATS match score (0-100) is calculated using keyword coverage, semantic match, and formatting signals from 200+ real ATS systems.',
        detail: 'Correlation with real ATS passthrough: 94%. Score breakdown: 5 sub-components.',
      },
      {
        num: '06',
        title: 'Identify Missing Skills',
        desc: 'Every skill in the JD that is absent from your resume is surfaced, ranked by importance to the role, and explained with context.',
        detail: 'Output: prioritized list with frequency rank, context quote, and suggested resume placement.',
      },
      {
        num: '07',
        title: 'Generate AI Suggestions',
        desc: 'GPT-4 generates line-by-line rewrites, new bullet points to add, better phrasing for existing content, and structural improvements.',
        detail: 'Average suggestions per resume: 12-18. Suggestion types: rewrite, add, remove, restructure.',
      },
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Interview Preparation',
    color: palette.accentLight,
    steps: [
      {
        num: '08',
        title: 'Prepare Interview Questions',
        desc: 'Based on your resume and the target JD, our AI generates a personalized set of technical and behavioral questions most likely to be asked.',
        detail: 'Question types: Technical, System Design, Behavioral, Role-Specific, Culture Fit.',
      },
      {
        num: '09',
        title: 'Practice Mock Interview',
        desc: 'Enter our conversational AI interview environment. Questions are asked one at a time. Type or speak your answers. The AI listens and responds.',
        detail: 'Experience: Conversational chat interface. Difficulty: Adaptive. Session: 30-45 min.',
      },
      {
        num: '10',
        title: 'Receive AI Feedback',
        desc: 'After each answer, you get an immediate score across three dimensions: technical depth, communication clarity, and confidence level.',
        detail: 'Scoring dimensions: Technical (40%), Communication (35%), Confidence (25%). Scale: 0-100.',
      },
      {
        num: '11',
        title: 'Download Your Report',
        desc: 'Generate a comprehensive PDF report containing your ATS analysis, keyword gaps, AI suggestions, and full interview session summary.',
        detail: 'Format: PDF. Pages: 8-15. Sections: Executive Summary, ATS Analysis, Skills, Interview, Roadmap.',
      },
      {
        num: '12',
        title: 'Track Progress',
        desc: 'Every session is saved. Return to practice tomorrow, next week, or next month. Watch your scores improve with visual analytics.',
        detail: 'Metrics tracked: ATS score, Interview scores, Questions mastered, Sessions completed.',
      },
    ],
  },
]; }

type Phase = ReturnType<typeof buildPhases>[number];
type Step = Phase['steps'][number];

function StepCard({ step, color, index }: {
  step: Step;
  color: string;
  index: number;
}) {
  const { ref, inView } = useInView({ threshold: 0.2, triggerOnce: true });

  return (
    /* Choreographed reveal: the node lands first, its card follows a beat
       later, so the eye tracks down the rail instead of seeing whole rows pop
       at once. Springs rather than durations, so a fast scroll settles
       cleanly instead of restarting. */
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.09, delayChildren: index * 0.05 } },
      }}
      className="group relative grid grid-cols-[auto_1fr] items-start gap-6"
    >
      {/* Step number — sits on the rail, so its background must be fully
          opaque. An 8-digit hex tint here would let the line show through the
          numeral; color-mix keeps the tint but stays solid. */}
      <motion.div
        variants={{
          hidden: { opacity: 0, scale: 0.6 },
          show: { opacity: 1, scale: 1, transition: spring },
        }}
        className="relative z-10 flex size-14 shrink-0 items-center justify-center rounded-xl border font-mono text-sm font-semibold tabular-nums transition-transform duration-200 group-hover:scale-105"
        style={{
          background: `color-mix(in srgb, ${color} 12%, var(--canvas))`,
          borderColor: `color-mix(in srgb, ${color} 30%, var(--canvas))`,
          color,
        }}
      >
        {step.num}
      </motion.div>

      {/* Content */}
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 18 },
          show: { opacity: 1, y: 0, transition: springSoft },
        }}
        className="glass-card-hover p-5"
      >
        <motion.h3
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: { opacity: 1, y: 0, transition: springSoft },
          }}
          className="mb-2 font-semibold tracking-tight text-ink"
        >
          {step.title}
        </motion.h3>
        <p className="mb-3 text-sm leading-relaxed text-ink-dim">{step.desc}</p>
        <div
          className="rounded-lg p-3 font-mono text-xs leading-relaxed"
          style={{
            background: `color-mix(in srgb, ${color} 7%, var(--canvas-raise))`,
            border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
            color,
          }}
        >
          {step.detail}
        </div>
      </motion.div>
    </motion.div>
  );
}

function PhaseBlock({ phase }: { phase: Phase }) {
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!fillRef.current || !railRef.current) return;
    gsap.fromTo(
      fillRef.current,
      { height: '0%' },
      {
        height: '100%',
        ease: 'none',
        scrollTrigger: {
          trigger: railRef.current,
          start: 'top 65%',
          end: 'bottom 65%',
          scrub: 0.5,
        },
      }
    );
  }, { scope: railRef });

  return (
    <div>
      {/* Phase header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        /* Same column geometry as StepCard, so the phase badge, the step
           badges, and the rail all sit on one 28px axis. */
        className="mb-10 grid grid-cols-[auto_1fr] items-center gap-6"
      >
        <div className="flex w-14 justify-center">
          <div
            className="flex size-8 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums"
            style={{
              background: `color-mix(in srgb, ${phase.color} 18%, var(--canvas))`,
              color: phase.color,
            }}
          >
            {phase.phase.split(' ')[1]}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="flex flex-col gap-1">
            <span
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: phase.color }}
            >
              {phase.phase}
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-ink">{phase.title}</h2>
          </div>
          {/* Rule is a sibling of the text, not centred against it, so it can
              never cross the title. */}
          <div
            aria-hidden="true"
            className="mt-2 h-px min-w-16 flex-1"
            style={{ background: `color-mix(in srgb, ${phase.color} 22%, transparent)` }}
          />
        </div>
      </motion.div>

      {/* Steps with scroll-linked progress rail */}
      <div ref={railRef} className="relative">
        <div className="absolute left-7 top-2 bottom-2 w-px bg-[var(--color-canvas-line-soft)]" />
        <div
          ref={fillRef}
          className="absolute left-7 top-2 w-px"
          style={{ height: '0%', background: `linear-gradient(to bottom, ${phase.color}, transparent)` }}
        />
        <div className="space-y-4">
          {phase.steps.map((step, i) => (
            <StepCard key={step.num} step={step} color={phase.color} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HowItWorksClient() {
  const palette = useAccentPalette();
  const PHASES = buildPhases(palette);
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden pt-36 pb-16 px-4">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-[var(--color-accent)]/8 rounded-full blur-[160px] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl mx-auto text-center relative"
        >
          <span className="section-eyebrow-violet mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            Complete Workflow
          </span>
          <h1 className="text-5xl md:text-7xl font-display font-semibold tracking-tight mt-4 mb-5">
            From upload to<br />
            <span className="gradient-text-violet">interview-ready</span>
          </h1>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-2xl mx-auto leading-relaxed">
            Zenith runs a complete, automated 12-step pipeline that transforms your resume into a fully optimized application and your preparation into a competitive advantage.
          </p>
        </motion.div>
      </section>

      {/* Phase sections */}
      <section className="relative overflow-hidden px-4 pb-24">
        <div className="max-w-4xl mx-auto space-y-20">
          {PHASES.map((phase) => (
            <PhaseBlock key={phase.phase} phase={phase} />
          ))}
        </div>
      </section>

      <ProductShowcase />
      <CTASection />
    </main>
  );
}
