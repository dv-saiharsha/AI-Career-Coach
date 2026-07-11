const sizes = {
  sm: { box: 26, font: 11 },
  md: { box: 32, font: 13 },
} as const

export default function Mark({
  size = 'md',
  className = '',
}: {
  size?: keyof typeof sizes
  className?: string
}) {
  const { box, font } = sizes[size]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm border border-ok/60 bg-ok/10 font-mono font-semibold text-ok ${className}`}
      style={{ width: box, height: box, fontSize: font }}
      aria-hidden="true"
    >
      AC<span className="mark-cursor">_</span>
    </span>
  )
}
