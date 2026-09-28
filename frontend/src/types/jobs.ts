// Mirrors backend/app/schemas/job.py exactly — field names are camelCase on
// the wire (the backend's JobListingSchema is already shaped for direct
// frontend consumption, no mapping layer).

export type WorkMode = 'Remote' | 'Hybrid' | 'On-site'

export type H1bSponsorship = 'explicitly_sponsored' | 'no_sponsorship' | 'unmentioned'

export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'lead'

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship'

export interface ResumeMatchDetail {
  score: number
  band: string
}

export interface SkillsMatchDetail {
  score: number
  band: string
  matchingSkills: string[]
  missingSkills: string[]
  skillCategories: Record<string, string[]>
  prioritySkills: string[]
  learningRecommendations: string[]
}

export interface JobMatch {
  overallMatch: number | null
  band: string | null
  resumeMatch: ResumeMatchDetail | null
  skillsMatch: SkillsMatchDetail | null
  explanation: string
  generatedBy: string
}

export interface JobListing {
  id: string
  title: string
  company: string
  location: string
  workMode: WorkMode
  salaryRange: string
  description?: string | null
  skills: string[]
  postedDaysAgo: number
  applyUrl: string
  companyLogo?: string | null
  domain?: string | null
  h1bSponsorship?: H1bSponsorship | null
  h1bEvidence?: string | null
  experienceLevel?: ExperienceLevel | null
  employmentType?: EmploymentType | null
  match?: JobMatch | null
}

export interface FilterCounts {
  h1b: Record<string, number>
  experience: Record<string, number>
  employment: Record<string, number>
  // Keyed by employer chip label (e.g. "AWS", "Google") — see
  // job_market/services.py's EMPLOYER_CHIPS.
  employer: Record<string, number>
  unenriched: number
}

export interface JobFeed {
  lastUpdated: string | null
  jobs: JobListing[]
  filterCounts: FilterCounts | null
  refreshing: boolean
  next_sync_at: string | null
}

// -- Filter vocabulary the API accepts (job_market/services.py) -------------

export const H1B_OPTIONS: { value: H1bSponsorship; label: string; hint: string }[] = [
  {
    value: 'explicitly_sponsored',
    label: 'Sponsors H-1B',
    hint: 'The posting states sponsorship is available. Always confirm at screening.',
  },
  {
    value: 'no_sponsorship',
    label: 'No sponsorship',
    hint: 'The posting states sponsorship is unavailable, or requires existing authorization.',
  },
  {
    value: 'unmentioned',
    label: 'Not mentioned',
    hint: "The posting doesn't mention sponsorship either way.",
  },
]

export const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'entry', label: 'Entry' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
]

export const EMPLOYMENT_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
]

export const WORK_MODE_FILTERS = ['All', 'Remote', 'Hybrid', 'On-site'] as const
export type WorkModeFilter = (typeof WORK_MODE_FILTERS)[number]
