import React from 'react'
import { cn } from '@/lib/utils'

interface ScoreRingProps {
  score: number // 0 - 100
  label?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'default' | 'ats' | 'technical' | 'communication' | 'overall'
  className?: string
  showPercentageSign?: boolean
}

export function ScoreRing({
  score,
  label,
  description,
  size = 'md',
  variant = 'default',
  className,
  showPercentageSign = true,
}: ScoreRingProps) {
  const normalizedScore = Math.min(Math.max(Math.round(score), 0), 100)

  // Size configurations
  const dimensions = {
    sm: { size: 64, stroke: 6, textSize: 'text-base font-bold', labelSize: 'text-[10px]' },
    md: { size: 96, stroke: 8, textSize: 'text-2xl font-bold', labelSize: 'text-xs' },
    lg: { size: 140, stroke: 10, textSize: 'text-4xl font-extrabold', labelSize: 'text-sm' },
    xl: { size: 180, stroke: 12, textSize: 'text-5xl font-black', labelSize: 'text-base' },
  }[size]

  const radius = (dimensions.size - dimensions.stroke) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference

  // Dynamic color selection based on score and variant
  const getColorClasses = () => {
    if (variant === 'ats') {
      if (normalizedScore >= 80) return { stroke: 'stroke-emerald-500', bg: 'text-emerald-500', track: 'stroke-emerald-500/20' }
      if (normalizedScore >= 65) return { stroke: 'stroke-blue-500', bg: 'text-blue-500', track: 'stroke-blue-500/20' }
      if (normalizedScore >= 50) return { stroke: 'stroke-amber-500', bg: 'text-amber-500', track: 'stroke-amber-500/20' }
      return { stroke: 'stroke-rose-500', bg: 'text-rose-500', track: 'stroke-rose-500/20' }
    }
    if (variant === 'technical') {
      return { stroke: 'stroke-indigo-500', bg: 'text-indigo-500', track: 'stroke-indigo-500/20' }
    }
    if (variant === 'communication') {
      return { stroke: 'stroke-teal-500', bg: 'text-teal-500', track: 'stroke-teal-500/20' }
    }
    if (variant === 'overall') {
      if (normalizedScore >= 80) return { stroke: 'stroke-indigo-600 dark:stroke-indigo-400', bg: 'text-indigo-600 dark:text-indigo-400', track: 'stroke-indigo-500/20' }
      if (normalizedScore >= 65) return { stroke: 'stroke-blue-600 dark:stroke-blue-400', bg: 'text-blue-600 dark:text-blue-400', track: 'stroke-blue-500/20' }
      return { stroke: 'stroke-amber-600 dark:text-amber-400', bg: 'text-amber-600 dark:text-amber-400', track: 'stroke-amber-500/20' }
    }

    // Default
    if (normalizedScore >= 75) return { stroke: 'stroke-primary', bg: 'text-primary', track: 'stroke-primary/20' }
    if (normalizedScore >= 60) return { stroke: 'stroke-amber-500', bg: 'text-amber-500', track: 'stroke-amber-500/20' }
    return { stroke: 'stroke-rose-500', bg: 'text-rose-500', track: 'stroke-rose-500/20' }
  }

  const colors = getColorClasses()

  return (
    <div className={cn('inline-flex flex-col items-center justify-center text-center', className)}>
      <div className="relative inline-flex items-center justify-center">
        <svg
          width={dimensions.size}
          height={dimensions.size}
          className="transform -rotate-90 transition-all duration-700 ease-out"
        >
          {/* Background circle track */}
          <circle
            cx={dimensions.size / 2}
            cy={dimensions.size / 2}
            r={radius}
            className={cn('fill-none stroke-secondary', colors.track)}
            strokeWidth={dimensions.stroke}
          />
          {/* Active progress ring */}
          <circle
            cx={dimensions.size / 2}
            cy={dimensions.size / 2}
            r={radius}
            className={cn('fill-none transition-all duration-1000 ease-out', colors.stroke)}
            strokeWidth={dimensions.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>

        {/* Center score */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('tracking-tight font-sans text-foreground', dimensions.textSize)}>
            {normalizedScore}
            {showPercentageSign && <span className="text-xs font-medium text-muted-foreground ml-0.5">%</span>}
          </span>
        </div>
      </div>

      {label && (
        <span className={cn('mt-2 font-semibold text-foreground tracking-tight', dimensions.labelSize)}>
          {label}
        </span>
      )}
      {description && (
        <span className="text-xs text-muted-foreground mt-0.5 max-w-[160px]">
          {description}
        </span>
      )}
    </div>
  )
}
