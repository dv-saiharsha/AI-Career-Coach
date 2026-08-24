'use client'

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  analyzeResume,
  completeOnboarding,
  getJobs,
  getUserActivity,
  getUserProfile,
  getUserStats,
  updateUserProfile,
} from './apiClient'
import type { OnboardingResult } from '@/components/onboarding/OnboardingModal'

/**
 * Loads everything the dashboard renders, and owns the onboarding handoff.
 *
 * Built on react-query (already provided in components/Providers.tsx) rather
 * than useEffect + useState. Fetching in an effect means manually handling
 * cancellation, refetch-after-mutation, and the render cascade React 19's
 * set-state-in-effect rule warns about; the query cache handles all three,
 * and invalidation after onboarding is what refreshes the stat cards.
 */
export function useDashboardData() {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reminderDismissed, setReminderDismissed] = useState(false)

  const profileQuery = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: getUserProfile,
  })

  // Independent queries rather than one combined fetch: a failure in stats
  // shouldn't blank the activity list, and each can refetch on its own.
  const statsQuery = useQuery({
    queryKey: ['user', 'stats'],
    queryFn: getUserStats,
  })

  const activityQuery = useQuery({
    queryKey: ['user', 'activity'],
    queryFn: getUserActivity,
  })

  /**
   * Find a real job description to score the onboarding resume against.
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

  /**
   * Score a resume against a real posting for one of the user's target roles.
   *
   * Shared by onboarding and the follow-up reminder drawer, which do the same
   * work at different times — the only difference is when the file arrives.
   */
  const scoreAgainstBaseline = useCallback(
    async (resumeFile: File, role: string): Promise<number | null> => {
      const baselineJd = await findBaselineJd(role)
      if (!baselineJd) return null
      const formData = new FormData()
      formData.append('resume', resumeFile)
      formData.append('job_description', baselineJd)
      return (await analyzeResume(formData)).id
    },
    [findBaselineJd],
  )

  const resumeReminderMutation = useMutation({
    mutationFn: async (resumeFile: File) => {
      const roles = profileQuery.data?.target_roles ?? []
      const analysisId = await scoreAgainstBaseline(resumeFile, roles[0] ?? 'Software Engineer')
      return updateUserProfile({
        primary_resume_analysis_id: analysisId,
        primary_resume_filename: resumeFile.name,
      })
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(['user', 'profile'], profile)
      void queryClient.invalidateQueries({ queryKey: ['user', 'stats'] })
      void queryClient.invalidateQueries({ queryKey: ['user', 'activity'] })
      setReminderDismissed(true)
    },
    onError: () => {
      setSubmitError("Couldn't score that resume. Check the file and try again.")
    },
  })

  const onboardingMutation = useMutation({
    mutationFn: async ({ resumeFile, selectedRoles }: OnboardingResult) => {
      let analysisId: number | null = null
      const baselineJd = resumeFile ? await findBaselineJd(selectedRoles[0]) : null

      if (baselineJd && resumeFile) {
        try {
          const formData = new FormData()
          // 'resume', not 'file' — the field name the analyze endpoint
          // declares. Sending 'file' 422s, and the catch below made that
          // look like a transient failure rather than a permanent one.
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
      // refetch the metrics the new analysis just changed.
      queryClient.setQueryData(['user', 'profile'], profile)
      void queryClient.invalidateQueries({ queryKey: ['user', 'stats'] })
      void queryClient.invalidateQueries({ queryKey: ['user', 'activity'] })
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

  const uploadReminderResume = useCallback(
    async (file: File) => {
      setSubmitError(null)
      await resumeReminderMutation.mutateAsync(file).catch(() => {})
    },
    [resumeReminderMutation],
  )

  const profile = profileQuery.data ?? null

  return {
    profile,
    stats: statsQuery.data ?? null,
    activity: activityQuery.data ?? [],
    loading: profileQuery.isPending,
    // Only intercept once the profile is actually known — gating on
    // `!profile?.onboarding_completed` alone would flash the modal during the
    // initial load for users who have already completed onboarding.
    showOnboarding: !profileQuery.isPending && profile !== null && !profile.onboarding_completed,
    // The follow-up for users who skipped upload. Gated on onboarding being
    // done so the drawer never stacks on top of the modal, and dismissed for
    // the session rather than persisted — a nag that survives every reload is
    // worse than one that waits for the next visit.
    showResumeReminder:
      !reminderDismissed &&
      profile !== null &&
      profile.onboarding_completed &&
      !profile.primary_resume_filename,
    dismissResumeReminder: () => setReminderDismissed(true),
    uploadReminderResume,
    submitError,
    finishOnboarding,
  }
}
