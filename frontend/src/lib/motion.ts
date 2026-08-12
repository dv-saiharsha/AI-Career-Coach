import type { Transition, Variants } from 'framer-motion'

/* ────────────────────────────────────────────────────────────────────────
   MOTION SYSTEM

   One vocabulary of springs, shared by every animated surface. Physics is
   preferred over duration curves so interruptions (a second hover before
   the first settles) resolve naturally instead of restarting.

   Rule of thumb: `spring` for anything the user pointed at, `springSoft`
   for layout/entrance, `springSnappy` for small state flips (toggles,
   indicators). Exits run faster than entrances — leaving should never cost
   the user attention.
   ──────────────────────────────────────────────────────────────────────── */

/** The house spring. Matches the brief: stiffness 300, damping 30. */
export const spring: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
}

/** Longer travel — page/section entrances, sheet and dialog surfaces. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 210,
  damping: 32,
  mass: 0.9,
}

/** Short travel with authority — nav pills, tabs, switches, chips. */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.6,
}

/** For opacity/colour, where a spring reads as sloppy. */
export const ease: Transition = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
}

export const easeExit: Transition = {
  duration: 0.16,
  ease: [0.4, 0, 1, 1],
}

/* ── Reusable variants ─────────────────────────────────────────────────── */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -8, transition: easeExit },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: ease },
  exit: { opacity: 0, transition: easeExit },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.98, transition: easeExit },
}

/**
 * Parent for staggered reveals. Children should use `fadeUp` (or any variant
 * with matching `hidden`/`show` keys) — the parent drives the timing.
 */
export const staggerContainer = (stagger = 0.06, delayChildren = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren },
  },
})

/** Shared `whileInView` config: fire once, slightly before full entry. */
export const inView = {
  once: true,
  amount: 0.25,
  margin: '0px 0px -80px 0px',
} as const

/* ── Interaction presets ───────────────────────────────────────────────── */

export const hoverLift = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: spring,
} as const

export const hoverPress = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: springSnappy,
} as const

/**
 * Layout-animation ids. Centralised so two components never accidentally
 * share one — Framer will otherwise tween between unrelated elements.
 */
export const layoutIds = {
  navPill: 'nav-pill',
  tabPill: 'tab-pill',
  sidebarPill: 'sidebar-pill',
  stepPill: 'step-pill',
} as const
