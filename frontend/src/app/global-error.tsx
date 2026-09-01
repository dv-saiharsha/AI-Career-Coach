'use client'

import { useEffect } from 'react'
import './globals.css'

/**
 * The fallback of last resort — Next.js only renders this when the error
 * happens in the root layout itself, meaning every provider (theme, auth,
 * toast) may already be gone. It has to supply its own <html>/<body> and
 * stay independent of anything that could have caused the failure it's
 * reporting, which is why it doesn't reach for PageHeader, Button, or any
 * other app component.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#faf8f5', color: '#0f172a' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>The application failed to load.</h1>
          <p style={{ maxWidth: '380px', fontSize: '14px', color: '#4b5262', margin: 0 }}>
            Something went wrong before the page could render. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              background: '#0f172a',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
