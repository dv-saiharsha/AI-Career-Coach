'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { analyzeResume, completeOnboarding, skipOnboarding as skipOnboardingRequest, getJobs, getUserProfile } from './apiClient'
import type { OnboardingResult } from '@/components/onboarding/OnboardingModal'

/**
 * The first-login gate: target roles, and an optional baseline resume scan.
 *
 * Split out of what used to be useDashboardData, which bundled this together
 * with the resume-reminder drawer under one hook mounted only on the
 * dashboard page. That meant onboarding itself only ever fired for someone
 * whose first stop after signing in was /dashboard — true when this was the
 * post-login landing page, false the moment it stopped being one. A new user
 * routed anywhere else would never see it. This hook now backs a gate
 * mounted once at the protected layout, so it fires regardless of which
 * route someone lands on first.
 *
 * The resume-reminder drawer this hook used to also drive is gone, not
 * moved — removed on request, not folded in here.
 */
export function useOnboarding() {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const profileQuery = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: getUserProfile,
  })

  /**
   * A real job description to score the onboarding resume against.
   *
   * Reads the cached feed for the user's first target role — cached reads
   * cost no API quota. Scoring against a genuine posting makes the first ATS
   * number meaningful; scoring against a bare role name would produce a
   * number that looks real and isn't.
   */
  const findBaselineJd = useCallback(async (role: string): Promise<string | null> => {
    try {
      const feed = await getJobs(role)
      return feed.jobs.find((job) => job.description)?.description ?? null
    } catch {
      return null
    }
  }, [])

  const skipMutation = useMutation({
    mutationFn: () => skipOnboardingRequest(),
    onSuccess: (profile) => {
      queryClient.setQueryData(['user', 'profile'], profile)
    },
    onError: () => {
      setSubmitError('Could not skip setup just now. Try again, or pick a role to continue.')
    },
  })

  const onboardingMutation = useMutation({
    mutationFn: async ({ resumeFile, selectedRoles }: OnboardingResult) => {
      let analysisId: number | null = null
      const baselineJd = resumeFile ? await findBaselineJd(selectedRoles[0]) : null

      if (baselineJd && resumeFile) {
        try {
          // 'resume', not 'file' — the field name the analyze endpoint
          // declares. Sending 'file' 422s, and the catch below made that
          // look like a transient failure rather than a permanent one.
          const formData = new FormData()
          formData.append('resume', resumeFile)
          formData.append('job_description', baselineJd)
          analysisId = (await analyzeResume(formData)).id
        } catch {
          // Non-fatal on purpose. The roles are what unblock the product; a
          // failed baseline scan shouldn't trap the user in a modal they
          // cannot dismiss. They can analyse from /resume afterwards.
          setSubmitError(
            "Saved your roles, but we couldn't score your resume just now. Try it from Resume Analyzer.",
          )
        }
      }

      // This one *is* fatal — without it the modal reopens on every visit.
      return completeOnboarding({
        target_roles: selectedRoles,
        primary_resume_analysis_id: analysisId,
        primary_resume_filename: resumeFile?.name ?? null,
      })
    },
    onSuccess: (profile) => {
      // Seed the profile immediately so the modal closes on this render, then
      // refetch anything downstream a new analysis or role list would change.
      queryClient.setQueryData(['user', 'profile'], profile)
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'home'] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: () => {
      setSubmitError('Could not save your preferences. Please try again.')
    },
  })

  const finishOnboarding = useCallback(
    async (result: OnboardingResult) => {
      setSubmitError(null)
      // mutateAsync rejects on failure; onError already surfaced the message,
      // so swallow it here rather than letting it escape to the modal's
      // click handler as an unhandled rejection.
      await onboardingMutation.mutateAsync(result).catch(() => {})
    },
    [onboardingMutation],
  )

  const skipOnboarding = useCallback(async () => {
    setSubmitError(null)
    await skipMutation.mutateAsync().catch(() => {})
  }, [skipMutation])

  const profile = profileQuery.data ?? null

  return {
    profile,
    loading: profileQuery.isPending,
    // Only intercept once the profile is actually known — gating on
    // `!profile?.onboarding_completed` alone would flash the modal during the
    // initial load for users who have already completed onboarding.
    showOnboarding: !profileQuery.isPending && profile !== null && !profile.onboarding_completed,
    submitError,
    finishOnboarding,
    skipOnboarding,
  }
}
