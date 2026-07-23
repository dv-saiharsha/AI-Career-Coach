const tones = {
  pass: 'var(--color-signal-high)',
  warn: 'var(--color-signal-mid)',
  fail: 'var(--color-signal-low)',
} as const

export default function StatusBadge({
  verdict,
  label,
  detail,
  className = '',
}: {
  verdict: keyof typeof tones
  label: string
  detail?: string
  className?: string
}) {
  const tone = tones[verdict]
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-[11px] tracking-wide ${className}`}
      style={{
        color: tone,
        borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${tone} 10%, transparent)`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone }} />
      {label}
      {detail && <span className="text-[var(--color-ink-dim)]">{detail}</span>}
    </span>
  )
}
