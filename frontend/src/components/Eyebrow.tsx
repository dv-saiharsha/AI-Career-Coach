import type { ReactNode } from 'react'

export default function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-canvas-line bg-canvas-raise px-3 py-1.5 font-mono text-[11.5px] tracking-widest uppercase text-ok">
      <span className="w-1.5 h-1.5 rounded-full bg-ok shadow-[0_0_0_3px_rgba(62,213,152,.18)]" />
      {children}
    </span>
  )
}
