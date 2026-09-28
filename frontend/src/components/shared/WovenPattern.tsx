import { cn } from '@/lib/utils'

// Ported from figma-export/src/components/brand.tsx — the faint repeating
// weave motif behind the auth brand panel.
export function WovenPattern({ className }: { className?: string }) {
  return (
    <svg
      className={cn('pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.09]', className)}
      viewBox="0 0 600 600"
      aria-hidden="true"
    >
      <defs>
        <pattern id="weave" width="64" height="64" patternUnits="userSpaceOnUse">
          <path
            d="M-16 16C0 16 0 48 16 48s16-32 32-32 16 32 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M16-16C16 0 48 0 48 16S16 32 16 48s32 16 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#weave)" />
    </svg>
  )
}
