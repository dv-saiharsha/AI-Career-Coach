'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Search } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Search, in the header, beside its own icon.
 *
 * It replaces a centred modal that listed the same nine page names no matter
 * what you typed. Two things were wrong with that: it covered the page you
 * were searching from, and it could not find anything that was not a route —
 * a job title, a company you had applied to, the things people actually look
 * for in a product like this.
 *
 * The icon expands into an input in place. Results appear directly under it,
 * anchored to the control rather than floating in the middle of the screen,
 * so the page stays visible and the search reads as part of the header
 * rather than an interruption.
 *
 * WHY THE PANEL IS SPLIT OUT
 *
 * Everything that makes search work — thirteen page icons, the job and
 * pipeline fetchers, the debounce — is only needed once someone actually
 * searches, and this component renders on every signed-in route. Loading it
 * eagerly put 0.7 KB on /applications and pushed it over its budget for a
 * dropdown most page views never open. The collapsed trigger below is the
 * whole always-present cost.
 */

const SearchPanel = dynamic(() => import('./HeaderSearchPanel'), { ssr: false })

export function HeaderSearch() {
  const [open, setOpen] = React.useState(false)

  /* The shortcut lives here rather than in the panel, because the panel does
     not exist until it fires. People who learned Cmd-K should not lose it
     just because the surface changed. */
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) {
    return (
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Search">
        <Search />
      </Button>
    )
  }

  return <SearchPanel onClose={() => setOpen(false)} />
}
