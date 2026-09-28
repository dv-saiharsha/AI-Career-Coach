import { http } from '@/lib/http'
import type { BulletSuggestion, QuickTailorResult, TailorHandoff, TailorPreview } from '@/types/resumeTailor'

export const resumeTailorService = {
  /** POST /resume-builder/tailor-handoff — free gap analysis for one resume
   *  against one job posting. No LLM call. */
  getHandoff: async (jobId: number, analysisId: number): Promise<TailorHandoff> => {
    const { data } = await http.post<TailorHandoff>('/resume-builder/tailor-handoff', {
      job_id: jobId,
      analysis_id: analysisId,
    })
    return data
  },

  /** POST /resume-builder/tailor-preview — writes nothing. `includeRewrites`
   *  spends one Claude call for real bullet_suggestions; omit it to only see
   *  missing_keywords/state_explicitly for free. */
  getPreview: async (
    jobId: number,
    analysisId: number,
    fullName: string,
    includeRewrites: boolean
  ): Promise<TailorPreview> => {
    const { data } = await http.post<TailorPreview>('/resume-builder/tailor-preview', {
      job_id: jobId,
      analysis_id: analysisId,
      full_name: fullName,
      include_rewrites: includeRewrites,
    })
    return data
  },

  /** POST /resume-builder/quick-tailor/{analysisId} — the one paid, rate
   *  limited step that actually compiles a document and returns a real,
   *  post-compile ATS score. `acceptedSkills` and `bulletOverrides` are the
   *  caller's own accepted subset of a prior preview's suggestions — never
   *  invented here.
   *
   *  Exactly one of `jobId` / `jobDescription` should be set. With `jobId`,
   *  the listing's own stored description is resolved server-side (and the
   *  result is cached). With `jobDescription` (a pasted JD, no Job Portal
   *  listing involved), the backend scores against that text directly —
   *  QuickTailorRequestSchema.job_description is documented for exactly this
   *  "caller with no job_id" case. */
  quickTailor: async (
    analysisId: number,
    params: {
      fullName: string
      jobId?: number
      jobDescription?: string
      targetPages: 1 | 2
      acceptedSkills: string[]
      bulletOverrides: BulletSuggestion[]
    }
  ): Promise<QuickTailorResult> => {
    const { data } = await http.post<QuickTailorResult>(`/resume-builder/quick-tailor/${analysisId}`, {
      full_name: params.fullName,
      job_id: params.jobId,
      job_description: params.jobDescription,
      target_pages: params.targetPages,
      accepted_skills: params.acceptedSkills,
      bullet_overrides: params.bulletOverrides,
    })
    return data
  },
}
