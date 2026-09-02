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
 * The shadow system does NOT come across. Neumorphism needs two shadows per
 * surface, one light and one dark, and React Native gives you exactly one on
 * iOS and an elevation integer on Android. Attempting it would produce a
 * smudge on one platform and a drop shadow on the other. Depth on mobile is
 * carried by surface colour instead — canvas, raised, elevated are three
 * genuinely different values, which is what the web system leans on shadows
 * to avoid needing.
 */

export const palette = {
  light: {
    canvas: '#EAE6F7',
    canvasDeep: '#E2DDF3',
    canvasRaise: '#EDEAF9',
    canvasElevated: '#F3F0FC',

    ink: '#241B46',
    inkSubtle: '#3F3566',
    inkMuted: '#5D5486',
    inkFaint: '#635C85',

    line: 'rgba(84, 50, 216, 0.10)',
    lineStrong: 'rgba(84, 50, 216, 0.14)',

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
    canvas: '#150F2E',
    canvasDeep: '#100B24',
    canvasRaise: '#1A1338',
    canvasElevated: '#1F1743',

    ink: '#F4F0FF',
    inkSubtle: '#D6CFF0',
    inkMuted: '#A9A1CF',
    inkFaint: '#918AB6',

    line: 'rgba(160, 130, 255, 0.10)',
    lineStrong: 'rgba(160, 130, 255, 0.16)',

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

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
  pill: 999,
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
