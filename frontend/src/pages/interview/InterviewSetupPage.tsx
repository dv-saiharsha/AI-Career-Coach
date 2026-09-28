import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Clock3, Sparkles, Target } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConicRing } from '@/components/shared/ConicRing'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'
import { interviewService } from '@/services/interviewService'
import { ExperienceLevel } from '@/types'
import { CATEGORY_LABELS, PREP_CATEGORIES, PrepCategory, InterviewHistoryItemSchema } from '@/types/interview'
import { useDashboardHome } from '@/hooks/useDashboardHome'
import { toast } from 'sonner'
import { HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'

const CUSTOM_ROLE_OPTION = 'Other / Custom'

const ROLE_OPTIONS = [
  'AI Engineer',
  'ML Engineer',
  'Data Scientist',
  'Software Engineer',
  'Data Analyst',
  CUSTOM_ROLE_OPTION,
]

const EXPERIENCE_LEVELS: ExperienceLevel[] = ['Entry Level', 'Mid Level', 'Senior', 'Lead']

function isPrepCategory(value: string | null): value is PrepCategory {
  return !!value && (PREP_CATEGORIES as string[]).includes(value)
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

function scoreTone(score: number): 'success' | 'warning' | 'primary' {
  if (score >= 8) return 'success'
  if (score >= 6) return 'primary'
  return 'warning'
}

export function InterviewSetupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: dashboard } = useDashboardHome()

  const [roleChoice, setRoleChoice] = useState(ROLE_OPTIONS[0])
  const [customRole, setCustomRole] = useState('')
  const [category, setCategory] = useState<PrepCategory>('behavioral')
  const [seniority, setSeniority] = useState<ExperienceLevel>('Mid Level')
  const [isStarting, setIsStarting] = useState(false)

  const [history, setHistory] = useState<InterviewHistoryItemSchema[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // Auto-select role/category when arriving from another module (Resume
  // Analyzer's "Practice this role" link, or a report's "Practice this
  // category again" next action).
  useEffect(() => {
    const roleParam = searchParams.get('role')
    if (roleParam) {
      setRoleChoice(ROLE_OPTIONS.includes(roleParam) ? roleParam : CUSTOM_ROLE_OPTION)
      if (!ROLE_OPTIONS.includes(roleParam)) setCustomRole(roleParam)
    }
    const categoryParam = searchParams.get('category')
    if (isPrepCategory(categoryParam)) {
      setCategory(categoryParam)
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    interviewService
      .getHistory()
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resolvedRole = roleChoice === CUSTOM_ROLE_OPTION ? customRole.trim() : roleChoice

  const handleStartInterview = async () => {
    if (!resolvedRole) {
      toast.error('Enter the role you want to practice for.')
      return
    }

    setIsStarting(true)
    try {
      const session = await interviewService.createSession(resolvedRole, seniority, category)
      toast.success(`${session.questions.length} question${session.questions.length === 1 ? '' : 's'} ready for ${session.role}`)
      navigate(`/interview/session?id=${session.session_id}`, { state: { session } })
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not start the interview session. Please try again.')
      setIsStarting(false)
    }
  }

  const openHistoryItem = (item: InterviewHistoryItemSchema) => {
    if (item.status === 'completed') navigate(`/interview/feedback?id=${item.id}`)
    else navigate('/interview/session')
  }

  const interviewAverage = dashboard?.interview.average_score ?? null
  const recommendedActions = (dashboard?.next_actions ?? []).filter((a) => a.href.includes('interview')).slice(0, 2)

  return (
    <div className="grid gap-[18px]">
      {/* Hero */}
      <div className="relative min-h-[150px] overflow-hidden rounded-lg bg-[linear-gradient(120deg,#312e81,hsl(var(--primary)))] px-8 py-7 text-white">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-lg">
            <AiBadge label="AI interview coach" />
            <h2 className="mt-[10px] font-heading text-[26px] font-bold leading-tight">
              Practice with purpose, not guesswork.
            </h2>
            <p className="mt-[5px] text-[11px] text-[#c7d2fe]">
              Every session adapts to your resume, target roles, and past performance.
            </p>
          </div>
          <div className="flex min-w-[220px] items-center gap-[13px] rounded-[11px] border border-white/[0.16] bg-white/10 p-[13px] backdrop-blur-sm">
            <ConicRing
              value={interviewAverage != null ? interviewAverage * 10 : 0}
              size={72}
              toneClassName={scoreToneClass(getScoreTone(interviewAverage, 10))}
              holeClassName="bg-primary"
            >
              <span className="font-heading text-sm font-extrabold text-white">
                {interviewAverage != null ? interviewAverage.toFixed(1) : '—'}
                <small className="text-[9px] font-medium text-white/70">/10</small>
              </span>
            </ConicRing>
            <div>
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#c7d2fe]">
                Interview average
              </span>
              <strong className="mt-1 block text-[10px] font-bold">
                {dashboard ? `${dashboard.interview.completed_sessions} sessions completed` : '—'}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[1.15fr_0.85fr]">
        {/* Session setup */}
        <Card className="grid gap-[17px] p-[21px]">
          <div className="flex items-center gap-[11px]">
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-secondary text-primary">
              <Target size={19} />
            </span>
            <div>
              <h3 className="text-[16px] font-bold text-foreground">Start a practice session</h3>
              <p className="mt-[3px] text-[9px] text-muted-foreground">Build a focused session for your next conversation.</p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-[13px] font-semibold text-foreground">Target role</Label>
            <select
              className="h-11 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground"
              value={roleChoice}
              onChange={(e) => setRoleChoice(e.target.value)}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {roleChoice === CUSTOM_ROLE_OPTION && (
              <Input
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder="e.g. Platform Engineer"
              />
            )}
          </div>

          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-foreground">Interview type</span>
            <div className="flex flex-wrap gap-[7px]">
              {PREP_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  title={CATEGORY_LABELS[cat]}
                  className={cn(
                    'rounded-md border px-[7px] py-2 text-[10px] font-bold transition-colors',
                    category === cat ? 'border-primary bg-secondary text-primary' : 'border-border text-muted-foreground'
                  )}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-[13px] font-semibold text-foreground">Experience level</Label>
            <select
              className="h-11 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground"
              value={seniority}
              onChange={(e) => setSeniority(e.target.value as ExperienceLevel)}
            >
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-[13px] rounded-lg bg-background p-[10px] text-[8px] text-muted-foreground">
            <span className="flex items-center gap-[5px]">
              <Target size={13} className="text-primary" /> Adaptive questions
            </span>
            <span className="flex items-center gap-[5px]">
              <Clock3 size={13} className="text-primary" /> Scored as you go
            </span>
            <span className="flex items-center gap-[5px]">
              <Sparkles size={13} className="text-primary" /> Instant AI feedback
            </span>
          </div>

          <Button className="w-full" onClick={handleStartInterview} disabled={isStarting}>
            {isStarting ? 'Preparing…' : 'Start practice session'} <ArrowRight size={16} />
          </Button>
        </Card>

        {/* Recommended */}
        <div className="grid gap-[10px] self-start">
          <div>
            <AiBadge label="AI recommended" />
            <h3 className="mt-[7px] text-[16px] font-bold text-foreground">Recommended for you</h3>
          </div>
          {recommendedActions.length > 0 ? (
            recommendedActions.map((action, index) => (
              <Card key={action.key} className="grid grid-cols-[38px_1fr_auto] items-center gap-[11px] p-[14px]">
                <span
                  className={cn(
                    'grid h-[38px] w-[38px] place-items-center rounded-[10px]',
                    index === 1 ? 'bg-coral-tint text-coral' : 'bg-secondary text-primary'
                  )}
                >
                  <Sparkles size={18} />
                </span>
                <div className="min-w-0">
                  <span className="mb-1 block text-[8px] font-bold uppercase tracking-[0.05em] text-coral">
                    {action.priority}
                  </span>
                  <h3 className="truncate text-[11px] font-semibold text-foreground">{action.label}</h3>
                  <p className="mt-[3px] truncate text-[8px] text-muted-foreground">{action.description}</p>
                </div>
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => navigate(action.href)}>
                  <ArrowRight size={16} />
                </Button>
              </Card>
            ))
          ) : (
            <Card className="p-[14px] text-[11px] text-muted-foreground">
              Complete a few sessions to see personalized recommendations here.
            </Card>
          )}
        </div>
      </div>

      <Card className="p-[19px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[16px] font-bold text-foreground">Past sessions</h3>
            <p className="mt-[3px] text-[9px] text-muted-foreground">Review feedback and track your progress over time.</p>
          </div>
        </div>
        <div className="mt-[11px] grid">
          {historyLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No practice sessions yet — start one above.</p>
          ) : (
            history.slice(0, 6).map((item) => (
              <button
                key={item.id}
                onClick={() => openHistoryItem(item)}
                className="grid min-h-[58px] grid-cols-[38px_1fr_auto_20px] items-center gap-[9px] border-t border-border text-left first:border-t-0"
              >
                <span className="grid h-[33px] w-[33px] place-items-center rounded-[9px] bg-foreground font-heading text-[13px] font-extrabold text-background">
                  {item.role.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-[10px] text-foreground">{item.role}</strong>
                  <small className="mt-[3px] block text-[8px] text-muted-foreground">
                    {CATEGORY_LABELS[item.category ?? 'behavioral']} &middot;{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </small>
                </span>
                {item.average_score != null ? (
                  <span
                    className={cn(
                      'whitespace-nowrap rounded-full px-[7px] py-[3px] text-[9px] font-bold',
                      scoreTone(item.average_score) === 'success' && 'bg-success-tint text-success',
                      scoreTone(item.average_score) === 'primary' && 'bg-secondary text-primary',
                      scoreTone(item.average_score) === 'warning' && 'bg-warning-tint text-warning'
                    )}
                  >
                    {item.average_score.toFixed(1)}/10
                  </span>
                ) : (
                  <span className="whitespace-nowrap rounded-full bg-secondary px-[7px] py-[3px] text-[9px] font-bold text-muted-foreground">
                    In progress
                  </span>
                )}
                <ArrowRight size={16} className="text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
