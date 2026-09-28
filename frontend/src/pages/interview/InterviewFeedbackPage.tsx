import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronDown, RotateCcw, Sparkles } from 'lucide-react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConicRing } from '@/components/shared/ConicRing'
import { interviewService } from '@/services/interviewService'
import { CATEGORY_LABELS, SessionReportSchema, humanizeKey, scoreToPercent } from '@/types/interview'
import { HttpError } from '@/lib/http'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import confetti from 'canvas-confetti'

const READINESS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  EXCELLENT: 'success',
  STRONG: 'success',
  GOOD: 'neutral',
  'NEEDS WORK': 'warning',
  WEAK: 'warning',
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'neutral'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full px-[7px] py-1 text-[9px] font-bold',
        tone === 'success' && 'bg-success-tint text-success',
        tone === 'warning' && 'bg-warning-tint text-warning',
        tone === 'neutral' && 'bg-secondary text-secondary-foreground'
      )}
    >
      {children}
    </span>
  )
}

export function InterviewFeedbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionIdParam = searchParams.get('id')

  const [report, setReport] = useState<SessionReportSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; status?: number } | null>(null)
  const [openQuestion, setOpenQuestion] = useState<number | null>(0)

  useEffect(() => {
    const sessionId = sessionIdParam ? Number(sessionIdParam) : NaN
    if (!sessionIdParam || Number.isNaN(sessionId)) {
      setError({ message: 'No completed interview to show.' })
      setLoading(false)
      return
    }

    let cancelled = false
    interviewService
      .getSessionReport(sessionId)
      .then((data) => {
        if (cancelled) return
        setReport(data)
        try {
          confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } })
        } catch {
          // ignore — celebratory confetti is non-critical
        }
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof HttpError ? err.message : 'Could not load your interview report.'
        setError({ message, status: err instanceof HttpError ? err.response.status : undefined })
        toast.error(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionIdParam])

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Building your report...</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    const stillInProgress = error?.status === 400
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-10 text-center">
        <h2 className="text-lg font-bold text-foreground">
          {stillInProgress ? 'This interview is still in progress' : 'Report unavailable'}
        </h2>
        <p className="text-xs text-muted-foreground">{error?.message || 'Something went wrong loading this report.'}</p>
        {stillInProgress ? (
          <Button onClick={() => navigate(`/interview/session?id=${sessionIdParam}`)} className="gap-2">
            Resume interview <ArrowRight size={16} />
          </Button>
        ) : (
          <Button onClick={() => navigate('/interview/setup')} className="gap-2">
            Start a new interview <ArrowRight size={16} />
          </Button>
        )}
      </Card>
    )
  }

  const overallPercent = scoreToPercent(report.overall_score)
  const readinessTone = READINESS_TONE[report.readiness_band] ?? 'neutral'
  const radarData = report.category_performance.map((dim) => ({ dimension: dim.label, score: scoreToPercent(dim.average_score) }))

  // Voice-only signals (filler words, speaking pace) never populate for a
  // typed-answer session — none of these 3 pages ever call /interview/transcribe.
  // Shown only if a real number exists; otherwise an honest note, not a fake stat.
  const fillerCounts = report.question_feedback
    .map((qf) => qf.voice_metrics?.filler_word_count)
    .filter((n): n is number => typeof n === 'number')
  const totalFillerWords = fillerCounts.length > 0 ? fillerCounts.reduce((a, b) => a + b, 0) : null

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-[20px]">
        <div>
          <Button variant="ghost" size="sm" className="h-auto gap-1.5 p-0 text-muted-foreground" onClick={() => navigate('/interview/setup')}>
            <ArrowRight size={14} className="rotate-180" /> Interview Coach
          </Button>
          <h2 className="mt-1 font-heading text-2xl font-bold text-foreground">Practice feedback report</h2>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {CATEGORY_LABELS[report.category]} practice &middot; {report.role} &middot; {report.seniority}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate(`/interview/setup?category=${report.category}`)}>
            <RotateCcw size={15} /> Practice this category again
          </Button>
          <Button onClick={() => navigate('/jobs')}>
            See matching jobs <ArrowRight size={15} />
          </Button>
        </div>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-[22px]">
          <AiBadge label="AI feedback" />
          <div className="mt-[9px] grid grid-cols-[100px_1fr] items-center gap-[18px]">
            <ConicRing value={overallPercent} size={88} toneClassName={scoreToneClass(getScoreTone(overallPercent))}>
              <span className="font-heading text-xl font-extrabold text-foreground">
                {report.overall_score.toFixed(1)}
                <small className="text-[10px] text-muted-foreground">/10</small>
              </span>
            </ConicRing>
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold text-foreground">{report.readiness_band}</h3>
              <p className="mt-[5px] text-[9px] text-muted-foreground">{report.performance_summary}</p>
            </div>
          </div>
        </Card>

        <Card className="grid grid-cols-1 gap-4 p-[18px] sm:grid-cols-[170px_1fr] sm:items-center sm:gap-0">
          <div>
            <h3 className="text-[14px] font-bold text-foreground">Performance breakdown</h3>
            <p className="mt-1 text-[8px] text-muted-foreground">Scores across seven evaluation dimensions.</p>
          </div>
          {radarData.length > 0 ? (
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="70%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} />
                  <Radar dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.18} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">Not enough answered questions to chart yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[1fr_290px]">
        <Card className="p-[19px]">
          <h3 className="text-[15px] font-bold text-foreground">Question-by-question feedback</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Open each answer for specific coaching and a stronger example.</p>
          <div className="mt-3 grid gap-2">
            {report.question_feedback.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No answered questions to review.</p>
            )}
            {report.question_feedback.map((qf, index) => {
              const isOpen = openQuestion === index
              const qFillers = qf.voice_metrics?.filler_word_count
              return (
                <Card key={qf.question_id} className={cn('overflow-hidden p-0', isOpen && 'border-primary/30')}>
                  <button
                    onClick={() => setOpenQuestion(isOpen ? null : index)}
                    className="grid min-h-[65px] w-full grid-cols-[30px_1fr_auto_20px] items-center gap-3 px-3.5 text-left"
                  >
                    <span className="font-heading text-[9px] font-extrabold text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-[10px] text-foreground">{qf.question_text}</strong>
                      <small className="mt-[3px] block text-[8px] text-muted-foreground">{CATEGORY_LABELS[report.category]}</small>
                    </div>
                    <Badge variant={scoreToPercent(qf.score) >= 70 ? 'success' : 'warning'} className="text-[10px]">
                      {qf.score.toFixed(1)}/10
                    </Badge>
                    <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="grid gap-2.5 px-3.5 pb-3.5">
                      <div className="rounded-lg bg-secondary p-2.5">
                        <span className="text-[8px] font-bold uppercase text-muted-foreground">Your answer</span>
                        <p className="mt-1 text-[11px] text-foreground">&ldquo;{qf.answer_text}&rdquo;</p>
                        {typeof qFillers === 'number' && (
                          <small className="mt-1 block text-[9px] text-warning">{qFillers} filler words detected</small>
                        )}
                      </div>
                      {qf.weaknesses.length > 0 && (
                        <div className="rounded-lg border-l-[3px] border-l-coral bg-coral-tint p-2.5">
                          <span className="flex items-center gap-1 text-[8px] font-bold uppercase text-coral-foreground">
                            <Sparkles size={10} /> AI feedback
                          </span>
                          <p className="mt-1 text-[11px] text-foreground">{qf.weaknesses[0]}</p>
                        </div>
                      )}
                      {qf.sample_answer && (
                        <div className="flex gap-2 rounded-lg bg-secondary p-2.5">
                          <BookOpen size={14} className="mt-0.5 shrink-0 text-primary" />
                          <div>
                            <strong className="text-[11px] text-foreground">Stronger sample answer</strong>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">&ldquo;{qf.sample_answer}&rdquo;</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        </Card>

        <div className="grid gap-3 self-start">
          <Card className="p-[18px]">
            <AiBadge label="Next focus" />
            <h3 className="mt-[9px] text-[16px] font-bold text-foreground">
              {report.weakest_skills[0] ? `Sharpen your ${report.weakest_skills[0].toLowerCase()}` : 'Keep practicing'}
            </h3>
            <p className="mt-1 text-[9px] text-muted-foreground">
              {report.practice_plan[0] ?? 'Review your weakest dimension and try another session in this category.'}
            </p>
            <Button className="mt-2.5 w-full" onClick={() => navigate(`/interview/setup?category=${report.category}`)}>
              Practice this skill <ArrowRight size={15} />
            </Button>
          </Card>

          <Card className="p-[18px]">
            <h3 className="text-[13px] font-bold text-foreground">Session signals</h3>
            <div className="mt-[10px] grid text-[9px]">
              <div className="flex justify-between py-[10px]">
                <span className="text-muted-foreground">Questions answered</span>
                <strong className="font-heading text-foreground">{report.question_feedback.length}</strong>
              </div>
              <div className="flex justify-between border-t border-border py-[10px]">
                <span className="text-muted-foreground">Strongest skill</span>
                <strong className="font-heading text-foreground">{report.strongest_skills[0] ?? '—'}</strong>
              </div>
              <div className="flex justify-between border-t border-border py-[10px]">
                <span className="text-muted-foreground">Readiness</span>
                <StatusPill tone={readinessTone}>{report.readiness_band}</StatusPill>
              </div>
              {totalFillerWords != null ? (
                <div className="flex justify-between border-t border-border py-[10px]">
                  <span className="text-muted-foreground">Filler words</span>
                  <strong className="font-heading text-foreground">{totalFillerWords}</strong>
                </div>
              ) : (
                <p className="border-t border-border py-[10px] text-[9px] text-muted-foreground">
                  Filler-word and pacing signals appear here for voice-recorded sessions.
                </p>
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <Link to="/progress" className="text-center text-[11px] font-bold text-primary">
              View Progress Dashboard
            </Link>
            <Link to="/dashboard" className="text-center text-[11px] text-muted-foreground">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
