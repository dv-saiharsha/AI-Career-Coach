import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

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
          background: '#15111F',
          borderRadius: 7,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 32 32">
          <path d="M16 9 L5 27 L16 27 Z" fill="#6D28D9" />
          <path d="M16 9 L27 27 L16 27 Z" fill="#A78BFA" />
          <circle cx="16" cy="4.5" r="2.4" fill="#C4B5FD" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
