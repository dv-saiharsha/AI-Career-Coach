'use client'

import { useEffect, useState } from 'react'

export interface AccentPalette {
  accent: string
  accentDim: string
  accentLight: string
  accentLighter: string
  inkDim: string
  inkFaint: string
}

const FALLBACK: AccentPalette = {
  accent: '#8B5CF6',
  accentDim: '#6D28D9',
  accentLight: '#A78BFA',
  accentLighter: '#C4B5FD',
  inkDim: '#A3A3A3',
  inkFaint: '#525252',
}

function read(): AccentPalette {
  if (typeof window === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    accent: get('--color-accent', FALLBACK.accent),
    accentDim: get('--color-accent-dim', FALLBACK.accentDim),
    accentLight: get('--color-accent-light', FALLBACK.accentLight),
    accentLighter: get('--color-accent-lighter', FALLBACK.accentLighter),
    inkDim: get('--color-ink-dim', FALLBACK.inkDim),
    inkFaint: get('--color-ink-faint', FALLBACK.inkFaint),
  }
}

/** Live-updating theme accent colors as plain hex strings, for contexts that
 * can't read CSS vars directly (recharts fills, canvas, GSAP color tweens). */
export function useAccentPalette(): AccentPalette {
  const [palette, setPalette] = useState<AccentPalette>(FALLBACK)

  useEffect(() => {
    setPalette(read())
    const observer = new MutationObserver(() => setPalette(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return palette
}
