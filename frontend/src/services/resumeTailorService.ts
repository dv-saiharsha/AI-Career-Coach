import { http } from '@/lib/http'
import type {
  BulletSuggestion,
  QuickTailorResult,
  ResumeJobMatch,
  ReviewedPreview,
  ResumeAutofill,
  SavedTailoredResume,
  SmartTailorResult,
  TailoredResumeContent,
  TailorDesign,
  TailorHandoff,
  TailorPreview,
} from '@/types/resumeTailor'

export const resumeTailorService = {
  getAutofill: async (analysisId: number): Promise<ResumeAutofill> => {
    const { data } = await http.get<ResumeAutofill>(`/resume-builder/autofill/${analysisId}`)
    return data
  },

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

  /** Match an existing scan against the selected job using the backend scorer. */
  matchResume: async (
    analysisId: number,
    params: { jobId?: number; jobTitle?: string; company?: string; jobDescription?: string }
  ): Promise<ResumeJobMatch> => {
    const { data } = await http.post<ResumeJobMatch>(`/resume-builder/match/${analysisId}`, {
      job_id: params.jobId,
      job_title: params.jobTitle ?? '',
      company: params.company ?? '',
      job_description: params.jobDescription ?? '',
    })
    return data
  },

  /** Save reviewed content after the backend recompiles and scores it. */
  /** POST /resume-builder/preview-reviewed — compile and re-score the
   *  edited content without saving, so the preview matches the editor. */
  previewReviewed: async (params: {
    sourceAnalysisId: number
    jobId?: number
    jobTitle?: string
    company?: string
    jobDescription?: string
    targetPages: 1 | 2
    design: 'faang' | 'original'
    content: TailoredResumeContent
  }): Promise<ReviewedPreview> => {
    const { data } = await http.post<ReviewedPreview>('/resume-builder/preview-reviewed', {
      source_analysis_id: params.sourceAnalysisId,
      job_id: params.jobId,
      job_title: params.jobTitle ?? '',
      company: params.company ?? '',
      job_description: params.jobDescription ?? '',
      target_pages: params.targetPages,
      design: params.design,
      content: params.content,
    })
    return data
  },

  saveTailored: async (params: {
    sourceAnalysisId: number
    jobId?: number
    jobTitle?: string
    company?: string
    jobDescription?: string
    targetPages: 1 | 2
    design: 'faang' | 'original'
    content: TailoredResumeContent
  }): Promise<SavedTailoredResume> => {
    const { data } = await http.post<SavedTailoredResume>('/resume-builder/saved-tailored', {
      source_analysis_id: params.sourceAnalysisId,
      job_id: params.jobId,
      job_title: params.jobTitle ?? '',
      company: params.company ?? '',
      job_description: params.jobDescription ?? '',
      target_pages: params.targetPages,
      design: params.design,
      content: params.content,
    })
    return data
  },

  listSaved: async (): Promise<SavedTailoredResume[]> => {
    const { data } = await http.get<SavedTailoredResume[]>('/resume-builder/saved-tailored')
    return data
  },

  downloadSaved: async (id: number): Promise<Blob> => {
    const { data } = await http.get<Blob>(`/resume-builder/saved-tailored/${id}/file`, { responseType: 'blob' })
    return data
  },

  deleteSaved: async (id: number): Promise<void> => {
    await http.delete(`/resume-builder/saved-tailored/${id}`)
  },

  /** Compile a one- or two-page PDF and score it against its job description. */
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

  /** POST /resume-builder/smart-tailor/{analysisId} — the full Tailor Resume
   *  pipeline: JD analysis, requirement matching, fact-checked rewrites,
   *  one-page fit and validation. Writes nothing but a cache row; the stored
   *  scan is never modified. With `jobId` the listing's own text is used;
   *  otherwise `jobDescription`. `confirmedSkills` are skills the user states
   *  they have — the only way a skill the resume doesn't show can be listed. */
  smartTailor: async (
    analysisId: number,
    params: {
      jobId?: number
      jobDescription?: string
      jobTitle?: string
      company?: string
      fullName: string
      design: TailorDesign
      targetPages: 1 | 2
      confirmedSkills: string[]
    },
    signal?: AbortSignal
  ): Promise<SmartTailorResult> => {
    const { data } = await http.post<SmartTailorResult>(
      `/resume-builder/smart-tailor/${analysisId}`,
      {
        job_id: params.jobId,
        job_description: params.jobDescription ?? '',
        job_title: params.jobTitle ?? '',
        company: params.company ?? '',
        full_name: params.fullName,
        design: params.design,
        target_pages: params.targetPages,
        confirmed_skills: params.confirmedSkills,
      },
      { signal }
    )
    return data
  },
}
