import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Favicon. Mirrors <ApplyCenterMark> with literal colours — this renders at
 * build time through Satori, where CSS custom properties do not resolve.
 *
 * The values below were the retired Porcelain & Obsidian palette long after
 * that system was replaced, which is the failure mode this file invites: it
 * cannot read a token, so it silently keeps whatever was hardcoded. They are
 * now the monochrome ground and the signal blue, and they have to be updated
 * by hand whenever those change.
 *
 * A dark ground in both themes on purpose: a favicon has no theme context,
 * and a tab strip is more often light than not.
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
          background: '#0A0A0A',
          borderRadius: 7,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <path
            d="M24.92 7.97 A12 12 0 1 0 24.92 24.03"
            stroke="#FAFAFA"
            strokeWidth="3.3"
            strokeLinecap="round"
          />
          <path
            d="M11 23.5 L16 7.1 L21 23.5"
            stroke="#FAFAFA"
            strokeWidth="3.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12.49 18.6 H19.51" stroke="#7CB2FF" strokeWidth="3.3" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
