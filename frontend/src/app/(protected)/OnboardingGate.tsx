'use client'

import dynamic from 'next/dynamic'
import { useOnboarding } from '@/lib/useOnboarding'

/**
 * Mounted once, above every protected route — not on any one page.
 *
 * It used to live inside the dashboard page alone, which meant onboarding
 * only fired for someone whose first stop after signing in was /dashboard.
 * Now that jobs is the landing page, that would have meant new accounts
 * never seeing it at all. A gate this fundamental cannot depend on which
 * page happens to be the default.
 *
 * The modal itself is dynamic, and conditionally MOUNTED rather than always
 * rendered with isOpen toggled — measured, not assumed: moving it here from
 * a single route added ~3KB to every protected route's shared chunk, which
 * on /applications and /resume (already at the edge of their budget) was
 * the difference between passing and failing the gate. An already-onboarded
 * user — the overwhelming majority of page loads — never needs this
 * component's code at all, and OnboardingModal has no exit animation
 * depending on staying mounted (it returns null synchronously when closed),
 * so there is nothing lost by not rendering it until it is actually needed.
 */
const OnboardingModal = dynamic(
  () => import('@/components/onboarding/OnboardingModal').then((mod) => mod.OnboardingModal),
  { ssr: false },
)

export function OnboardingGate() {
  const { showOnboarding, finishOnboarding, skipOnboarding, submitError } = useOnboarding()
  if (!showOnboarding) return null
  return (
    <OnboardingModal
      isOpen={showOnboarding}
      onComplete={finishOnboarding}
      onSkip={skipOnboarding}
      error={submitError}
    />
  )
}
