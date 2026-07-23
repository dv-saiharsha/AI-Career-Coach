// Job Market data layer.
//
// Today this serves sample listings so the UI can be built and reviewed.
// The backend job-feed (external jobs API pulled on a 24h schedule) lands
// later — when it does, getJobs() swaps its internals for an apiClient call
// and nothing else in the frontend changes.

export type WorkMode = 'Remote' | 'Hybrid' | 'On-site'

export interface JobListing {
  id: string
  title: string
  company: string
  location: string
  workMode: WorkMode
  salaryRange: string
  skills: string[]
  postedDaysAgo: number
  applyUrl: string
}

export interface JobFeed {
  /** ISO timestamp of the last feed refresh — real once the 24h backend pull exists. */
  lastUpdated: string
  jobs: JobListing[]
}

const SAMPLE_JOBS: JobListing[] = [
  {
    id: 'j1',
    title: 'Senior Backend Engineer',
    company: 'Stripe',
    location: 'Seattle, WA',
    workMode: 'Hybrid',
    salaryRange: '$180k – $240k',
    skills: ['Go', 'PostgreSQL', 'Kubernetes', 'API design'],
    postedDaysAgo: 1,
    applyUrl: '#',
  },
  {
    id: 'j2',
    title: 'ML Engineer, Recommendations',
    company: 'Netflix',
    location: 'Los Gatos, CA',
    workMode: 'On-site',
    salaryRange: '$220k – $320k',
    skills: ['PyTorch', 'Python', 'Spark', 'Feature stores'],
    postedDaysAgo: 2,
    applyUrl: '#',
  },
  {
    id: 'j3',
    title: 'AI Engineer, LLM Applications',
    company: 'Anthropic',
    location: 'San Francisco, CA',
    workMode: 'Hybrid',
    salaryRange: '$250k – $350k',
    skills: ['Python', 'LLM APIs', 'RAG', 'Prompt engineering'],
    postedDaysAgo: 1,
    applyUrl: '#',
  },
  {
    id: 'j4',
    title: 'Data Scientist, Growth',
    company: 'Airbnb',
    location: 'Remote, US',
    workMode: 'Remote',
    salaryRange: '$160k – $210k',
    skills: ['SQL', 'Python', 'A/B testing', 'dbt'],
    postedDaysAgo: 3,
    applyUrl: '#',
  },
  {
    id: 'j5',
    title: 'Security Engineer, AppSec',
    company: 'Cloudflare',
    location: 'Austin, TX',
    workMode: 'Hybrid',
    salaryRange: '$170k – $230k',
    skills: ['Threat modeling', 'Python', 'OAuth2', 'Cloud security'],
    postedDaysAgo: 4,
    applyUrl: '#',
  },
  {
    id: 'j6',
    title: 'Full-Stack Engineer',
    company: 'Vercel',
    location: 'Remote, Global',
    workMode: 'Remote',
    salaryRange: '$150k – $200k',
    skills: ['TypeScript', 'React', 'Next.js', 'PostgreSQL'],
    postedDaysAgo: 2,
    applyUrl: '#',
  },
  {
    id: 'j7',
    title: 'Backend Engineer, Payments',
    company: 'Square',
    location: 'New York, NY',
    workMode: 'Hybrid',
    salaryRange: '$165k – $220k',
    skills: ['Java', 'Kafka', 'MySQL', 'Distributed systems'],
    postedDaysAgo: 5,
    applyUrl: '#',
  },
  {
    id: 'j8',
    title: 'Data Engineer, Analytics Platform',
    company: 'Databricks',
    location: 'Remote, US',
    workMode: 'Remote',
    salaryRange: '$175k – $235k',
    skills: ['Spark', 'Airflow', 'Python', 'Data lakehouse'],
    postedDaysAgo: 1,
    applyUrl: '#',
  },
]

/** Most recent daily-refresh time: today at 06:00 local. Sample-data stand-in
 * for the real feed's refresh stamp. */
function lastRefreshTime(): string {
  const now = new Date()
  const refresh = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0)
  if (now < refresh) refresh.setDate(refresh.getDate() - 1)
  return refresh.toISOString()
}

export async function getJobs(): Promise<JobFeed> {
  return { lastUpdated: lastRefreshTime(), jobs: SAMPLE_JOBS }
}
