import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CirclePlay,
  ClipboardList,
  Command,
  FileClock,
  FileSearch,
  FileText,
  Gift,
  Globe,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Play,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { ConicRing } from '@/components/shared/ConicRing'
import { Logo } from '@/components/shared/Logo'
import { WovenPattern } from '@/components/shared/WovenPattern'
import { useAuth } from '@/context/AuthContext'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'
import { cn } from '@/lib/utils'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

const WORKFLOW_ICONS = {
  resume: FileSearch,
  interview: MessageSquareText,
  jobs: BriefcaseBusiness,
  applications: ClipboardList,
  offers: Gift,
} as const

const SMALL_FEATURE_ICONS = {
  letter: FileText,
  analytics: BarChart3,
  progress: TrendingUp,
  history: History,
  command: Command,
  privacy: ShieldCheck,
} as const

const WORKFLOW = [
  { title: 'Analyze resume', detail: 'Find ATS gaps and strengthen your story.', icon: 'resume' },
  { title: 'Practice interviews', detail: 'Build confidence with focused AI coaching.', icon: 'interview' },
  { title: 'Match jobs', detail: 'Prioritize roles where your experience stands out.', icon: 'jobs' },
  { title: 'Track applications', detail: 'Keep every deadline and conversation moving.', icon: 'applications' },
  { title: 'Compare offers', detail: 'Choose with clarity and negotiate from evidence.', icon: 'offers' },
] as const satisfies ReadonlyArray<{ title: string; detail: string; icon: keyof typeof WORKFLOW_ICONS }>

const SMALLER_FEATURES = [
  { title: 'Cover Letter Generator', detail: 'Create tailored, human-sounding letters grounded in your experience.', icon: 'letter' },
  { title: 'Career Analytics', detail: 'See which resumes, sources, and actions produce stronger outcomes.', icon: 'analytics' },
  { title: 'Progress Tracking', detail: 'Turn your search into clear milestones, goals, and weekly momentum.', icon: 'progress' },
  { title: 'History & Versions', detail: 'Restore past documents and revisit every coaching session.', icon: 'history' },
  { title: 'Command Palette', detail: 'Move through your entire career workflow without breaking focus.', icon: 'command' },
  { title: 'Google Sign-in & Privacy', detail: 'Start quickly while keeping your career data private and protected.', icon: 'privacy' },
] as const satisfies ReadonlyArray<{ title: string; detail: string; icon: keyof typeof SMALL_FEATURE_ICONS }>

// TODO: Replace these placeholder launch metrics with verified customer outcomes before publishing.
const RESULTS = [
  { value: 2, suffix: '×', label: 'more interview callbacks', detail: 'with role-specific resumes' },
  { value: 38, suffix: '%', label: 'less time spent tracking', detail: 'across one connected workflow' },
  { value: 7, suffix: ' days', label: 'faster to interview-ready', detail: 'with focused recommendations' },
] as const

// TODO: Replace these fictional preview stories with real customer testimonials before publishing.
const TESTIMONIALS = [
  { initials: 'MN', name: 'Maya N.', role: 'Product Designer', quote: 'HireLoom replaced the scattered spreadsheet, notes app, and interview doc I was constantly trying to keep in sync.' },
  { initials: 'JL', name: 'Jordan L.', role: 'Senior UX Designer', quote: 'The feedback is specific enough to act on. I finally knew which stories needed work before the real interview.' },
  { initials: 'PR', name: 'Priya R.', role: 'Product Manager', quote: 'Seeing preparation and applications in one place made the search feel measurable instead of emotionally chaotic.' },
] as const

const FAQS = [
  { question: 'Is HireLoom free to use?', answer: 'Yes. The Free plan includes three resume analyses, two practice sessions, and basic job matching. Upgrade only when you need more volume or advanced coaching.' },
  { question: 'Does it work with any resume format?', answer: 'HireLoom supports PDF and DOCX resumes. Clean, text-based documents produce the strongest analysis, and you can compare multiple saved versions.' },
  { question: 'How is my data protected?', answer: 'Your career data is private by default, encrypted in transit, and never shared with employers without your permission. You can export or delete it at any time.' },
  { question: 'Can I cancel anytime?', answer: 'Yes. Paid plans can be changed or canceled from Settings. You retain access through the end of your current billing period.' },
  { question: 'Which roles does HireLoom support?', answer: 'HireLoom is designed for modern knowledge-work roles across design, product, engineering, marketing, operations, and customer experience.' },
  { question: 'How does the AI score my interviews?', answer: 'Answers are evaluated across clarity, structure, relevance, confidence, and conciseness. You receive evidence-backed feedback and stronger sample responses—not a black-box verdict.' },
] as const

// TODO: Confirm final launch prices before publishing — mirrors Settings → Billing today.
interface PricingPlan {
  name: string
  price: string
  detail: string
  features: string[]
  popular?: boolean
}
const PRICING_PLANS: PricingPlan[] = [
  { name: 'Free', price: '$0', detail: 'Get started with the essentials', features: ['3 resume analyses', '2 practice sessions', 'Basic job matches'] },
  { name: 'Pro', price: '$19', detail: 'Build momentum with unlimited prep', features: ['Unlimited analyses', '10 AI sessions monthly', 'Tailored cover letters'], popular: true },
  { name: 'Premium', price: '$39', detail: 'End-to-end support through offer', features: ['Unlimited AI coaching', 'Offer negotiation', 'Priority job matches'] },
]

const RESUME_RUBRIC = [
  { label: 'Formatting', score: 92 },
  { label: 'Keywords', score: 68 },
  { label: 'Impact & metrics', score: 72 },
  { label: 'Readability', score: 88 },
] as const
const RESUME_MISSING_KEYWORDS = ['Design Systems', 'A/B Testing', 'Figma Variables'] as const

const INTERVIEW_RADAR = [
  { skill: 'Clarity', score: 8.2 },
  { skill: 'STAR Structure', score: 7.1 },
  { skill: 'Relevance', score: 8.5 },
  { skill: 'Confidence', score: 7.6 },
  { skill: 'Conciseness', score: 5.8 },
] as const

const OFFER_PREVIEWS = [
  { company: 'Stripe', color: 'bg-violet-600', total: 280, growth: 9.4 },
  { company: 'Figma', color: 'bg-slate-900', total: 285, growth: 9.1 },
  { company: 'Notion', color: 'bg-slate-500', total: 265, growth: 8.8 },
] as const

const FOOTER_COLUMNS = [
  { title: 'Product', links: ['Features', 'How it works', 'Pricing', 'FAQ'] },
  { title: 'Company', links: ['About', 'Careers', 'Contact'] },
  { title: 'Resources', links: ['Career guide', 'Interview library', 'Help center'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Security'] },
] as const
const FOOTER_PATHS: Record<string, string> = {
  About: '/about',
  Careers: '/careers',
  Contact: '/contact',
  'Career guide': '/career-guide',
  'Interview library': '/interview-library',
  'Help center': '/help',
  Privacy: '/privacy',
  Terms: '/terms',
  Security: '/security',
}
const SCROLL_LINKS = ['Features', 'How it works', 'Pricing', 'FAQ']

const PAGE_TITLE = 'HireLoom | Prepare Smarter. Apply With Confidence.'
const PAGE_DESCRIPTION =
  'One connected AI career workflow: analyze your resume, practice role-specific interviews, match to jobs, track every application, and compare offers with clarity.'

function usePageMeta() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = PAGE_TITLE

    const tags: Array<{ selector: string; attr: 'name' | 'property'; key: string; content: string }> = [
      { selector: 'meta[name="description"]', attr: 'name', key: 'description', content: PAGE_DESCRIPTION },
      { selector: 'meta[property="og:title"]', attr: 'property', key: 'og:title', content: PAGE_TITLE },
      { selector: 'meta[property="og:description"]', attr: 'property', key: 'og:description', content: PAGE_DESCRIPTION },
      { selector: 'meta[property="og:type"]', attr: 'property', key: 'og:type', content: 'website' },
      { selector: 'meta[name="twitter:card"]', attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
      { selector: 'meta[name="twitter:title"]', attr: 'name', key: 'twitter:title', content: PAGE_TITLE },
      { selector: 'meta[name="twitter:description"]', attr: 'name', key: 'twitter:description', content: PAGE_DESCRIPTION },
    ]

    const created: HTMLMetaElement[] = []
    const previousContent: Array<{ el: HTMLMetaElement; content: string | null }> = []

    for (const tag of tags) {
      let el = document.head.querySelector<HTMLMetaElement>(tag.selector)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(tag.attr, tag.key)
        document.head.appendChild(el)
        created.push(el)
      } else {
        previousContent.push({ el, content: el.getAttribute('content') })
      }
      el.setAttribute('content', tag.content)
    }

    return () => {
      document.title = previousTitle
      created.forEach((el) => el.remove())
      previousContent.forEach(({ el, content }) => {
        if (content === null) el.removeAttribute('content')
        else el.setAttribute('content', content)
      })
    }
  }, [])
}

export function LandingPage() {
  usePageMeta()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    setMenuOpen(false)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [])

  const primaryCta = user
    ? { label: 'Go to dashboard', onClick: () => navigate('/dashboard') }
    : { label: 'Get started free', onClick: () => navigate('/signup') }

  return (
    <div className="min-h-screen overflow-x-clip bg-white text-slate-900">
      <nav
        className={cn(
          'fixed inset-x-0 top-0 z-[70] grid h-[72px] grid-cols-[1fr_auto_1fr] items-center px-[max(24px,calc((100vw-1180px)/2))] transition-[background-color,box-shadow] duration-[220ms] ease-out max-[820px]:grid-cols-[1fr_auto] max-[820px]:px-5',
          scrolled && 'border-b border-slate-200 bg-white/94 shadow-[0_2px_12px_rgba(15,23,42,0.03)] backdrop-blur-[14px]'
        )}
      >
        <Link to="/" className="justify-self-start">
          <Logo />
        </Link>

        <div className="col-start-2 flex items-center justify-center gap-0.5 max-[820px]:hidden">
          {SCROLL_LINKS.map((label) => (
            <Button
              key={label}
              variant="ghost"
              size="sm"
              className="text-[11px]"
              onClick={() => goTo(label.toLowerCase().replace(/ /g, '-'))}
            >
              {label}
            </Button>
          ))}
        </div>

        {menuOpen && (
          <div className="absolute left-3 right-3 top-[65px] hidden rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] max-[820px]:grid max-[820px]:gap-1">
            {SCROLL_LINKS.map((label) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                className="w-full justify-start text-[11px]"
                onClick={() => goTo(label.toLowerCase().replace(/ /g, '-'))}
              >
                {label}
              </Button>
            ))}
            <div className="grid grid-cols-2 gap-[7px] border-t border-slate-200 pt-2">
              {user ? (
                <Button className="col-span-2 justify-center" size="sm" onClick={() => { navigate('/dashboard'); setMenuOpen(false) }}>
                  Go to dashboard
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="justify-center" onClick={() => { navigate('/login'); setMenuOpen(false) }}>
                    Sign in
                  </Button>
                  <Button size="sm" className="justify-center" onClick={() => { navigate('/signup'); setMenuOpen(false) }}>
                    Get started free
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="col-start-3 flex items-center justify-end gap-1.5 max-[820px]:hidden">
          {!user && (
            <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
              Sign in
            </Button>
          )}
          <Button size="sm" onClick={primaryCta.onClick}>
            {primaryCta.label}
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="hidden justify-self-end max-[820px]:inline-flex"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </nav>

      <main>
        <section className="relative grid min-h-[760px] items-center overflow-hidden bg-[linear-gradient(180deg,#f9faff_0%,white_85%)] px-6 pb-20 pt-[132px] max-[820px]:pt-[115px] max-[520px]:min-h-0 max-[520px]:pb-[55px] max-[520px]:pt-[105px]">
          <WovenPattern className="opacity-[0.035] [mask-image:linear-gradient(to_bottom,black,transparent_92%)] text-primary" />
          <div className="pointer-events-none absolute right-[-90px] top-[110px] h-[360px] w-[360px] rounded-full bg-coral opacity-[0.22] blur-[110px]" />
          <div className="pointer-events-none absolute bottom-0 left-[-220px] h-[420px] w-[420px] rounded-full bg-indigo-400 opacity-[0.14] blur-[110px]" />

          <div className="relative mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-[0.88fr_1.12fr] items-center gap-[55px] max-[1100px]:grid-cols-[0.85fr_1.15fr] max-[1100px]:gap-[25px] max-[820px]:grid-cols-1 max-[820px]:gap-[25px] max-[820px]:text-center">
            <div>
              <span className="inline-flex items-center gap-[7px] rounded-full border border-indigo-200 bg-[rgba(238,242,255,0.7)] px-2.5 py-[7px] text-[9px] font-extrabold uppercase tracking-[0.04em] text-primary">
                <Sparkles size={14} /> AI-powered career platform
              </span>
              <h1 className="mt-[22px] font-heading text-[clamp(42px,4.1vw,61px)] font-extrabold leading-[1.06] tracking-[-0.052em] max-[1100px]:text-[44px] max-[520px]:text-[39px] max-[520px]:leading-[1.08]">
                Prepare smarter.
                <br />
                Apply with confidence.
                <br />
                <em className="not-italic text-coral">Never guess where you stand.</em>
              </h1>
              <p className="mx-auto mt-[21px] max-w-[535px] text-[15px] leading-[1.65] text-slate-600 max-[520px]:text-[13px] max-[820px]:mx-auto">
                Go from job search to offer in one connected workflow built around your goals, experience, and progress.
              </p>
              <div className="mt-[25px] flex gap-[9px] max-[820px]:justify-center max-[520px]:grid">
                <Button className="h-12 gap-2 px-5" onClick={primaryCta.onClick}>
                  {primaryCta.label} <ArrowRight size={16} />
                </Button>
                <Button variant="outline" className="h-12 gap-2 px-5" onClick={() => goTo('how-it-works')}>
                  <Play size={15} /> See how it works
                </Button>
              </div>
              <span className="mt-[13px] flex items-center gap-[5px] text-[9px] text-slate-400 max-[820px]:justify-center">
                <Check size={13} /> No credit card required
              </span>
            </div>

            <HeroProductPreview />
          </div>
        </section>

        <FadeSection className="border-y border-slate-200 bg-slate-50 py-[75px] text-center max-[520px]:py-[72px]">
          <div className="mx-auto w-[min(calc(100%-48px),1180px)]">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-primary">One connected workspace</span>
            <h2 className="mt-2 font-heading text-[28px] font-extrabold max-[520px]:text-[25px]">Job hunting shouldn&rsquo;t take five tools.</h2>
            <div className="mt-[31px] grid grid-cols-[1fr_130px_280px] items-center max-[820px]:grid-cols-1 max-[820px]:gap-[18px]">
              <div className="flex flex-wrap justify-center gap-2">
                {([
                  ['Spreadsheet', LayoutDashboard],
                  ['Documents', FileText],
                  ['Notes', FileClock],
                  ['Job boards', Search],
                  ['Practice apps', MessageSquareText],
                ] as const).map(([label, Icon], index) => (
                  <span
                    key={label}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-[11px] py-[9px] text-[9px] text-slate-600 shadow-[0_2px_8px_rgba(15,23,42,0.04)]',
                      (index === 1 || index === 4) && 'translate-y-2.5'
                    )}
                  >
                    <Icon size={15} /> {label}
                  </span>
                ))}
              </div>
              <div className="relative h-[85px] max-[820px]:hidden" aria-hidden="true">
                {[
                  { top: 8, rotate: 18 },
                  { top: 26, rotate: 9 },
                  { top: 42, rotate: 0 },
                  { top: 59, rotate: -9 },
                  { top: 76, rotate: -18 },
                ].map((line) => (
                  <i
                    key={line.top}
                    className="absolute right-0 h-px w-full origin-right bg-[linear-gradient(90deg,#e2e8f0,#818cf8)]"
                    style={{ top: line.top, transform: `rotate(${line.rotate}deg)` }}
                  />
                ))}
              </div>
              <div className="mx-auto grid w-[min(100%,330px)] justify-items-start rounded-xl border border-indigo-200 bg-white p-[18px] text-left shadow-[0_10px_30px_rgba(67,56,202,0.1)]">
                <Logo />
                <strong className="mt-3 font-heading text-[10px] font-bold">One clear path from search to offer.</strong>
                <small className="mt-[3px] text-[8px] text-slate-400">Every action improves what comes next.</small>
              </div>
            </div>
          </div>
        </FadeSection>

        <FadeSection id="how-it-works" className="py-[105px] max-[520px]:py-[72px]">
          <SectionHeading
            eyebrow="How it works"
            title="One workflow. Every step connected."
            description="HireLoom turns scattered career tasks into a loop that gets smarter as you make progress."
          />
          <div className="relative mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-5 max-[820px]:grid-cols-3 max-[820px]:gap-y-[25px] max-[520px]:grid-cols-2 max-[520px]:gap-y-7">
            {WORKFLOW.map((step, index) => {
              const Icon = WORKFLOW_ICONS[step.icon]
              return (
                <div
                  key={step.title}
                  className={cn(
                    'relative px-[19px] text-center',
                    index === WORKFLOW.length - 1 && 'max-[520px]:col-span-2 max-[520px]:mx-auto max-[520px]:w-1/2'
                  )}
                >
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] border border-indigo-200 bg-secondary text-primary shadow-[0_0_0_7px_white]">
                    <Icon size={20} />
                  </span>
                  <strong className="mt-3.5 block font-heading text-[10px] font-bold">{step.title}</strong>
                  <p className="mt-[5px] text-[8.5px] text-slate-600">{step.detail}</p>
                  {index < WORKFLOW.length - 1 && (
                    <ArrowRight className="absolute right-[-9px] top-4 text-indigo-400 max-[820px]:hidden" size={17} />
                  )}
                </div>
              )
            })}
            <div className="absolute left-[9%] right-[9%] top-[135px] flex h-[49px] items-end justify-center gap-1.5 text-[8px] text-slate-400 max-[820px]:hidden">
              <div className="absolute left-0 top-0 h-8 w-[47%] rounded-bl-[15px] border-b border-l border-dashed border-indigo-400" />
              <div className="absolute right-0 top-0 h-8 w-[47%] rounded-br-[15px] border-b border-r border-dashed border-indigo-400" />
              <TrendingUp size={15} className="relative" />
              <span className="relative">Measure progress</span>
            </div>
          </div>
        </FadeSection>

        <section id="features" className="bg-slate-50 py-[105px] max-[520px]:py-[72px]">
          <SectionHeading
            eyebrow="A stronger way to move forward"
            title="Focused tools that share the full picture."
            description="Every HireLoom module learns from the same career profile, so preparation compounds instead of starting over."
          />
          <FadeSection className="mx-auto mb-[90px] grid w-[min(calc(100%-48px),1100px)] grid-cols-[0.82fr_1.18fr] items-center gap-[70px] max-[820px]:grid-cols-1 max-[820px]:gap-8 max-[820px]:text-center max-[520px]:mb-[65px]">
            <FeatureCopy
              label="Resume Analyzer"
              title="Turn vague resume advice into precise next steps."
              points={['See your ATS score and the rubric behind it', 'Find role-specific keyword and experience gaps', 'Apply prioritized fixes with measurable impact']}
              to="/resume"
            />
            <ResumeMarketingPreview />
          </FadeSection>
          <FadeSection className="mx-auto mb-[90px] grid w-[min(calc(100%-48px),1100px)] grid-cols-[1.18fr_0.82fr] items-center gap-[70px] max-[820px]:grid-cols-1 max-[820px]:gap-8 max-[820px]:text-center max-[520px]:mb-[65px]">
            <div className="max-[820px]:order-2">
              <InterviewMarketingPreview />
            </div>
            <div className="max-[820px]:order-1">
              <FeatureCopy
                label="Interview Coach"
                title="Practice the questions that actually move your score."
                points={['Sessions shaped by your resume gaps and target role', 'Feedback across clarity, relevance, and confidence', 'Stronger sample answers grounded in your experience']}
                to="/interview"
              />
            </div>
          </FadeSection>
          <FadeSection className="mx-auto mb-[90px] grid w-[min(calc(100%-48px),1100px)] grid-cols-[0.82fr_1.18fr] items-center gap-[70px] max-[820px]:grid-cols-1 max-[820px]:gap-8 max-[820px]:text-center max-[520px]:mb-[65px]">
            <FeatureCopy
              label="Jobs + Applications"
              title="Find the right roles—and keep every one moving."
              points={['AI-ranked matches with transparent reasoning', 'A drag-and-drop pipeline for every opportunity', 'Clear next steps, deadlines, and follow-up reminders']}
              to="/jobs"
            />
            <JobsMarketingPreview />
          </FadeSection>
          <FadeSection className="mx-auto grid w-[min(calc(100%-48px),1100px)] grid-cols-[1.18fr_0.82fr] items-center gap-[70px] max-[820px]:grid-cols-1 max-[820px]:gap-8 max-[820px]:text-center">
            <div className="max-[820px]:order-2">
              <OffersMarketingPreview />
            </div>
            <div className="max-[820px]:order-1">
              <FeatureCopy
                label="Offer Comparison"
                title="Compare the whole opportunity, not just the salary."
                points={['Evaluate compensation, growth, culture, and flexibility', 'Weight what matters and recalculate your best fit', 'Build a negotiation plan from competing offers']}
                to="/offers"
              />
            </div>
          </FadeSection>
        </section>

        <FadeSection className="py-[105px] max-[520px]:py-[72px]">
          <SectionHeading
            eyebrow="Everything else you need"
            title="The details are connected, too."
            description="Powerful supporting tools keep the workflow fast without adding more tabs or subscriptions."
          />
          <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-3 gap-3 max-[820px]:grid-cols-2 max-[520px]:grid-cols-1">
            {SMALLER_FEATURES.map((feature) => {
              const Icon = SMALL_FEATURE_ICONS[feature.icon]
              return (
                <div
                  key={feature.title}
                  className="min-h-[170px] rounded-xl border border-slate-200 bg-white p-[22px] shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
                >
                  <span className="grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-secondary text-primary">
                    <Icon size={19} />
                  </span>
                  <h3 className="mt-4 font-heading text-[13px] font-bold">{feature.title}</h3>
                  <p className="mt-1.5 text-[9px] text-slate-600">{feature.detail}</p>
                </div>
              )
            })}
          </div>
        </FadeSection>

        <FadeSection className="bg-[#151442] py-20 text-white">
          <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-[1.35fr_repeat(3,1fr)] items-center max-[820px]:grid-cols-3 max-[520px]:grid-cols-1">
            <div className="pr-[45px] max-[820px]:col-span-3 max-[820px]:pb-[25px] max-[820px]:pr-0 max-[820px]:text-center max-[520px]:col-span-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-indigo-300">Designed for momentum</span>
              <h2 className="mt-2 font-heading text-[28px] font-extrabold text-white">A clearer process creates stronger outcomes.</h2>
              <p className="mt-2 text-[9px] text-indigo-200">Prepare with intention, focus on better-fit roles, and make every application count.</p>
            </div>
            {RESULTS.map((result, index) => (
              <div
                key={result.label}
                className={cn(
                  'min-h-[130px] border-l border-white/[0.13] px-[22px] py-[15px] max-[520px]:min-h-[100px] max-[520px]:border-l-0 max-[520px]:border-t max-[520px]:text-center',
                  index === 0 && 'max-[820px]:border-l-0'
                )}
              >
                <strong className="font-heading text-[40px] font-extrabold tracking-[-0.05em] text-[#fda48f]">
                  <CountUp value={result.value} />
                  {result.suffix}
                </strong>
                <span className="mt-1.5 block text-[9px] font-bold">{result.label}</span>
                <small className="mt-[3px] block text-[7px] text-indigo-300">{result.detail}</small>
              </div>
            ))}
          </div>
        </FadeSection>

        <FadeSection className="bg-slate-50 py-[105px] max-[520px]:py-[72px]">
          <SectionHeading
            eyebrow="Built for real job searches"
            title="Less chaos. More confidence."
            description="Fictional preview stories representing the experience HireLoom is designed to create."
          />
          <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-3 gap-3 max-[820px]:grid-cols-2 max-[520px]:grid-cols-1">
            {TESTIMONIALS.map((testimonial) => (
              <div
                key={testimonial.name}
                className="flex min-h-[230px] flex-col rounded-xl border border-slate-200 bg-white p-[23px] shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
              >
                <div className="h-[34px] font-serif text-[38px] font-extrabold leading-none text-coral">&ldquo;</div>
                <p className="flex-1 text-[10px] leading-[1.7] text-slate-600">{testimonial.quote}</p>
                <div className="flex items-center gap-[9px] border-t border-slate-200 pt-3.5">
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-coral-tint text-[8px] font-extrabold text-orange-800">
                    {testimonial.initials}
                  </span>
                  <div>
                    <strong className="block text-[9px]">{testimonial.name}</strong>
                    <small className="text-[7px] text-slate-400">{testimonial.role}</small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </FadeSection>

        <PricingSection primaryCta={primaryCta} navigate={navigate} />
        <FaqSection />

        <FadeSection className="relative overflow-hidden bg-[linear-gradient(120deg,#312e81,hsl(var(--primary)),#4f46e5)] py-[90px] text-center text-white max-[520px]:py-[72px]">
          <WovenPattern className="opacity-10" />
          <div className="relative mx-auto grid w-[min(calc(100%-48px),1180px)] justify-items-center">
            <AiBadge label="YOUR NEXT CHAPTER" />
            <h2 className="mt-[13px] font-heading text-[36px] font-extrabold text-white max-[520px]:text-[30px]">
              Your next offer starts with one upload.
            </h2>
            <p className="max-w-[570px] text-[11px] text-indigo-200">
              Build a career workflow that shows you what to improve, where to focus, and how far you&rsquo;ve come.
            </p>
            <Button className="mt-3 bg-white text-primary hover:bg-coral-tint" onClick={primaryCta.onClick}>
              {primaryCta.label} <ArrowRight size={16} />
            </Button>
          </div>
        </FadeSection>
      </main>

      <MarketingFooter goTo={goTo} navigate={navigate} />
    </div>
  )
}

function HeroProductPreview() {
  return (
    <div className="relative px-[15px] pb-[25px] pl-[25px] pt-10 max-[520px]:px-0 max-[520px]:pb-[18px] max-[520px]:pt-[34px]">
      <div className="absolute left-[-20px] top-4 z-[2] flex animate-float-card items-center gap-[9px] rounded-[9px] border border-slate-200 bg-white px-3 py-2.5 text-[8px] text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] motion-reduce:animate-none max-[520px]:left-[-7px]">
        ATS score{' '}
        <strong className="flex items-center gap-[3px] font-heading text-[11px] font-extrabold text-slate-900">
          78 <TrendingUp size={13} className="text-success" />
        </strong>
      </div>
      <div className="absolute right-[-16px] top-[138px] z-[2] flex animate-float-card items-center gap-[9px] rounded-[9px] border border-slate-200 bg-white px-3 py-2.5 text-[8px] text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] [animation-delay:-0.8s] motion-reduce:animate-none max-[520px]:right-[-7px]">
        Interview <strong className="font-heading text-[11px] font-extrabold text-slate-900">7.4/10</strong>
      </div>
      <div className="absolute bottom-0 right-[18px] z-[2] flex animate-float-card items-center gap-[9px] rounded-[9px] border border-slate-200 bg-white px-3 py-2.5 text-[8px] text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] [animation-delay:-1.5s] motion-reduce:animate-none max-[520px]:right-1">
        Match <strong className="font-heading text-[11px] font-extrabold text-slate-900">92%</strong>
      </div>

      <div className="min-h-[500px] rounded-xl border border-[#dbe3f1] bg-white/96 px-6 pb-6 shadow-[0_32px_80px_rgba(67,56,202,0.13),0_8px_24px_rgba(15,23,42,0.09)] [transform:rotateY(-5deg)_rotateX(2deg)_rotateZ(1deg)] max-[520px]:min-h-[430px] max-[520px]:px-3.5 max-[520px]:[transform:rotateY(-2deg)_rotateZ(0.5deg)]">
        <div className="-mx-6 flex h-[59px] items-center gap-[7px] border-b border-slate-200 px-[18px] max-[520px]:-mx-3.5">
          <Logo compact />
          <span className="font-heading text-sm font-extrabold">HireLoom</span>
          <span className="ml-auto h-[7px] w-[7px] rounded-full bg-slate-200" />
          <span className="h-[7px] w-[7px] rounded-full bg-slate-200" />
        </div>
        <div className="flex items-center justify-between py-[23px] pb-[17px]">
          <div>
            <small className="text-[7px] tracking-[0.08em] text-slate-400">GOOD MORNING, USER</small>
            <strong className="mt-[5px] block font-heading text-[17px] font-extrabold">Your career dashboard</strong>
          </div>
          <AnimatedConicRing value={72} size={44} />
        </div>
        <div className="grid grid-cols-3 gap-2 max-[520px]:gap-[5px]">
          <div className="grid rounded-[9px] border border-slate-200 bg-white p-3 max-[520px]:p-2">
            <span className="text-[7px] text-slate-400">Resume score</span>
            <strong className="my-0.5 font-heading text-xl font-extrabold">78</strong>
            <small className="text-[6.5px] text-success">+6 this month</small>
          </div>
          <div className="grid rounded-[9px] border border-slate-200 bg-white p-3 max-[520px]:p-2">
            <span className="text-[7px] text-slate-400">Interview avg.</span>
            <strong className="my-0.5 font-heading text-xl font-extrabold">7.4</strong>
            <small className="text-[6.5px] text-success">+0.8 this week</small>
          </div>
          <div className="grid rounded-[9px] border border-slate-200 bg-white p-3 max-[520px]:p-2">
            <span className="text-[7px] text-slate-400">Applications</span>
            <strong className="my-0.5 font-heading text-xl font-extrabold">12</strong>
            <small className="text-[6.5px] text-success">4 need follow-up</small>
          </div>
        </div>
        <div className="mt-3 rounded-[10px] border border-slate-200 bg-[linear-gradient(130deg,white,hsl(var(--coral-tint)))] p-[17px]">
          <AiBadge label="AI RECOMMENDED" />
          <h3 className="my-[9px] font-heading text-xs font-bold">Your Next Best Actions</h3>
          {['Practice your Stripe interview', 'Close two resume skill gaps', 'Follow up with Notion'].map((action, index) => (
            <div
              key={action}
              className="grid min-h-[44px] grid-cols-[28px_1fr_18px] items-center border-t border-slate-200"
            >
              <span className="font-heading text-[8px] font-bold text-slate-400">0{index + 1}</span>
              <strong className="text-[8.5px]">{action}</strong>
              <ArrowRight size={13} className="text-primary" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FeatureCopy({ label, title, points, to }: { label: string; title: string; points: string[]; to: string }) {
  return (
    <div>
      <AiBadge label={label.toUpperCase()} />
      <h2 className="mx-auto mt-3 max-w-[430px] font-heading text-[30px] font-extrabold leading-[1.25] max-[520px]:text-[26px]">
        {title}
      </h2>
      <div className="mx-auto mt-5 grid w-fit gap-[11px] text-left">
        {points.map((point) => (
          <p key={point} className="m-0 flex items-center gap-[9px] text-[10px] text-slate-600">
            <span className="grid h-[23px] w-[23px] shrink-0 place-items-center rounded-full bg-success-tint text-success">
              <Check size={14} />
            </span>
            {point}
          </p>
        ))}
      </div>
      <Button variant="ghost" className="mt-[18px] px-0 text-primary hover:bg-transparent" asChild>
        <Link to={to}>
          Explore {label} <ArrowRight size={15} />
        </Link>
      </Button>
    </div>
  )
}

function MarketingUiFrame({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.1)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_25px_60px_rgba(15,23,42,0.13)]',
        className
      )}
    >
      <div className="flex h-[42px] items-center gap-[5px] border-b border-slate-200 bg-slate-50 px-[13px]">
        <i className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <i className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <i className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span className="ml-1.5 text-[7px] text-slate-400">{label}</span>
      </div>
      {children}
    </div>
  )
}

function ResumeMarketingPreview() {
  return (
    <MarketingUiFrame label="Resume analysis" className="px-[21px] pb-[22px]">
      <div className="flex items-center gap-[15px] py-5">
        <AnimatedConicRing value={78} size={72} />
        <div>
          <AiBadge />
          <h3 className="mt-1.5 font-heading text-[13px] font-bold">Strong foundation</h3>
          <p className="my-[3px] text-[8px] text-slate-600">Three focused updates can take this resume into the mid-80s.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {RESUME_RUBRIC.map((item) => (
          <div key={item.label}>
            <span className="flex justify-between text-[8px] text-slate-600">
              {item.label} <strong className="text-slate-900">{item.score}</strong>
            </span>
            <i className="mt-1.5 block h-[5px] rounded-full bg-slate-100">
              <b className="block h-full rounded-full bg-success" style={{ width: `${item.score}%` }} />
            </i>
          </div>
        ))}
      </div>
      <span className="mt-3 block text-[8px] font-bold text-slate-400">Keyword gaps</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {RESUME_MISSING_KEYWORDS.map((item) => (
          <span key={item} className="rounded-full border border-dashed border-slate-300 px-2 py-[3px] text-[8px] text-slate-500">
            + {item}
          </span>
        ))}
      </div>
    </MarketingUiFrame>
  )
}

function InterviewMarketingPreview() {
  return (
    <MarketingUiFrame label="Interview feedback" className="px-5 pb-[18px]">
      <div className="py-5 pb-4">
        <AiBadge label="QUESTION 3 OF 8" />
        <h3 className="mt-2.5 max-w-[470px] font-heading text-[15px] font-bold leading-[1.45]">
          Tell me about a time you influenced a product decision without direct authority.
        </h3>
        <div className="mt-3 flex gap-1">
          <span className="h-1 flex-1 rounded-full bg-coral" />
          <span className="h-1 flex-1 rounded-full bg-slate-200" />
          <span className="h-1 flex-1 rounded-full bg-slate-200" />
        </div>
      </div>
      <div className="grid min-h-[210px] grid-cols-[1.15fr_0.85fr] items-center border-t border-slate-200 max-[520px]:grid-cols-1">
        <div className="h-[195px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={INTERVIEW_RADAR as unknown as Array<{ skill: string; score: number }>} outerRadius="68%">
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="skill" tick={{ fill: '#475569', fontSize: 7 }} />
              <Radar dataKey="score" stroke="#f26b4f" fill="#f26b4f" fillOpacity={0.18} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid justify-items-start gap-0 max-[520px]:grid-cols-[auto_1fr] max-[520px]:items-center max-[520px]:gap-x-2.5 max-[520px]:px-2.5 max-[520px]:pb-[15px]">
          <AnimatedConicRing value={74} size={64} suffix="/10" displayValue={7.4} />
          <strong className="mt-2 text-[10px] max-[520px]:col-start-2 max-[520px]:mt-0">Strong and credible</strong>
          <p className="text-[8px] text-slate-600 max-[520px]:col-span-2">Sharpen your structure and close with the measurable result.</p>
        </div>
      </div>
    </MarketingUiFrame>
  )
}

function JobsMarketingPreview() {
  const columns = [
    { stage: 'Saved', companies: ['Linear', 'Mercury'] },
    { stage: 'Interviewing', companies: ['Stripe', 'Airbnb'] },
    { stage: 'Offer', companies: ['Figma', 'Notion'] },
  ]
  return (
    <MarketingUiFrame label="Matches + pipeline" className="px-[17px] pb-[17px]">
      <div className="grid grid-cols-[38px_1fr_auto] items-center gap-2.5 py-4">
        <span className="grid h-[38px] w-[38px] place-items-center rounded-md bg-slate-900 text-[13px] font-extrabold text-white">F</span>
        <div>
          <strong className="text-[9px]">Senior Product Designer, Growth</strong>
          <small className="mt-0.5 block text-[7px] text-slate-400">Figma · San Francisco</small>
          <span className="mt-[5px] block text-[7px] text-slate-600">Growth design · Experimentation</span>
        </div>
        <b className="text-right font-heading text-xl font-extrabold text-success">
          94%
          <small className="block text-right font-sans text-[6px] font-semibold uppercase text-slate-400">match</small>
        </b>
      </div>
      <div className="grid grid-cols-3 gap-[7px] rounded-[9px] bg-slate-50 p-2.5 max-[520px]:grid-cols-1">
        {columns.map((column) => (
          <div key={column.stage}>
            <span className="flex justify-between text-[7px] font-bold text-slate-600">
              {column.stage} <b>{column.companies.length}</b>
            </span>
            {column.companies.map((company) => (
              <div key={company} className="mt-1.5 grid grid-cols-[22px_1fr] gap-x-1.5 rounded-md border border-slate-200 bg-white p-2">
                <i className="row-span-2 grid h-[21px] w-[21px] place-items-center rounded-[5px] bg-slate-700 text-[7px] font-extrabold not-italic text-white">
                  {company[0]}
                </i>
                <strong className="text-[7px]">{company}</strong>
                <small className="text-[5.5px] text-slate-400">Senior Product Designer</small>
              </div>
            ))}
          </div>
        ))}
      </div>
    </MarketingUiFrame>
  )
}

function OffersMarketingPreview() {
  return (
    <MarketingUiFrame label="Offer comparison" className="px-[15px] pb-[18px]">
      <div className="grid grid-cols-3 gap-[7px] overflow-x-auto pt-4">
        {OFFER_PREVIEWS.map((offer, index) => (
          <div
            key={offer.company}
            className={cn(
              'relative grid justify-items-start rounded-[9px] border border-slate-200 p-[13px]',
              index === 1 && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]'
            )}
          >
            {index === 1 && (
              <span className="absolute right-1.5 top-1.5 flex items-center gap-[3px] rounded-full bg-primary px-[5px] py-[3px] text-[5.5px] text-white">
                <Sparkles size={8} /> Best fit
              </span>
            )}
            <span className={cn('h-7 w-7 rounded-md text-center text-[11px] font-extrabold leading-7 text-white', offer.color)}>
              {offer.company[0]}
            </span>
            <h3 className="mt-2.5 text-[10px] font-bold">{offer.company}</h3>
            <small className="mt-3 text-[6px] text-slate-400">Total compensation</small>
            <strong className="font-heading text-base font-extrabold">${offer.total}k</strong>
            <i className="mt-1 block h-[5px] w-full rounded-full bg-slate-100">
              <b className="block h-full rounded-full bg-primary" style={{ width: `${offer.growth * 10}%` }} />
            </i>
            <p className="mt-1 text-[6.5px] text-slate-500">Growth {offer.growth}/10</p>
          </div>
        ))}
      </div>
    </MarketingUiFrame>
  )
}

function PricingSection({
  primaryCta,
  navigate,
}: {
  primaryCta: { label: string; onClick: () => void }
  navigate: (path: string) => void
}) {
  const [yearly, setYearly] = useState(true)
  return (
    <FadeSection id="pricing" className="py-[105px] max-[520px]:py-[72px]">
      <SectionHeading
        eyebrow="Simple pricing"
        title="Start free. Upgrade when momentum builds."
        description="No hidden fees, no long-term contracts, and no charge to keep your data."
      />
      <div className="mx-auto -mt-[22px] mb-[30px] flex w-fit rounded-[9px] bg-slate-50 p-1 max-[520px]:-mt-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn('text-[9px]', !yearly && 'bg-white text-primary shadow-[0_2px_8px_rgba(15,23,42,0.04)]')}
          onClick={() => setYearly(false)}
        >
          Monthly
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn('text-[9px]', yearly && 'bg-white text-primary shadow-[0_2px_8px_rgba(15,23,42,0.04)]')}
          onClick={() => setYearly(true)}
        >
          Yearly <span className="ml-1 text-[7px] text-success">Save 20%</span>
        </Button>
      </div>
      <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-3 items-stretch gap-[13px] max-[820px]:grid-cols-2 max-[520px]:grid-cols-1">
        {PRICING_PLANS.map((plan) => {
          const monthlyPrice = Number(plan.price.replace(/\D/g, ''))
          const displayPrice = yearly && monthlyPrice ? `$${Math.round(monthlyPrice * 0.8)}` : plan.price
          const isFree = plan.name === 'Free'
          const onChoose = () => {
            if (isFree) {
              primaryCta.onClick()
              return
            }
            navigate(`/checkout?plan=${plan.name.toLowerCase()}&billing=${yearly ? 'yearly' : 'monthly'}`)
          }
          return (
            <div
              key={plan.name}
              className={cn(
                'relative flex min-h-[450px] flex-col rounded-xl border border-slate-200 bg-white p-[26px] transition-all duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
                plan.popular && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)),0_18px_44px_rgba(67,56,202,0.1)]',
                !plan.popular && 'max-[820px]:last:col-span-2 max-[820px]:last:mx-auto max-[820px]:last:w-[calc(50%-7px)] max-[520px]:last:col-span-1 max-[520px]:last:w-full'
              )}
            >
              {plan.popular && (
                <span className="absolute right-3.5 top-3.5 flex items-center gap-1 rounded-full bg-primary px-[7px] py-[5px] text-[7px] font-extrabold text-white">
                  <Sparkles size={11} /> Most popular
                </span>
              )}
              <h3 className="font-heading text-[18px] font-extrabold">{plan.name}</h3>
              <p className="min-h-[38px] text-[9px] text-slate-600">{plan.detail}</p>
              <div className="mt-3.5 flex items-baseline">
                <strong className="font-heading text-[36px] font-extrabold tracking-[-0.05em]">{displayPrice}</strong>
                <span className="text-[8px] text-slate-400">{monthlyPrice ? '/month' : 'forever'}</span>
              </div>
              <small className="text-[7px] text-slate-400">{yearly && monthlyPrice ? 'billed annually' : 'billed monthly'}</small>
              <div className="my-6 grid flex-1 content-start gap-2.5 border-t border-slate-200 pt-5">
                {plan.features.map((feature) => (
                  <span key={feature} className="flex items-center gap-[7px] text-[8.5px] text-slate-600">
                    <Check size={13} className="text-success" /> {feature}
                  </span>
                ))}
                {!isFree && (
                  <>
                    <span className="flex items-center gap-[7px] text-[8.5px] text-slate-600">
                      <Check size={13} className="text-success" /> Advanced progress insights
                    </span>
                    <span className="flex items-center gap-[7px] text-[8.5px] text-slate-600">
                      <Check size={13} className="text-success" /> Priority recommendations
                    </span>
                  </>
                )}
              </div>
              <Button variant={plan.popular ? 'default' : 'outline'} onClick={onChoose}>
                {isFree ? primaryCta.label : `Choose ${plan.name}`} <ArrowRight size={14} />
              </Button>
            </div>
          )
        })}
      </div>
    </FadeSection>
  )
}

function FaqSection() {
  const [open, setOpen] = useState(0)
  return (
    <FadeSection id="faq" className="bg-slate-50 py-[100px] max-[520px]:py-[72px]">
      <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-[0.7fr_1.3fr] items-start gap-[75px] max-[820px]:grid-cols-1 max-[820px]:gap-[30px] max-[820px]:text-center">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-primary">Frequently asked questions</span>
          <h2 className="mt-2.5 font-heading text-[30px] font-extrabold">Everything you need to know before you begin.</h2>
          <p className="text-[10px] text-slate-600">Still deciding? Start with the free plan and explore the full workflow at your own pace.</p>
        </div>
        <div className="grid">
          {FAQS.map((faq, index) => (
            <div key={faq.question} className="border-b border-slate-200">
              <button
                type="button"
                className="flex min-h-[61px] w-full items-center justify-between gap-2 text-left text-[11px] font-medium"
                onClick={() => setOpen(open === index ? -1 : index)}
                aria-expanded={open === index}
              >
                {faq.question}
                <ChevronDown size={17} className={cn('shrink-0 transition-transform duration-200', open === index && 'rotate-180')} />
              </button>
              {open === index && <p className="-mt-1.5 mb-[18px] pr-[30px] text-[9px] text-slate-600">{faq.answer}</p>}
            </div>
          ))}
        </div>
      </div>
    </FadeSection>
  )
}

function MarketingFooter({ goTo, navigate }: { goTo: (id: string) => void; navigate: (path: string) => void }) {
  return (
    <footer className="bg-white pt-[65px]">
      <div className="mx-auto grid w-[min(calc(100%-48px),1180px)] grid-cols-[2fr_repeat(4,1fr)] gap-[35px] pb-[50px] max-[820px]:grid-cols-[2fr_repeat(2,1fr)] max-[520px]:grid-cols-2">
        <div className="max-[820px]:col-span-3 max-[520px]:col-span-2">
          <Link to="/">
            <Logo />
          </Link>
          <p className="my-[15px] max-w-[280px] text-[9px] text-slate-600">
            Prepare smarter. Apply with confidence. Never guess where you stand.
          </p>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="HireLoom community">
              <Globe size={17} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Share HireLoom">
              <Share2 size={17} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="HireLoom videos">
              <CirclePlay size={18} />
            </Button>
          </div>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="grid content-start">
            <strong className="mb-2.5 text-[9px]">{column.title}</strong>
            {column.links.map((link) =>
              SCROLL_LINKS.includes(link) ? (
                <Button
                  key={link}
                  variant="ghost"
                  className="min-h-[31px] justify-start p-0 text-[8px] text-slate-400 hover:bg-transparent hover:text-slate-900"
                  onClick={() => goTo(link.toLowerCase().replace(/ /g, '-'))}
                >
                  {link}
                </Button>
              ) : (
                <Link
                  key={link}
                  to={FOOTER_PATHS[link] ?? '/'}
                  className="flex min-h-[31px] items-center text-[8px] text-slate-400 hover:text-slate-900"
                >
                  {link}
                </Link>
              )
            )}
          </div>
        ))}
      </div>
      <div className="mx-auto flex min-h-[58px] w-[min(calc(100%-48px),1180px)] items-center justify-between border-t border-slate-200 text-[8px] text-slate-400">
        <span>© 2026 HireLoom, Inc. All rights reserved.</span>
        <Button variant="ghost" className="text-[8px] text-slate-400 hover:text-slate-900" onClick={() => navigate('/login')}>
          Sign in
        </Button>
      </div>
    </footer>
  )
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto mb-[45px] w-[min(calc(100%-48px),1180px)] max-w-[690px] text-center max-[520px]:mb-8">
      <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-primary">{eyebrow}</span>
      <h2 className="mt-2.5 font-heading text-[35px] font-extrabold leading-[1.2] max-[520px]:text-[29px]">{title}</h2>
      <p className="mx-auto mt-[11px] max-w-[620px] text-[12px] text-slate-600">{description}</p>
    </div>
  )
}

function FadeSection({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (prefersReducedMotion()) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      id={id}
      className={cn(
        'opacity-0 translate-y-[18px] transition-[opacity,transform] duration-700 ease-out motion-reduce:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none',
        visible && 'opacity-100 translate-y-0',
        className
      )}
    >
      {children}
    </section>
  )
}

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [count, setCount] = useState(() => (prefersReducedMotion() ? value : 0))

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCount(value)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        let start = 0
        const duration = 800
        const tick = (time: number) => {
          if (!start) start = time
          const progress = Math.min((time - start) / duration, 1)
          setCount(Math.round(value * progress))
          if (progress < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        observer.disconnect()
      },
      { threshold: 0.5 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [value])

  return <span ref={ref}>{count}</span>
}

function AnimatedConicRing({
  value,
  size,
  suffix = '',
  displayValue,
}: {
  value: number
  size: number
  suffix?: string
  displayValue?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0))

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        let start = 0
        const tick = (time: number) => {
          if (!start) start = time
          const progress = Math.min((time - start) / 700, 1)
          setDisplay(value * progress)
          if (progress < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        observer.disconnect()
      },
      { threshold: 0.4 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [value])

  const shown = displayValue != null ? (display / value) * displayValue : Math.round(display)

  return (
    <div ref={ref}>
      <ConicRing value={display} size={size} toneClassName={scoreToneClass(getScoreTone(value))}>
        <span className="font-heading font-extrabold text-slate-900" style={{ fontSize: size * 0.24 }}>
          {displayValue != null ? shown.toFixed(1) : shown}
          {suffix && <span className="text-slate-400" style={{ fontSize: size * 0.16 }}>{suffix}</span>}
        </span>
      </ConicRing>
    </div>
  )
}
