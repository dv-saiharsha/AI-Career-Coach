/**
 * The one Interview category vocabulary for the app — same five values
 * Interview Preparation's cache is keyed by (see apiClient's PrepCategory),
 * now reused by Mock Interview too instead of the old, buggy client-only
 * fundamentals/system_design/real_world split that categorize() computed
 * from a question's free-text type string (system_design was permanently
 * unreachable, since the backend only ever emitted "technical"/"behavioral").
 */

import { BookOpen, ClipboardList, Layers, MessageCircleQuestion, Users } from 'lucide-react'
import type { PrepCategory } from './apiClient'

export const INTERVIEW_CATEGORIES: { value: PrepCategory; label: string; icon: typeof Layers }[] = [
  { value: 'technical', label: 'Technical', icon: Layers },
  { value: 'behavioral', label: 'Behavioral', icon: Users },
  { value: 'hr', label: 'HR', icon: MessageCircleQuestion },
  // Deliberately labelled to avoid reading as the same tool as the
  // job-specific Screening Prep flow elsewhere on this page — this is
  // general recruiter-screen-style practice, not tailored to one posting.
  { value: 'screening', label: 'Screening (general)', icon: ClipboardList },
  { value: 'scenario', label: 'Scenario', icon: BookOpen },
]

export function categoryLabel(category: PrepCategory | string | null | undefined): string {
  return INTERVIEW_CATEGORIES.find((c) => c.value === category)?.label ?? 'Interview'
}
