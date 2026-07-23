import type { ReactNode } from 'react'

export default function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow border border-[var(--color-canvas-line)] rounded-full bg-[var(--color-canvas-raise)] px-3 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-tint)]" />
      {children}
    </span>
  )
}
