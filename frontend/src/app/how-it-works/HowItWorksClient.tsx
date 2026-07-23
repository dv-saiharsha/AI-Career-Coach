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
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -24 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.07 }}
      className="grid grid-cols-[auto,1fr] gap-5 items-start group relative"
    >
      {/* Step number */}
      <div
        className="relative w-14 h-14 shrink-0 rounded-xl flex items-center justify-center text-xs font-mono font-bold border group-hover:scale-105 transition-transform z-10 bg-[var(--color-canvas-deep)]"
        style={{ backgroundColor: `${color}12`, borderColor: `${color}30`, color }}
      >
        {step.num}
      </div>

      {/* Content */}
      <div className="glass-card-hover p-5">
        <h3 className="font-display font-semibold text-[var(--color-ink)] mb-2">{step.title}</h3>
        <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed mb-3">{step.desc}</p>
        <div
          className="text-xs font-mono p-3 rounded-lg leading-relaxed"
          style={{ backgroundColor: `${color}08`, color: color, border: `1px solid ${color}20` }}
        >
          {step.detail}
        </div>
      </div>
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
        className="flex items-center gap-4 mb-8"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold"
          style={{ backgroundColor: `${phase.color}20`, color: phase.color }}
        >
          {phase.phase.split(' ')[1]}
        </div>
        <div>
          <div className="text-xs font-mono uppercase tracking-widest" style={{ color: phase.color }}>
            {phase.phase}
          </div>
          <div className="font-display font-semibold text-[var(--color-ink)] text-xl">{phase.title}</div>
        </div>
        <div className="flex-1 h-px" style={{ backgroundColor: `${phase.color}20` }} />
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
      <section className="px-4 pb-24">
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
