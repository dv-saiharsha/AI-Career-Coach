import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Favicon. Mirrors <ZenithMark> but with literal colours — this renders at
 * build time via Satori, where CSS custom properties are not resolvable, so
 * the Porcelain & Obsidian values are inlined rather than tokenised.
 * Obsidian ground is used in both themes: a favicon has no theme context.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B0F17',
          borderRadius: 7,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <path
            d="M22.31 6.87 L11 23.5 H24"
            stroke="#FAF8F5"
            strokeWidth="3.4"
            strokeLinecap="butt"
            strokeMiterlimit="2"
          />
          <path d="M7 11 H20" stroke="#FAF8F5" strokeWidth="3.4" strokeLinecap="butt" />
          <path d="M25.01 2.90 L25.12 8.78 L19.50 4.96 Z" fill="#D9B183" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
