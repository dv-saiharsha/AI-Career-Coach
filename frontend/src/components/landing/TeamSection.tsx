'use client';

import { useEffect, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const TEAM: {
  name: string
  role: string
  blurb: string
  bio: string
  responsibilities: string[]
  initials: string
  from: string
  to: string
  /** Optional real photo — drop files in `public/team/` (4:5 portrait,
   * ~800x1000px). Falls back to the gradient + initials card when unset. */
  photo?: string
}[] = [
  {
    name: 'Venkata Sai Harshith Danda',
    role: 'Founder & Frontend Engineer & AI Engineer',
    blurb: 'The original idea behind AI Career Coach. Designs and builds every pixel of the UI and frontend.',
    bio: "AI Career Coach started as Venkata Sai's idea — the whole product, from the particle hero to the resume diagnostics, was designed and built by him. He owns the entire frontend: every screen, animation, and interaction in the app.",
    responsibilities: ['Product direction', 'UI/UX design', 'Frontend architecture (Next.js/React)', 'Motion & interaction design'],
    initials: 'VS',
    from: '#8B5CF6',
    to: '#4C1D95',
    photo: '/team/venkata-sai.jpeg',
  },
  {
    name: 'Varma Tamada',
    role: 'Backend Engineer & Data Engineer',
    blurb: 'Owns the backend and everything related to data storage and persistence.',
    bio: 'Varma owns the backend end-to-end — the API layer, business logic, and everything related to how AI Career Coach stores and serves data, from resume analyses to interview history.',
    responsibilities: ['API design (FastAPI)', 'Database & data storage', 'Backend architecture', 'Data pipelines'],
    initials: 'V',
    from: '#7C3AED',
    to: '#312E81',
    photo: '/team/varma.jpeg',
  },
  {
    name: 'Md. Zubair Khan',
    role: 'AI/ML Engineer',
    blurb: 'Owns the AI layer — the models and prompts behind every score and prediction.',
    bio: "Zubair owns the AI layer — the LLM prompts and scoring models that predict ATS outcomes and evaluate interview answers, plus the fallback logic and data pipeline that keep accuracy climbing.",
    responsibilities: ['LLM prompt engineering', 'ATS scoring models', 'Interview evaluation AI', 'Data & experimentation'],
    initials: 'ZK',
    from: '#6D28D9',
    to: '#2E1065',
    photo: '/team/zubair.jpeg',
  },
  {
    name: 'Kamal Ravula',
    role: 'Security Engineer ',
    blurb: 'Implements authentication, data protection, and security across the platform.',
    bio: "Kamal is responsible for keeping the platform and its users safe — authentication, data protection, and security practices across every layer of AI Career Coach.",
    responsibilities: ['Authentication & authorization', 'Data protection & encryption', 'Security audits', 'Vulnerability management'],
    initials: 'K',
    from: '#A78BFA',
    to: '#5B21B6',
    photo: '/team/kamal.jpeg',
  },
  {
    name: 'Bhavya Sree',
    role: 'Growth Marketing & Growth Strategist',
    blurb: 'A core member working across the whole stack, shipping features end-to-end.',
    bio: 'Bhavya works across the entire stack — from React components to API endpoints — closing the gap between frontend and backend and shipping full features end-to-end.',
    responsibilities: ['Full-stack feature development', 'Frontend + backend integration', 'API & UI parity', 'Cross-team shipping'],
    initials: 'BS',
    from: '#C084FC',
    to: '#7E22CE',
    photo: '/team/bhavya.jpeg',
  },
  {
    name: 'Shiva Valluri',
    role: 'Marketing Lead',
    blurb: 'Drives growth, positioning, and marketing for AI Career Coach.',
    bio: 'Shiva drives how the world finds out about AI Career Coach — positioning, growth strategy, content, and everything marketing-related for the product.',
    responsibilities: ['Growth strategy', 'Brand & positioning', 'Content & campaigns', 'User acquisition'],
    initials: 'S',
    from: '#C4B5FD',
    to: '#6D28D9',
    photo: '/team/shiva.jpeg',
  },
];

const N = TEAM.length;

function shortestOffset(i: number, active: number) {
  let diff = i - active;
  if (diff > N / 2) diff -= N;
  if (diff < -N / 2) diff += N;
  return diff;
}

export function TeamSection() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const activeMember = openIndex !== null ? TEAM[openIndex] : null;

  const advance = useCallback((dir: 1 | -1) => {
    setActive((i) => (i + dir + N) % N);
  }, []);

  useEffect(() => {
    if (paused || openIndex !== null) return;
    const id = setInterval(() => advance(1), 4500);
    return () => clearInterval(id);
  }, [paused, openIndex, advance]);

  return (
    <section className="py-24 px-4 border-t border-[var(--color-canvas-line-soft)] relative bg-[var(--color-canvas-deep)] overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[var(--color-accent)]/8 rounded-full blur-[160px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="section-eyebrow-violet mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            The team
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
            Built by six people,
            <br />
            <span className="gradient-text-violet">one obsession.</span>
          </h2>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto">
            Small team, real ownership — click the centered card for the full story.
          </p>
        </motion.div>

        <div
          className="relative h-[440px] flex items-center justify-center select-none"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {TEAM.map((member, i) => {
            const offset = shortestOffset(i, active);
            const isCenter = offset === 0;
            const visible = Math.abs(offset) <= 1;

            return (
              <motion.div
                key={member.name}
                className="absolute w-[260px] md:w-[280px]"
                animate={{
                  x: offset * 210,
                  scale: isCenter ? 1 : 0.85,
                  opacity: visible ? (isCenter ? 1 : 0.45) : 0,
                  zIndex: isCenter ? 30 : 20 - Math.abs(offset),
                  rotate: isCenter ? 0 : offset * 4,
                }}
                transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                style={{ pointerEvents: visible ? 'auto' : 'none' }}
              >
                <button
                  type="button"
                  onClick={() => (isCenter ? setOpenIndex(i) : setActive(i))}
                  className="block w-full text-left rounded-3xl overflow-hidden border border-[var(--color-canvas-line)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
                >
                  {/* Photo area — real photo if provided, else gradient + initials */}
                  <div
                    className="relative h-[300px] flex items-center justify-center"
                    style={member.photo ? undefined : { background: `linear-gradient(160deg, ${member.from}55, ${member.to}dd)` }}
                  >
                    {member.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={member.photo} alt={member.name} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <>
                        <div
                          className="absolute inset-0 opacity-[0.06]"
                          style={{
                            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
                            backgroundSize: '18px 18px',
                          }}
                        />
                        <span className="font-display font-bold text-[var(--color-ink)]/25 text-[100px] leading-none select-none">
                          {member.initials}
                        </span>
                      </>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                    {isCenter && (
                      <span className="absolute bottom-3 right-3 text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink)]/70 bg-black/40 backdrop-blur-md rounded-full px-2.5 py-1">
                        Click for details
                      </span>
                    )}
                  </div>

                  <div className="bg-[var(--color-canvas-raise)] px-5 py-4">
                    <div className="text-[var(--color-ink)] font-display font-semibold text-lg">{member.name}</div>
                    <span className="inline-flex mt-2 text-[11px] font-mono uppercase tracking-widest text-[var(--color-accent-lighter)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded-full px-2.5 py-1">
                      {member.role}
                    </span>
                  </div>
                </button>
              </motion.div>
            );
          })}
        </div>

        {/* Active member's detail line */}
        <div className="max-w-md mx-auto text-center h-12 mt-2">
          <AnimatePresence mode="wait">
            <motion.p
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="text-sm text-[var(--color-ink-dim)]"
            >
              {TEAM[active].blurb}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-6 mt-8">
          <button
            type="button"
            onClick={() => advance(-1)}
            aria-label="Previous team member"
            className="w-9 h-9 rounded-full border border-[var(--color-canvas-line)] flex items-center justify-center text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)]/40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            {TEAM.map((member, i) => (
              <button
                key={member.name}
                type="button"
                aria-label={`Show ${member.name}`}
                onClick={() => setActive(i)}
                className={`h-1.5 rounded-full transition-all ${i === active ? 'w-6 bg-[var(--color-accent)]' : 'w-1.5 bg-[var(--color-canvas-line)] hover:bg-[var(--color-ink-faint)]'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => advance(1)}
            aria-label="Next team member"
            className="w-9 h-9 rounded-full border border-[var(--color-canvas-line)] flex items-center justify-center text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)]/40 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <Dialog.Root open={openIndex !== null} onOpenChange={(open) => !open && setOpenIndex(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92vw] max-w-lg bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-3xl overflow-hidden shadow-[0_40px_120px_-20px_rgba(var(--color-accent-rgb),0.3)] focus:outline-none">
            {activeMember && (
              <>
                <div
                  className="relative h-40 flex items-center justify-center"
                  style={activeMember.photo ? undefined : { background: `linear-gradient(160deg, ${activeMember.from}55, ${activeMember.to}dd)` }}
                >
                  {activeMember.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeMember.photo} alt={activeMember.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <span className="font-display font-bold text-[var(--color-ink)]/25 text-[70px] leading-none select-none">
                      {activeMember.initials}
                    </span>
                  )}
                  <Dialog.Close className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-[var(--color-ink)]/80 hover:text-[var(--color-ink)] hover:bg-black/60 transition-colors">
                    <X className="w-4 h-4" />
                  </Dialog.Close>
                </div>
                <div className="p-6">
                  <Dialog.Title className="text-2xl font-display font-bold text-[var(--color-ink)]">{activeMember.name}</Dialog.Title>
                  <Dialog.Description asChild>
                    <span className="inline-flex mt-2 mb-4 text-[11px] font-mono uppercase tracking-widest text-[var(--color-accent-lighter)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded-full px-2.5 py-1">
                      {activeMember.role}
                    </span>
                  </Dialog.Description>
                  <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed mb-5">{activeMember.bio}</p>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2.5">What they own</div>
                  <ul className="space-y-2">
                    {activeMember.responsibilities.map((r) => (
                      <li key={r} className="flex items-center gap-2.5 text-sm text-[var(--color-ink-subtle)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
