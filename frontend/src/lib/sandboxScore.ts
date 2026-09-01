/**
 * The landing-page ATS sandbox scorer.
 *
 * This runs entirely in the visitor's browser against a fixed sample resume.
 * It calls no API and needs no account, which is the point: someone deciding
 * whether this service is worth signing up for should be able to see what it
 * does before handing over a document.
 *
 * It is a real computation, not a scripted outcome. The same job description
 * always produces the same score, every deduction names a reason, and the
 * four components are the same four the product uses elsewhere. What it is
 * NOT is the full analyzer — that one reads an actual resume rather than
 * this fixed sample, and the UI says so plainly.
 *
 * Cost: a few hundred string comparisons over a job description. It is called
 * from a 150ms debounce and finishes well inside a frame, so the textarea
 * never stutters as someone types.
 */

export interface ScoreComponent {
  key: 'keywords' | 'skills' | 'seniority' | 'format'
  label: string
  /** Points earned. */
  earned: number
  /** Points available. */
  max: number
  /** Why it is not full marks. Empty when it is. */
  reasons: string[]
}

export interface SandboxResult {
  score: number
  verdict: string
  explanation: string
  components: ScoreComponent[]
  matched: string[]
  missing: string[]
  /** True before the visitor has typed anything worth scoring. */
  empty: boolean
}

/* ── The sample resume ──────────────────────────────────────────────────
   A plausible mid-level backend CV. Kept as structured data rather than a
   blob so the scorer reads fields rather than guessing at them, the same way
   the real parser does. */
export const SAMPLE_RESUME = {
  name: 'Priya Raghunathan',
  title: 'Backend Engineer',
  yearsExperience: 5,
  seniority: 'mid',
  skills: [
    'python',
    'fastapi',
    'django',
    'postgresql',
    'redis',
    'docker',
    'aws',
    'rest api',
    'sql',
    'git',
    'ci/cd',
    'pytest',
    'linux',
    'microservices',
  ],
} as const

/** Points available for how well the document itself parses. */
const FORMAT_MAX = 15
/**
 * Format health is a property of the document, so it is fixed for a fixed
 * sample — a job description cannot change how well this resume parses. The
 * UI says that rather than animating the bar to look responsive.
 */
const FORMAT_EARNED = 15

/* Skills the scorer can recognise in a job description. Multi-word entries
   are checked as phrases, so "rest api" does not match a stray "api". */
const SKILL_LEXICON = [
  'python','java','javascript','typescript','go','golang','rust','ruby','php','scala','kotlin',
  'fastapi','django','flask','spring','express','node.js','nodejs','rails','laravel',
  'react','vue','angular','svelte','next.js',
  'postgresql','postgres','mysql','mongodb','redis','elasticsearch','cassandra','dynamodb','sqlite',
  'docker','kubernetes','terraform','ansible','jenkins','github actions','gitlab ci','ci/cd',
  'aws','azure','gcp','google cloud','lambda','s3','ec2',
  'rest api','graphql','grpc','microservices','kafka','rabbitmq','celery',
  'sql','nosql','etl','airflow','spark','hadoop',
  'git','linux','bash','pytest','junit','jest','tdd','agile','scrum',
  'machine learning','pytorch','tensorflow','pandas','numpy',
]

const SENIORITY_TERMS: Record<string, { level: string; rank: number }> = {
  intern: { level: 'intern', rank: 0 },
  graduate: { level: 'junior', rank: 1 },
  junior: { level: 'junior', rank: 1 },
  'entry level': { level: 'junior', rank: 1 },
  'entry-level': { level: 'junior', rank: 1 },
  associate: { level: 'junior', rank: 1 },
  'mid-level': { level: 'mid', rank: 2 },
  intermediate: { level: 'mid', rank: 2 },
  senior: { level: 'senior', rank: 3 },
  lead: { level: 'lead', rank: 4 },
  staff: { level: 'lead', rank: 4 },
  principal: { level: 'principal', rank: 5 },
  director: { level: 'principal', rank: 5 },
}

/** The sample resume reads as mid-level. */
const RESUME_RANK = 2

/* Two lists, because they do different jobs.

   GRAMMAR is the usual function words. BOILERPLATE is recruiting filler —
   "looking", "required", "opportunity", "competitive". Filtering it matters
   more than it looks: without it the sandbox tells a jobseeker their CV is
   missing the word "looking", which is not advice, it is noise dressed as
   advice. Everything this panel says should be something a person could act
   on. */
const GRAMMAR = [
  'the','and','for','with','you','your','our','are','will','have','has','was','were','this','that','from',
  'they','their','them','can','all','any','not','but','who','how','why','what','when','where','which',
  'about','into','over','more','most','some','such','than','then','there','these','those','been','being',
  'we','an','in','on','at','to','of','is','it','as','by','or','be','if','do','does','including','etc',
  'us','its','his','her','out','up','also','both','each','other','across','within','while','through',
]

const BOILERPLATE = [
  'work','working','team','teams','role','job','position','company','experience','years','year',
  'ability','strong','excellent','good','great','plus','nice','must','should','would','could','may','well',
  'looking','look','seeking','seek','required','require','requirements','preferred','desirable','ideal',
  'candidate','candidates','applicant','hiring','hire','join','joining','opportunity','opportunities',
  'exciting','fast','growing','growth','dynamic','passionate','motivated','driven','talented',
  'salary','benefits','competitive','package','bonus','equity','pension','holiday','remote','hybrid',
  'responsibilities','responsible','duties','tasks','skills','knowledge','understanding','familiarity',
  'help','helping','support','supporting','ensure','ensuring','deliver','delivering','build','building',
  'develop','developing','manage','managing','lead','leading','collaborate','collaborating',
  'environment','culture','people','person','new','best','right','like','make','making','use','using',
  'day','days','week','weeks','month','months','time','part','full','level','apply','application',
  'please','contact','email','send','cv','resume','interested','welcome','equal','diverse','diversity',
  'problems','problem','solutions','solution','products','product','projects','project','customers',
  'clients','business','world','things','stuff','well','really','very',
]

const STOPWORDS = new Set([...GRAMMAR, ...BOILERPLATE])

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

function findSkills(text: string): string[] {
  /* Punctuation becomes spaces so a skill at the end of a sentence still has
     a boundary either side, but dots and slashes survive: "node.js" and
     "ci/cd" are single tokens. */
  const haystack = ' ' + norm(text).replace(/[^\w\s./-]/g, ' ').replace(/\s+/g, ' ') + ' '
  const found = new Set<string>()
  for (const skill of SKILL_LEXICON) {
    if (haystack.includes(' ' + skill + ' ')) found.add(skill)
  }
  return [...found]
}

function keyTerms(text: string): string[] {
  const counts = new Map<string, number>()
  for (const raw of norm(text).split(/[^a-z0-9./-]+/)) {
    const word = raw.replace(/^[.\-/]+|[.\-/]+$/g, '')
    if (word.length < 3 || STOPWORDS.has(word) || /^[\d.]+$/.test(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  /* A term has to earn its place: repeated at least twice, or a technology
     the lexicon recognises. A word said once in passing is not what the
     employer is screening on, and scoring against it produces confident
     advice about nothing.

     Ties break alphabetically so the result is stable for a given input — a
     panel that reorders its own reasons between renders reads as broken. */
  const skills = new Set(findSkills(text))
  return [...counts.entries()]
    .filter(([word, n]) => n >= 2 || skills.has(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([word]) => word)
}

function detectSeniority(text: string) {
  const haystack = ' ' + norm(text).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ') + ' '
  let best: { level: string; rank: number } | null = null
  for (const [term, info] of Object.entries(SENIORITY_TERMS)) {
    if (haystack.includes(' ' + term + ' ') && (!best || info.rank > best.rank)) best = info
  }
  return best
}

const EMPTY: SandboxResult = {
  score: 0,
  verdict: 'Nothing to score yet',
  explanation: 'Paste a job description on the left. The score updates as you type.',
  components: [
    { key: 'keywords', label: 'Keyword coverage', earned: 0, max: 35, reasons: [] },
    { key: 'skills', label: 'Skills match', earned: 0, max: 30, reasons: [] },
    { key: 'seniority', label: 'Seniority fit', earned: 0, max: 20, reasons: [] },
    { key: 'format', label: 'Format health', earned: 0, max: FORMAT_MAX, reasons: [] },
  ],
  matched: [],
  missing: [],
  empty: true,
}

/**
 * Scores the fixed sample resume against a pasted job description.
 *
 * Deterministic: the same description always returns the same result. Every
 * component below full marks carries at least one reason, because a score
 * without an explanation tells someone they failed without telling them what
 * to change.
 */
export function scoreAgainstSample(jobDescription: string): SandboxResult {
  const text = jobDescription.trim()
  /* Below this there is not enough signal for a score to mean anything, and
     a number swinging wildly on the third word typed reads as broken. */
  if (text.length < 40) return EMPTY

  const resumeSkills = new Set<string>(SAMPLE_RESUME.skills)

  /* ── Skills ── */
  const jdSkills = findSkills(text)
  const matched = jdSkills.filter((s) => resumeSkills.has(s)).sort()
  const missing = jdSkills.filter((s) => !resumeSkills.has(s)).sort()

  const skillsMax = 30
  const skillsEarned = jdSkills.length
    ? Math.round((matched.length / jdSkills.length) * skillsMax)
    : Math.round(skillsMax * 0.5)
  const skillsReasons: string[] = []
  if (!jdSkills.length) {
    skillsReasons.push(
      'No named technologies found in the description, so this scores as a neutral half rather than a zero.'
    )
  } else if (missing.length) {
    const shown = missing.slice(0, 4).join(', ')
    skillsReasons.push(
      missing.length +
        ' skill' +
        (missing.length === 1 ? '' : 's') +
        ' asked for and not on the resume: ' +
        shown +
        (missing.length > 4 ? ', and others.' : '.')
    )
  }

  /* ── Keyword coverage ── */
  const terms = keyTerms(text)
  const resumeHaystack = ' ' + norm([SAMPLE_RESUME.title, ...SAMPLE_RESUME.skills].join(' ')) + ' '
  const hits = terms.filter((t) => resumeHaystack.includes(' ' + t + ' ') || resumeSkills.has(t))
  const keywordsMax = 35
  /* Neutral half rather than zero when the posting repeats nothing specific
     enough to screen on — the same rule as skills. A zero would read as the
     resume's failure when it is the posting that said little. */
  const keywordsEarned = terms.length
    ? Math.round((hits.length / terms.length) * keywordsMax)
    : Math.round(keywordsMax * 0.5)
  const keywordsReasons: string[] = []
  if (!terms.length) {
    keywordsReasons.push(
      'This posting does not repeat any specific term often enough to screen on, so this scores as a neutral half.'
    )
  } else if (hits.length < terms.length) {
    const gap = terms.filter((t) => !hits.includes(t)).slice(0, 4).join(', ')
    keywordsReasons.push(
      hits.length + ' of the ' + terms.length + ' most repeated terms appear on the resume. Not matched: ' + gap + '.'
    )
  }

  /* ── Seniority ── */
  const wanted = detectSeniority(text)
  const seniorityMax = 20
  let seniorityEarned = seniorityMax
  const seniorityReasons: string[] = []
  if (!wanted) {
    seniorityEarned = Math.round(seniorityMax * 0.75)
    seniorityReasons.push('The description does not state a level, so this scores as an uncertain match.')
  } else {
    const gap = wanted.rank - RESUME_RANK
    if (gap > 0) {
      seniorityEarned = Math.max(0, seniorityMax - gap * 7)
      seniorityReasons.push(
        'The posting asks for ' +
          wanted.level +
          '. The sample resume reads as mid-level, with ' +
          SAMPLE_RESUME.yearsExperience +
          ' years.'
      )
    } else if (gap < 0) {
      seniorityEarned = Math.max(0, seniorityMax - Math.abs(gap) * 4)
      seniorityReasons.push(
        'The posting asks for ' +
          wanted.level +
          '. The sample resume is more senior than that, which can read as over-qualified.'
      )
    }
  }

  const components: ScoreComponent[] = [
    { key: 'keywords', label: 'Keyword coverage', earned: keywordsEarned, max: keywordsMax, reasons: keywordsReasons },
    { key: 'skills', label: 'Skills match', earned: skillsEarned, max: skillsMax, reasons: skillsReasons },
    { key: 'seniority', label: 'Seniority fit', earned: seniorityEarned, max: seniorityMax, reasons: seniorityReasons },
    {
      key: 'format',
      label: 'Format health',
      earned: FORMAT_EARNED,
      max: FORMAT_MAX,
      reasons: ['Measured on the resume, not the posting, so this one does not move as you edit.'],
    },
  ]

  const score = components.reduce((sum, c) => sum + c.earned, 0)
  const { verdict, explanation } = describe(score, missing)

  return { score, verdict, explanation, components, matched, missing, empty: false }
}

function describe(score: number, missing: string[]) {
  if (score >= 85) {
    return {
      verdict: 'A strong match',
      explanation: 'A resume like this would very likely be read by a person for this role.',
    }
  }
  if (score >= 70) {
    return {
      verdict: 'A good match',
      explanation: missing.length
        ? 'Close. Adding ' + missing.slice(0, 2).join(' and ') + ' would make the difference.'
        : 'Close. Small wording changes would lift it further.',
    }
  }
  if (score >= 55) {
    return {
      verdict: 'A partial match',
      explanation: 'Some of what this employer asks for is here, but an automated filter may not pass it on.',
    }
  }
  return {
    verdict: 'A weak match',
    explanation:
      'This role asks for work the resume does not describe. That is worth knowing before you spend an evening on the application.',
  }
}
