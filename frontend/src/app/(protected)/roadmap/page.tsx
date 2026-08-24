'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Info, Route, Sparkles, Zap } from 'lucide-react'
import { getCareerRoadmap } from '@/lib/apiClient'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { ease, springSoft } from '@/lib/motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Skeleton mirrors the real milestone card's box — same padding, same rail
 * offset, same row heights. A placeholder that doesn't match the content it
 * stands in for causes the layout shift it exists to prevent.
 */
function RoadmapSkeleton() {
  return (
    <div className="relative space-y-4 pl-12">
      <div className="absolute bottom-2 left-[11px] top-2 w-px bg-[var(--color-canvas-line)]" aria-hidden="true" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-4 w-full" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RoadmapPage() {
  const reduce = usePrefersReducedMotion()
  // Params live in the query key, so changing them refetches on their own.
  // An empty object is a valid first request — the backend fills both roles
  // from the stored profile, which is what makes the page useful with no
  // input on first visit.
  const [params, setParams] = useState<{ current_role?: string; target_role?: string }>({})

  const {
    data: roadmap,
    isPending: loading,
    isError,
  } = useQuery({
    queryKey: ['career', 'roadmap', params],
    queryFn: () => getCareerRoadmap(params),
  })

  // null means "the user hasn't typed here yet", which is what lets the field
  // display whatever the profile supplied without an effect writing it into
  // state after the fetch resolves.
  const [currentRoleEdit, setCurrentRoleEdit] = useState<string | null>(null)
  const [targetRoleEdit, setTargetRoleEdit] = useState<string | null>(null)
  const currentRole = currentRoleEdit ?? roadmap?.current_role ?? ''
  const targetRole = targetRoleEdit ?? roadmap?.target_role ?? ''

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <span className="eyebrow mb-3 inline-flex items-center gap-1.5">
          <Route strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          Career Roadmap
        </span>
        <h1 className="mt-3 mb-2 font-display text-2xl font-medium text-[var(--color-ink)] md:text-3xl">
          The path from here to there.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Milestones between your current role and the one you&apos;re aiming at, with the
          capabilities that gate each step.
        </p>
      </div>

      <div className="card mb-6 space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="current-role" className="eyebrow mb-2 block">
              Current role
            </label>
            <Input
              id="current-role"
              value={currentRole}
              onChange={(e) => setCurrentRoleEdit(e.target.value)}
              placeholder="e.g. Backend Engineer"
            />
          </div>
          <div>
            <label htmlFor="target-role" className="eyebrow mb-2 block">
              Target role
            </label>
            <Input
              id="target-role"
              value={targetRole}
              onChange={(e) => setTargetRoleEdit(e.target.value)}
              placeholder="e.g. Staff Engineer"
            />
          </div>
        </div>
        <Button
          type="button"
          onClick={() => setParams({ current_role: currentRole.trim(), target_role: targetRole.trim() })}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          <Sparkles strokeWidth={1.5} className="h-4 w-4" />
          {roadmap ? 'Remap the path' : 'Map my path'}
        </Button>
      </div>

      {isError && (
        <div className="mb-6 border-l-[3px] border-[var(--color-error)] py-1.5 pl-3 text-sm text-[var(--color-error)]">
          Could not load your roadmap. Check that the API is running and try again.
        </div>
      )}

      {loading ? (
        <RoadmapSkeleton />
      ) : (
        roadmap && (
          <>
            {!roadmap.tailored && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-[10px] p-4"
                style={{ border: '1px solid var(--color-canvas-line)', background: 'var(--color-canvas)' }}
              >
                <Info strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
                  This is the generic path, not one built for you. Set your current and target roles
                  above — and run a resume scan — and it will be mapped against your actual skills.
                </p>
              </div>
            )}

            <div className="relative space-y-4 pl-12">
              <div
                className="absolute bottom-2 left-[11px] top-2 w-px bg-[var(--color-canvas-line)]"
                aria-hidden="true"
              />
              <AnimatePresence initial={false}>
                {roadmap.milestones.map((milestone, index) => {
                  const isTarget = index === roadmap.milestones.length - 1
                  const isCurrent = index === 0
                  return (
                    <motion.div
                      key={milestone.id}
                      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduce ? { duration: 0 } : { ...springSoft, delay: index * 0.06 }}
                      className="relative"
                    >
                      <span
                        className="absolute -left-12 top-4 flex h-[23px] w-[23px] items-center justify-center rounded-full"
                        style={{
                          background: isCurrent ? 'var(--color-accent)' : 'var(--color-canvas-raise)',
                          border: `1px solid ${isCurrent ? 'var(--color-accent)' : 'var(--color-canvas-line)'}`,
                        }}
                        aria-hidden="true"
                      >
                        {isCurrent ? (
                          <Check strokeWidth={2} className="h-3 w-3 text-[var(--color-on-accent)]" />
                        ) : (
                          <span
                            className="block h-1.5 w-1.5 rounded-full"
                            style={{
                              background: isTarget ? 'var(--color-accent)' : 'var(--color-ink-faint)',
                            }}
                          />
                        )}
                      </span>

                      <div className="card p-5">
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                          <span className="eyebrow text-[10px]">
                            {isCurrent ? 'Where you are' : isTarget ? 'Target' : `Milestone ${index}`}
                          </span>
                          {milestone.typical_duration && milestone.typical_duration !== '—' && (
                            <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                              {milestone.typical_duration}
                            </span>
                          )}
                        </div>

                        <h3 className="text-base font-medium text-[var(--color-ink)]">{milestone.title}</h3>
                        {milestone.summary && (
                          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-dim)]">
                            {milestone.summary}
                          </p>
                        )}

                        {(milestone.have_skills.length > 0 || milestone.gap_skills.length > 0) && (
                          <div className="mt-3.5 flex flex-wrap gap-1.5">
                            {milestone.have_skills.map((skill) => (
                              <span
                                key={skill}
                                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                                style={{
                                  border: '1px solid var(--color-canvas-line)',
                                  background: 'var(--color-canvas)',
                                  color: 'var(--color-ink-subtle)',
                                }}
                              >
                                <Check strokeWidth={2} className="h-3 w-3 text-[var(--color-signal-high)]" />
                                {skill}
                              </span>
                            ))}
                            {milestone.gap_skills.map((skill) => (
                              <span
                                key={skill}
                                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                                style={{
                                  border: '1px solid var(--color-accent)',
                                  background: 'var(--color-accent-tint)',
                                  color: 'var(--color-accent)',
                                }}
                              >
                                <Zap strokeWidth={1.5} className="h-3 w-3" />
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduce ? { duration: 0 } : ease}
              className="mt-5 text-[10px] leading-relaxed text-[var(--color-ink-faint)]"
            >
              Durations are typical ranges, not predictions. Skills marked as held come from your most
              recent resume scan.
            </motion.p>
          </>
        )
      )}
    </div>
  )
}
