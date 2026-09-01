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

/* ── Canonical physics ─────────────────────────────────────────────────── */

/** Primary interactions and cards. The house spring. */
export const APPLE_SPRING: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 28,
  mass: 0.8,
}

/** Tabs, pills, switches — instant state switches that should feel decisive. */
export const SNAP_SPRING: Transition = {
  type: 'spring',
  stiffness: 450,
  damping: 35,
}

/** Ambient floating elements. Low stiffness so drift reads as weightless. */
export const GENTLE_DRIFT: Transition = {
  type: 'spring',
  stiffness: 120,
  damping: 20,
}

/* ── Named aliases ─────────────────────────────────────────────────────────
   These were the original vocabulary (300/30 and 420/34). The canonical
   values above supersede them at differences well inside perceptual noise,
   so they alias rather than coexist — two springs a few units apart under
   different names is how a motion system drifts into having no system.  */

/** @see APPLE_SPRING */
export const spring = APPLE_SPRING

/** @see SNAP_SPRING */
export const springSnappy = SNAP_SPRING

/**
 * Longer travel — page/section entrances, sheet and dialog surfaces.
 * Kept distinct: it is genuinely softer than APPLE_SPRING, and no constant
 * in the spec covers this range (GENTLE_DRIFT is softer still, for ambient
 * motion that never responds to input).
 */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 210,
  damping: 32,
  mass: 0.9,
}

/**
 * The house easing curve, as a raw tuple.
 *
 * Exported separately from `ease` because the same curve is needed in three
 * forms: a Framer transition, a bare array for one-off `transition` objects,
 * and `cubic-bezier(.22,1,.36,1)` in CSS (see `--ease-enter` in globals.css).
 * All three are the same numbers — change them together or not at all.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const

/** For opacity/colour, where a spring reads as sloppy. */
export const ease: Transition = {
  duration: 0.24,
  ease: EASE_OUT,
}

/**
 * Section reveal on scroll. Longer and softer than `fadeUp` — this is for
 * whole marketing sections entering the viewport, not for elements inside an
 * already-visible card.
 *
 * Pair with `viewport={{ once: true, margin: '-10%' }}`.
 */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE_OUT } },
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

/* ── Page transition ───────────────────────────────────────────────────────
   Route-level enter/exit.

   ⚠ `filter: blur()` is the one property here that cannot be composited on
   the GPU the way opacity and transform can — it repaints the whole subtree
   every frame it animates. On a route wrapper that subtree is the entire
   page, so this is applied deliberately and measured (see PAGE_TRANSITION_FAST
   below for the variant used where a route is heavy enough for that repaint
   to be felt).  */
export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
  transition: APPLE_SPRING,
} as const

/**
 * Same choreography without the blur — for routes dense enough (charts,
 * long lists, the Kanban board) that a full-subtree repaint per frame costs
 * more than the effect is worth.
 */
export const PAGE_TRANSITION_FAST = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: APPLE_SPRING,
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
