/**
 * The design tokens, ported from frontend/src/app/globals.css.
 *
 * Ported rather than shared, deliberately. The web tokens are CSS custom
 * properties consumed by Tailwind; React Native has no cascade, no custom
 * properties and no `color-mix`. A build step that generated these from the
 * stylesheet would be a build step to maintain for two dozen constants that
 * change roughly never.
 *
 * The contract instead is that the values are identical and this file says
 * where they came from. If a token changes on the web, it changes here —
 * frontend/scripts/check-contrast.mjs guards the ratios on that side, and
 * every colour below is one it has already cleared.
 *
 * Depth is surface colour plus a hairline, which is now the same model the
 * web uses. Under the old neumorphic system this file was the odd one out:
 * two shadows per surface do not exist in React Native, so mobile separated
 * by value while the web separated by light. The web moved to flat surfaces
 * with real steps and visible borders, so the two finally agree — and the
 * single shadow React Native does offer is now enough, because the target
 * shadow is an ordinary soft drop.
 */

export const palette = {
  light: {
    canvas: '#F3F2F8',
    canvasDeep: '#EAE8F2',
    canvasRaise: '#FFFFFF',
    canvasElevated: '#FFFFFF',

    ink: '#241B46',
    inkSubtle: '#3F3566',
    inkMuted: '#5D5486',
    inkFaint: '#635C85',

    line: 'rgba(36, 27, 70, 0.11)',
    lineStrong: 'rgba(36, 27, 70, 0.17)',

    accent: '#6D4AFF',
    accentLight: '#8B6BFF',
    accentDeep: '#5432D8',
    accentText: '#5432D8',
    onAccent: '#FFFFFF',
    accentTint: 'rgba(109, 74, 255, 0.10)',

    success: '#22704D',
    warning: '#7D5516',
    danger: '#8F3E3C',
    successTint: 'rgba(47, 143, 99, 0.12)',
    warningTint: 'rgba(163, 112, 31, 0.12)',
    dangerTint: 'rgba(184, 81, 79, 0.12)',
  },
  dark: {
    canvas: '#100C22',
    canvasDeep: '#0A0718',
    canvasRaise: '#191434',
    canvasElevated: '#211B41',

    ink: '#F4F0FF',
    inkSubtle: '#D6CFF0',
    inkMuted: '#A9A1CF',
    inkFaint: '#918AB6',

    line: 'rgba(176, 152, 255, 0.16)',
    lineStrong: 'rgba(176, 152, 255, 0.26)',

    accent: '#8B6BFF',
    accentLight: '#B79CFF',
    accentDeep: '#5F3FE0',
    accentText: '#B79CFF',
    onAccent: '#FFFFFF',
    accentTint: 'rgba(139, 107, 255, 0.14)',

    success: '#6FDBA4',
    warning: '#F0B76B',
    danger: '#F08B8B',
    successTint: 'rgba(111, 219, 164, 0.12)',
    warningTint: 'rgba(240, 183, 107, 0.12)',
    dangerTint: 'rgba(240, 139, 139, 0.12)',
  },
} as const

/* Keys from the dark palette, values widened to string. Without the
   widening `as const` types every colour as its own literal, and the light
   palette then fails to satisfy a type built from the dark one — two
   palettes that are structurally identical but nominally incompatible. */
export type Palette = Record<keyof (typeof palette)['dark'], string>

/** 8px grid, matching the web spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

/* Matches the web scale after the flat rebuild (8-20px, was 12-30px). Very
   round corners read as a pillow on a shadow-only surface and as a bubble on
   a bordered one. */
export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  pill: 999,
} as const

/**
 * The one shadow React Native gives you, at the three web elevations.
 *
 * Spread as `...elevation.sm` into a style. Android reads `elevation` and
 * ignores the rest; iOS reads the four shadow* keys and ignores elevation,
 * so both are declared and each platform takes what it understands.
 *
 * Deliberately shallow. These sit on top of a real surface step and a
 * hairline, so the shadow is the third thing separating a card, not the
 * first — a heavy one would look like a different design system from the web.
 */
export const elevation = {
  sm: {
    shadowColor: '#241B46',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#241B46',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  lg: {
    shadowColor: '#241B46',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const

/**
 * A 44pt floor on anything tappable. This is the same rule the web side
 * enforces in its Button primitive, and it is the one number here that is a
 * platform requirement rather than a house style — Apple's HIG and Android's
 * accessibility guidance both land on roughly this.
 */
export const HIT_SLOP_MIN = 44

export const type = {
  display: { fontSize: 30, lineHeight: 34, fontWeight: '600' },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '600' },
  section: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodySm: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '500', letterSpacing: 0.6 },
} as const
