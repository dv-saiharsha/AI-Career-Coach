const tones = {
  pass: { text: 'text-ok', border: 'border-ok/40', bg: 'bg-ok/10', dot: 'bg-ok' },
  warn: { text: 'text-warn', border: 'border-warn/40', bg: 'bg-warn/10', dot: 'bg-warn' },
  fail: { text: 'text-err', border: 'border-err/40', bg: 'bg-err/10', dot: 'bg-err' },
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
      className={`inline-flex items-center gap-2 rounded-sm border ${tone.border} ${tone.bg} px-2.5 py-1 font-mono text-[11px] tracking-wide ${tone.text} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      {label}
      {detail && <span className="text-ink-dim">{detail}</span>}
    </span>
  )
}
