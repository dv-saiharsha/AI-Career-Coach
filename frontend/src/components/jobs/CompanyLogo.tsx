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
  const [loaded, setLoaded] = useState(false)
  const initial = (company || '?').trim().charAt(0).toUpperCase()
  const showImage = Boolean(src) && !failed

  return (
    <div
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] ${className}`}
      style={{
        background: 'var(--color-canvas-deep)',
        border: '1px solid var(--color-canvas-line)',
      }}
    >
      {/* The monogram is always in the tree, not just the no-src fallback —
          it's the placeholder underneath the real logo while that request is
          still in flight, so there is never a blank box, only a letter that
          gets replaced. Only hidden once the image has actually painted. */}
      <span
        aria-hidden="true"
        className={`font-display text-sm font-semibold transition-opacity duration-150 ${
          showImage && loaded ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ color: 'var(--color-ink-faint)' }}
      >
        {initial}
      </span>

      {showImage && (
        // Third-party favicon host; see the component doc for why next/image
        // is the wrong tool here.
        //
        // No loading="lazy": these are 36px thumbnails in a grid the user is
        // looking at the instant the page paints, not offscreen content the
        // browser should defer. Lazy-loading a visible element is the
        // textbook cause of the pop-in this was written to fix — it makes
        // the browser wait for an intersection calculation before it even
        // starts the request, adding a delay eager loading would not have.
        // The fade-in below is for the network latency that genuinely can't
        // be removed (Google's own favicon service still has to respond);
        // it turns a hard pop the instant bytes arrive into a soft cross-fade
        // from the monogram already showing, rather than a blank gap.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-contain p-1 transition-opacity duration-150 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
