import { useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useNavigate } from 'react-router-dom'
import { Command, Search } from 'lucide-react'
import { allNavItems } from '@/config/navigation'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const results = useMemo(
    () => allNavItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    [query]
  )

  const close = () => {
    onOpenChange(false)
    setQuery('')
  }

  const go = (path: string) => {
    navigate(path)
    close()
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('')
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-foreground/40 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[80] w-[min(calc(100%-32px),560px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-elevated data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex h-[58px] items-center gap-2.5 border-b border-border px-4 text-muted-foreground">
            <Search size={19} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && results[0]) go(results[0].path)
              }}
              placeholder="Where would you like to go?"
              className="h-full flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</span>
          </div>
          <div className="max-h-[380px] overflow-y-auto p-2.5">
            <span className="block px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Navigate
            </span>
            {results.map(({ label, path, icon: Icon }) => (
              <button
                key={path}
                onClick={() => go(path)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Icon size={17} />
                <span className="flex-1">{label}</span>
                <small className="text-[10px] text-muted-foreground">Go to page</small>
              </button>
            ))}
            {results.length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">
                No screens found for &ldquo;{query}&rdquo;
              </p>
            )}
          </div>
          <div className="flex gap-3 border-t border-border bg-background px-3.5 py-2.5 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border bg-card px-1 py-0.5">&uarr;</kbd>
              <kbd className="rounded border border-border bg-card px-1 py-0.5">&darr;</kbd> Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border bg-card px-1 py-0.5">&crarr;</kbd> Open
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border bg-card px-1 py-0.5">esc</kbd> Close
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              <Command size={11} />K to reopen
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
