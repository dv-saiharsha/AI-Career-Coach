/**
 * What the filter sees when it reads a CV.
 *
 * Drawn rather than photographed, and drawn rather than downloaded. A stock
 * photo of someone at a laptop says nothing about what this product does; a
 * screenshot would be stale the week after it was taken and unreadable at
 * this size. This is the one claim on the page that benefits from being
 * shown — "we tell you what the software found" is hard to picture and easy
 * to draw.
 *
 * It also teaches the colour language the rest of the product now uses:
 * green where a section parsed cleanly, amber where something is missing,
 * signal blue for the machine's own annotations. Someone who reads this
 * already knows what an amber score means on their dashboard.
 *
 * Pure SVG on the token palette, no images, no JavaScript, and the landing
 * route measured byte-identical after it landed.
 *
 * Decorative in the accessibility tree — every claim it makes is stated in
 * the prose beside it, so a screen reader that skips it loses nothing. The
 * alternative, describing sixteen rectangles, is noise.
 */

/* Every colour goes through inline `style`, never a presentation attribute.
   `var()` in a presentation attribute is legal per spec and works in current
   browsers, but this codebase already asserts the opposite in
   lib/useAccentPalette.ts, and a landing page that renders invisible text on
   one engine is not worth the argument. */
const LINE = { fill: 'var(--ink)' }

/** A run of body text. `w` is a percentage of the column. */
function TextLine({ x, y, w, o = 0.14 }: { x: number; y: number; w: number; o?: number }) {
  return <rect x={x} y={y} width={w} height={3.4} rx={1.7} style={LINE} opacity={o} />
}

/** A detected region: dashed frame plus a small machine annotation. */
function Region({
  x,
  y,
  w,
  h,
  label,
  tone,
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  tone: 'ok' | 'warn' | 'read'
}) {
  const color =
    tone === 'ok'
      ? 'var(--semantic-success)'
      : tone === 'warn'
        ? 'var(--semantic-warning)'
        : 'var(--signal)'

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        style={{ fill: color }}
        opacity={0.07}
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        style={{ fill: 'none', stroke: color }}
        strokeWidth={1}
        strokeDasharray="3 2.5"
        opacity={0.75}
      />
      <text
        x={x + 4}
        y={y - 3.5}
        style={{ fill: color, fontSize: '6px', fontWeight: 600, letterSpacing: '0.08em' }}
      >
        {label}
      </text>
    </g>
  )
}

export function ParseMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 200"
      className={className}
      aria-hidden="true"
      role="presentation"
      style={{ overflow: 'visible' }}
    >
      {/* The page. */}
      <rect
        x={8}
        y={8}
        width={162}
        height={184}
        rx={8}
        style={{ fill: 'var(--canvas-raise)', stroke: 'var(--line)' }}
        strokeWidth={1}
      />

      {/* Name block — parsed cleanly. */}
      <Region x={20} y={26} w={82} h={22} label="CONTACT" tone="ok" />
      <rect x={26} y={31} width={44} height={5.5} rx={2.75} style={LINE} opacity={0.5} />
      <TextLine x={26} y={40} w={62} o={0.2} />

      {/* Experience — the bulk of the page. */}
      <Region x={20} y={68} w={138} h={62} label="EXPERIENCE" tone="ok" />
      {[74, 84, 94, 108, 118].map((y, i) => (
        <TextLine key={y} x={26} y={y} w={i === 3 ? 96 : i === 4 ? 74 : 122} />
      ))}
      <rect x={26} y={100} width={52} height={3.4} rx={1.7} style={LINE} opacity={0.28} />

      {/* Skills — present but thin, which is the finding. */}
      <Region x={20} y={148} w={138} h={30} label="SKILLS" tone="warn" />
      {[154, 164].map((y) => (
        <TextLine key={y} x={26} y={y} w={y === 154 ? 108 : 58} />
      ))}

      {/* ── The machine's read, to the right of the page ─────────────── */}

      {/* Leader lines from the page to each note. */}
      {[
        { from: 37, to: 34 },
        { from: 99, to: 96 },
        { from: 163, to: 158 },
      ].map(({ from, to }) => (
        <path
          key={from}
          d={`M170 ${from} C 182 ${from}, 182 ${to}, 194 ${to}`}
          style={{ fill: 'none', stroke: 'var(--line-strong)' }}
          strokeWidth={1}
        />
      ))}

      {/* Score chip. */}
      <g>
        <rect
          x={194}
          y={22}
          width={58}
          height={24}
          rx={6}
          style={{ fill: 'var(--canvas-raise)', stroke: 'var(--line)' }}
          strokeWidth={1}
        />
        <text
          x={202}
          y={38}
          style={{ fill: 'var(--semantic-success)', fontSize: '13px', fontWeight: 700 }}
        >
          82%
        </text>
        <text x={228} y={38} style={{ fill: 'var(--ink-faint)', fontSize: '6.5px' }}>
          match
        </text>
      </g>

      {/* Two findings, one neutral and one actionable — which is what the
          product actually returns. */}
      <g>
        <rect
          x={194}
          y={84}
          width={58}
          height={24}
          rx={6}
          style={{ fill: 'var(--canvas-raise)', stroke: 'var(--line)' }}
          strokeWidth={1}
        />
        <circle cx={203} cy={96} r={3} style={{ fill: 'var(--signal)' }} />
        <text x={210} y={98.5} style={{ fill: 'var(--ink-dim)', fontSize: '6.5px' }}>
          9 skills read
        </text>
      </g>

      <g>
        <rect
          x={194}
          y={146}
          width={58}
          height={24}
          rx={6}
          style={{ fill: 'var(--canvas-raise)', stroke: 'var(--line)' }}
          strokeWidth={1}
        />
        <circle cx={203} cy={158} r={3} style={{ fill: 'var(--semantic-warning)' }} />
        <text x={210} y={160.5} style={{ fill: 'var(--ink-dim)', fontSize: '6.5px' }}>
          no metrics
        </text>
      </g>
    </svg>
  )
}
