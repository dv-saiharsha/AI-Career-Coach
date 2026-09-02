'use client'

import { OnboardingModal } from '@/components/onboarding/OnboardingModal'
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
 * position: fixed inside OnboardingModal, so where this sits in the tree is
 * cosmetic — it renders correctly from any parent.
 */
export function OnboardingGate() {
  const { showOnboarding, finishOnboarding, skipOnboarding, submitError } = useOnboarding()
  return (
    <OnboardingModal
      isOpen={showOnboarding}
      onComplete={finishOnboarding}
      onSkip={skipOnboarding}
      error={submitError}
    />
  )
}
