import { cn } from '@/lib/utils'

interface LogoProps {
  compact?: boolean
  inverse?: boolean
  className?: string
}

// The exact mark from figma-export/src/components/brand.tsx — a woven "H".
export function Logo({ compact = false, inverse = false, className }: LogoProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5', inverse ? 'text-white' : 'text-primary', className)}>
      <svg className="h-[29px] w-[29px]" viewBox="0 0 36 36" aria-hidden="true">
        <path
          d="M8 7v22M28 7v22M8 13c7 0 13 10 20 10M8 23c7 0 13-10 20-10"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
      {!compact && (
        <span
          className={cn(
            'font-heading text-xl font-extrabold tracking-[-0.04em]',
            inverse ? 'text-white' : 'text-foreground'
          )}
        >
          HireLoom
        </span>
      )}
    </div>
  )
}
