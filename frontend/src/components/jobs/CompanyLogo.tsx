'use client'

import { useState } from 'react'

interface CompanyLogoProps {
  company: string
  /** May be null, and may 404 — the domain is guessed from the company name. */
  src?: string | null
  className?: string
}

/**
 * Brand icon with a monogram fallback.
 *
 * The URL is a guess: the backend derives a domain from the company's display
 * name, and plenty of employers don't own the slug of their own name. So the
 * failure path is the common one, not the exception — `onError` swaps to the
 * monogram, and a null src skips the request entirely rather than firing one
 * that is certain to fail.
 *
 * A plain <img>, not next/image: these are third-party URLs on a domain that
 * would each need whitelisting in next.config, and an icon that fails to
 * optimise should degrade to a letter rather than break the card.
 */
export function CompanyLogo({ company, src, className = '' }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false)
  const initial = (company || '?').trim().charAt(0).toUpperCase()

  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] ${className}`}
      style={{
        background: 'var(--color-canvas-deep)',
        border: '1px solid var(--color-canvas-line)',
      }}
    >
      {src && !failed ? (
        // Third-party favicon host; see the component doc for why next/image
        // is the wrong tool here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <span
          aria-hidden="true"
          className="font-display text-sm font-semibold"
          style={{ color: 'var(--color-ink-faint)' }}
        >
          {initial}
        </span>
      )}
    </div>
  )
}
