'use client';

import {
  FileSearch, Cpu, Target, Search, TrendingUp, Star, FileText, CheckCircle2,
  BrainCircuit, MessageCircle, BarChart2, Trophy, Clock, Users, Sparkles
} from 'lucide-react';
import { MetricsSection } from '../../components/landing/MetricsSection';
import { ProductShowcase } from '../../components/landing/ProductShowcase';
import { CTASection } from '../../components/landing/CTASection';
import { useAccentPalette } from '../../lib/useAccentPalette';
import { Reveal, RevealGroup } from '@/lib/reveal'

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
        detail: 'Technology: Claude plus a trained scoring model. See the model card in Reports for its measured error.',
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

function StepCard({ step, color }: {
  step: Step;
  color: string;
}) {

  return (
    /* Choreographed reveal: the node lands first, its card follows a beat
       later, so the eye tracks down the rail instead of seeing whole rows pop
       at once. Springs rather than durations, so a fast scroll settles
       cleanly instead of restarting. */
    <Reveal
     
     
     
      className="group relative grid grid-cols-[auto_1fr] items-start gap-6"
    >
      {/* Step number — sits on the rail, so its background must be fully
          opaque. An 8-digit hex tint here would let the line show through the
          numeral; color-mix keeps the tint but stays solid. */}
      <Reveal
        className="relative z-10 flex size-14 shrink-0 items-center justify-center rounded-xl border font-mono text-sm font-semibold tabular-nums transition-transform duration-200 group-hover:scale-105"
        style={{
          background: `color-mix(in srgb, ${color} 12%, var(--canvas))`,
          borderColor: `color-mix(in srgb, ${color} 30%, var(--canvas))`,
          color,
        }}
      >
        {step.num}
      </Reveal>

      {/* Content */}
      <Reveal
       
        className="glass-card-hover p-5"
      >
        <Reveal as="h3"
         
          className="mb-2 font-semibold tracking-tight text-ink"
        >
          {step.title}
        </Reveal>
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
      </Reveal>
    </Reveal>
  );
}

function PhaseBlock({ phase }: { phase: Phase }) {

  return (
    <div>
      {/* Phase header */}
      <Reveal
       
       
       
       
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
      </Reveal>

      {/* Steps with scroll-linked progress rail */}
      <div className="relative">
        <div className="absolute left-7 top-2 bottom-2 w-px bg-[var(--color-canvas-line-soft)]" />
        <div
          className="rail-fill absolute left-7 top-2 bottom-2 w-px"
          style={{ background: `linear-gradient(to bottom, ${phase.color}, transparent)` }}
        />
        <RevealGroup className="space-y-4">
          {phase.steps.map((step) => (
            <StepCard key={step.num} step={step} color={phase.color} />
          ))}
        </RevealGroup>
      </div>
    </div>
  );
}

const RESUME_FEATURES = [
  { icon: FileSearch, title: 'Resume Upload', desc: 'Drag-and-drop or click to upload PDF or DOCX files up to 10MB. Multi-format support with intelligent parsing.', badge: 'Core' },
  { icon: Cpu, title: 'AI Resume Parsing', desc: 'Our NLP engine extracts every detail from your resume — skills, experience, education, and achievements.', badge: 'AI' },
  { icon: Target, title: 'ATS Match Analysis', desc: 'Deep comparison against any job description. Know exactly which ATS keywords you have, which you\'re missing, and your match percentage.', badge: 'Core' },
  { icon: Search, title: 'Keyword Analysis', desc: 'Complete breakdown of hard skills, soft skills, certifications, tools, and technologies extracted from both your resume and the target JD.', badge: 'AI' },
  { icon: TrendingUp, title: 'Missing Skills Detection', desc: 'Identify every skill in the job description that\'s absent from your resume, ranked by frequency and importance to recruiters.', badge: 'AI' },
  { icon: Star, title: 'Resume Score', desc: 'A composite score (0-100) based on ATS match, keyword density, formatting signals, and completeness of key resume sections.', badge: 'Core' },
  { icon: Sparkles, title: 'AI Improvements', desc: 'Line-by-line rewrite suggestions, missing bullet points to add, and better phrasing recommendations — all generated by Claude, the model this product actually runs on.', badge: 'AI' },
  { icon: FileText, title: 'PDF Report Generation', desc: 'Download a professional branded PDF with your full analysis, ATS score, keyword gaps, skill extraction, and improvement plan.', badge: 'Pro' },
  { icon: CheckCircle2, title: 'Skill Extraction', desc: 'Automatically tags and categorizes your skills into technical, soft, domain, tooling, and certification buckets for easy review.', badge: 'Core' },
];

const INTERVIEW_FEATURES = [
  { icon: Users, title: 'Role Selection', desc: 'Choose from 20+ job roles including SWE, ML Engineer, Data Scientist, Product Manager, DevOps, and more.', badge: 'Core' },
  { icon: BrainCircuit, title: 'Technical Questions', desc: 'Role-specific technical questions covering algorithms, system design, language-specific topics, and real-world problem-solving.', badge: 'AI' },
  { icon: MessageCircle, title: 'Behavioral Questions', desc: 'STAR-method behavioral questions tailored to seniority level. Covers leadership, conflict resolution, failure stories, and more.', badge: 'AI' },
  { icon: Trophy, title: 'Mock Interview Mode', desc: 'Full end-to-end mock interview with timed questions, real-time coaching, and a comprehensive debrief at the end.', badge: 'Pro' },
  { icon: Star, title: 'AI Evaluation', desc: 'Every answer is scored against a database of ideal responses from top engineers. Evaluation happens in real time.', badge: 'AI' },
  { icon: MessageCircle, title: 'Communication Score', desc: 'Scored on clarity, sentence structure, conciseness, vocabulary, and how well your answer reads to a technical recruiter.', badge: 'AI' },
  { icon: BarChart2, title: 'Technical Score', desc: 'Evaluates depth, accuracy, completeness, edge case coverage, and whether you\'d have passed a real interview on this question.', badge: 'AI' },
  { icon: Trophy, title: 'Confidence Score', desc: 'Based on assertiveness, hedging language analysis, directness, and decisiveness in your responses.', badge: 'AI' },
  { icon: Clock, title: 'Interview History', desc: 'Every session is permanently saved. Review past answers, compare scores, and see which question types you\'re weakest on.', badge: 'Pro' },
  { icon: TrendingUp, title: 'Performance Tracking', desc: 'Track your scores across sessions. Visualize your improvement with charts showing technical, communication, and confidence trends.', badge: 'Pro' },
];

const BADGE_COLORS: Record<string, string> = {
  Core: 'bg-[var(--color-canvas-line-soft)] text-[var(--color-ink-dim)] border-[var(--color-canvas-line)]',
  AI: 'bg-(--color-signal-bg) text-(--color-signal) border-(--color-signal)/25',
  Pro: 'bg-(--color-warning-bg) text-(--color-warning) border-(--color-warning)/25',
};

function FeatureGrid({ features }: { features: typeof RESUME_FEATURES }) {

  return (
    <RevealGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {features.map(({ icon: Icon, title, desc, badge }) => (
        <Reveal
          key={title}
         
         
         
          className="glass-card-hover group p-5 hover:-translate-y-1"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-9 h-9 rounded-xl bg-(--color-signal-bg) flex items-center justify-center group-hover:opacity-80 transition-colors">
              <Icon className="w-[18px] h-[18px] text-(--color-signal)" />
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${BADGE_COLORS[badge]}`}>
              {badge}
            </span>
          </div>
          <h3 className="font-display font-semibold text-[var(--color-ink)] mb-2">{title}</h3>
          <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed">{desc}</p>
        </Reveal>
      ))}
    </RevealGroup>
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
        <Reveal
         
         
         
          className="max-w-4xl mx-auto text-center relative"
        >
          <span className="eyebrow mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            Complete Workflow
          </span>
          <h1 className="text-5xl md:text-7xl font-display font-semibold tracking-tight mt-4 mb-5">
            What you get, and<br />
            <span className="gradient-text-accent">how it works</span>
          </h1>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-2xl mx-auto leading-relaxed">
            Everything the product does, and the order it does it in. This used
            to be two pages that answered halves of the same question, so you
            had to read both and join them up yourself.
          </p>
        </Reveal>
      </section>

      <MetricsSection />

      {/* What you get.
          Both product areas stacked rather than behind a tab switcher. Tabs
          hide half the answer behind a click on a page whose entire job is to
          list what you get — and dropping them also drops Radix Tabs from a
          marketing route that was already over its bundle budget. */}
      <section className="border-t border-(--color-canvas-line-soft) px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mb-12 text-center">
            <span className="eyebrow mb-3 inline-flex">Resume Analyzer</span>
            <h2 className="text-section text-ink">Everything the scanner does</h2>
          </Reveal>
          <FeatureGrid features={RESUME_FEATURES} />

          <Reveal className="mb-12 mt-24 text-center">
            <span className="eyebrow mb-3 inline-flex">Interview Coach</span>
            <h2 className="text-section text-ink">Everything the practice does</h2>
          </Reveal>
          <FeatureGrid features={INTERVIEW_FEATURES} />
        </div>
      </section>

      {/* How it works */}
      <section className="relative overflow-hidden border-t border-(--color-canvas-line-soft) px-4 pb-24 pt-24">
        <Reveal className="mx-auto mb-16 max-w-2xl text-center">
          <span className="eyebrow mb-3 inline-flex">The pipeline</span>
          <h2 className="text-section text-ink">In the order it happens</h2>
        </Reveal>
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
