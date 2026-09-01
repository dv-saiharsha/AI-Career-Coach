/**
 * The verification mark for a completed scan.
 *
 * Drawn rather than faded in — the ring and then the check are written on
 * screen by animating a stroke's dash offset to zero. A tick that appears
 * fully formed reads as a state; one that draws reads as something having
 * just finished, which is the difference worth the 300ms.
 *
 * It settles with one overshoot on --ease-spring. That is the only bounce in
 * this system, and it is earned here: something completed, and the gesture
 * that preceded it was the user's own upload.
 *
 * A server component. Purely decorative, so it is aria-hidden and the
 * surrounding panel carries the announcement.
 */
export function ScanTick({ size = 56 }: { size?: number }) {
  return (
    <svg
      className="tick-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="tick-ring"
        cx="16"
        cy="16"
        r="14"
        stroke="var(--success)"
        strokeWidth="2"
        strokeLinecap="round"
        /* Starts at the top and runs clockwise, so the ring closes where the
           eye is already looking rather than at three o'clock. */
        transform="rotate(-90 16 16)"
      />
      <path
        className="tick-check"
        d="M10 16.5 L14.2 20.5 L22 12.5"
        stroke="var(--success)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
