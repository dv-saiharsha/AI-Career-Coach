'use client'

/**
 * The one customizable color in an otherwise-monochrome app.
 *
 * Recolors --signal only (see lib/accentColor.ts) — the app's one deliberate
 * accent hue, used for scores, chart series, and active indicators. Buttons,
 * borders, and focus rings stay the fixed black-and-white "ink" they always
 * were; that structural palette is not something this control touches, and
 * the monochrome default (no saved preference) is exactly what a brand-new
 * account already has.
 *
 * Applied live on pick — a preset click or a valid custom hex both update
 * the page immediately via applyAccentColor, before the save request even
 * returns, and persisted through the same PATCH /user/profile every other
 * field on this page's siblings already uses.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { Check, Palette, RotateCcw } from 'lucide-react'
import { getUserProfile, updateUserProfile } from '@/lib/apiClient'
import { ACCENT_PRESETS, applyAccentColor, isValidHexColor } from '@/lib/accentColor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

export function AppearanceSection() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'light' ? 'light' : 'dark'

  const { data: profile } = useQuery({ queryKey: ['user', 'profile'], queryFn: getUserProfile })
  const savedAccent = profile?.accent_color ?? null

  // Local draft for the hex field, so an in-progress edit isn't clobbered by
  // the query refetching. Hydrated during render rather than in an effect —
  // the same pattern the Profile page uses for its own form — so a fresh
  // server value adopts once without an extra render-then-correct pass.
  const [hexDraft, setHexDraft] = useState('')
  const [hydratedFrom, setHydratedFrom] = useState<string | null>(null)
  if (profile && savedAccent !== hydratedFrom) {
    setHydratedFrom(savedAccent)
    setHexDraft(savedAccent ?? '')
  }

  const mutation = useMutation({
    mutationFn: (accent_color: string) => updateUserProfile({ accent_color }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['user', 'profile'], updated)
    },
    onError: (_err, accent_color) => {
      // The optimistic apply below already changed what's on screen —
      // revert it rather than leave the page showing a color the account
      // was never actually saved with.
      applyAccentColor(savedAccent, theme)
      toast({
        title: 'Could not save your accent color',
        description: 'Something went wrong on our side. Try again in a moment.',
        variant: 'error',
      })
      void accent_color
    },
  })

  function choose(hex: string) {
    applyAccentColor(hex, theme) // instant — does not wait on the network
    mutation.mutate(hex)
  }

  function reset() {
    applyAccentColor(null, theme)
    mutation.mutate('')
  }

  const draftIsValid = hexDraft === '' || isValidHexColor(hexDraft)

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-ink">Appearance</h2>

      <div className="rounded-xl border border-canvas-line p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Palette className="size-4 text-accent" aria-hidden="true" />
            Accent color
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">
            Everything structural — buttons, borders, focus — stays black and white. This
            recolors only the one deliberate accent: scores, chart series, and active
            indicators. Applies everywhere, right away.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENT_PRESETS.map((preset) => {
            const active = savedAccent?.toLowerCase() === preset.hex.toLowerCase()
            return (
              <button
                key={preset.hex}
                type="button"
                onClick={() => choose(preset.hex)}
                disabled={mutation.isPending}
                aria-label={preset.label}
                aria-pressed={active}
                title={preset.label}
                className="relative flex size-9 items-center justify-center rounded-full transition-transform disabled:opacity-50 hover:scale-105 focus-visible:outline-none"
                style={{
                  background: preset.hex,
                  boxShadow: active ? `0 0 0 2px var(--color-canvas-raise), 0 0 0 4px ${preset.hex}` : undefined,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 0 2px var(--color-canvas-raise), 0 0 0 4px ${preset.hex}`
                }}
                onBlur={(e) => {
                  if (!active) e.currentTarget.style.boxShadow = ''
                }}
              >
                {active && (
                  <Check className="size-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" aria-hidden="true" />
                )}
              </button>
            )
          })}

          {/* Native color input — a real OS/browser picker with zero added
              dependency, for anyone who wants a hue none of the presets
              cover. */}
          <label className="relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-dashed border-canvas-line text-ink-faint transition-colors hover:border-accent hover:text-accent">
            <input
              type="color"
              value={savedAccent ?? '#1d4ed8'}
              onChange={(e) => choose(e.target.value)}
              disabled={mutation.isPending}
              aria-label="Pick a custom accent color"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <Palette className="pointer-events-none size-4" aria-hidden="true" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-ink-faint">Hex</span>
            <Input
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => {
                if (hexDraft && isValidHexColor(hexDraft) && hexDraft.toLowerCase() !== savedAccent?.toLowerCase()) {
                  choose(hexDraft)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder="#1d4ed8"
              invalid={!draftIsValid}
              className="w-32 font-mono text-xs"
              maxLength={7}
            />
          </label>

          {savedAccent && (
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={mutation.isPending}>
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
          )}
        </div>

        {!draftIsValid && (
          <p className="text-xs text-error">A hex color looks like #1d4ed8 — six digits after the #.</p>
        )}
      </div>
    </div>
  )
}
