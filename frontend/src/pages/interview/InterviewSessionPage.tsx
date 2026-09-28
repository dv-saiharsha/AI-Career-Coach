import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Square,
  Video,
  VideoOff,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/AuthContext'
import { interviewService } from '@/services/interviewService'
import {
  ActiveQuestionSchema,
  ActiveSessionSchema,
  FeedbackSchema,
  ModelAnswerSchema,
  QuestionsResponseSchema,
  CATEGORY_LABELS,
  activeSessionFromQuestions,
  humanizeKey,
  scoreToPercent,
} from '@/types/interview'
import { toast } from 'sonner'
import { HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

export function InterviewSessionPage() {
  const navigate = useNavigate()
  useSearchParams()
  const location = useLocation()
  const { user } = useAuth()

  const [session, setSession] = useState<ActiveSessionSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [userAnswer, setUserAnswer] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentEvaluation, setCurrentEvaluation] = useState<FeedbackSchema | null>(null)
  const [modelAnswer, setModelAnswer] = useState<ModelAnswerSchema | null>(null)
  const [isLoadingModelAnswer, setIsLoadingModelAnswer] = useState(false)

  // Camera/mic are visual-only, same as the Figma source's own reference
  // implementation (it never called getUserMedia either) — there is no real
  // audio/video capture anywhere in this backend yet. Kept as a preview of
  // the planned live-session experience while that's still in development;
  // every score/evaluation below them is real.
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    let cancelled = false

    function settle(active: ActiveSessionSchema) {
      const firstUnanswered = active.questions.findIndex((q) => !q.answer)
      if (firstUnanswered === -1) {
        // Every question already has an answer — the session already
        // completed server-side (this only happens on a stale reload).
        navigate(`/interview/feedback?id=${active.session_id}`, { replace: true })
        return
      }
      setSession(active)
      setCurrentIndex(firstUnanswered)
    }

    async function load() {
      setLoading(true)
      try {
        // The server is authoritative: resuming is just re-fetching whatever
        // it still has in progress, since every answer was already
        // persisted the moment it was submitted.
        const active = await interviewService.getActiveSession()
        if (cancelled) return
        if (active) {
          settle(active)
          return
        }

        // No in-progress session server-side. Only fall back to a session
        // InterviewSetupPage just created (handed via navigation state) —
        // never silently spin up an unrelated new one.
        const navSession = (location.state as { session?: QuestionsResponseSchema } | null)?.session
        if (navSession) {
          settle(activeSessionFromQuestions(navSession))
          return
        }

        toast.error('No interview in progress. Start a new one.')
        navigate('/interview/setup', { replace: true })
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof HttpError ? err.message : 'Could not load your interview session.')
          navigate('/interview/setup', { replace: true })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // Intentionally run once on mount — session state afterwards is managed
    // locally from evaluate responses, not by re-polling this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Session-elapsed clock — a real timer, just not tied to any actual
  // recording (there is none). Runs continuously once a session is loaded.
  useEffect(() => {
    if (loading || !session) return
    const interval = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(interval)
  }, [loading, session])

  if (loading || !session) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading your interview...' : 'Preparing interview simulator...'}
          </p>
        </div>
      </div>
    )
  }

  const currentQ: ActiveQuestionSchema = session.questions[currentIndex]
  const isLastQuestion = currentIndex >= session.questions.length - 1
  const wordCount = userAnswer.trim() ? userAnswer.trim().split(/\s+/).length : 0
  const progressValue = ((currentIndex + (currentEvaluation ? 1 : 0)) / session.questions.length) * 100

  const handleSubmitAnswer = async () => {
    if (!userAnswer.trim()) {
      toast.error('Please type your response before submitting.')
      return
    }

    setIsSubmitting(true)
    try {
      const feedback = await interviewService.evaluateAnswer({
        question_id: currentQ.id,
        answer_text: userAnswer,
      })
      setCurrentEvaluation(feedback)
      toast.success('Evaluation complete.')
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Evaluation failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleNextQuestion = () => {
    if (!currentEvaluation) return
    const nextIndex = currentIndex + 1
    if (nextIndex >= session.questions.length) {
      // The last answer just submitted completes the session server-side.
      navigate(`/interview/feedback?id=${session.session_id}`)
      return
    }
    const updatedQuestions = session.questions.map((q, i) =>
      i === currentIndex ? { ...q, answer: { ...currentEvaluation, answer_text: userAnswer } } : q
    )
    setSession({ ...session, questions: updatedQuestions })
    setCurrentIndex(nextIndex)
    setUserAnswer('')
    setCurrentEvaluation(null)
    setModelAnswer(null)
  }

  const handleRestart = async () => {
    if (!window.confirm('Restart this interview? Your current progress will be abandoned (still visible in history).')) return
    try {
      await interviewService.abandonSession(session.session_id)
    } catch {
      // Non-fatal — proceed to setup regardless, a fresh POST /questions
      // abandons any stale in-progress session anyway.
    }
    navigate('/interview/setup')
  }

  const handleEndSession = () => {
    if (window.confirm('Are you sure you want to save and exit this session?')) {
      navigate('/dashboard')
    }
  }

  const handleShowModelAnswer = async () => {
    if (modelAnswer || isLoadingModelAnswer) return
    setIsLoadingModelAnswer(true)
    try {
      const answer = await interviewService.getModelAnswer(currentQ.id)
      setModelAnswer(answer)
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not load a model answer right now.')
    } finally {
      setIsLoadingModelAnswer(false)
    }
  }

  const dimensionEntries = Object.entries(currentEvaluation?.dimension_scores || {})

  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`
  const initials = (user?.fullName || user?.email || '?')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  // Real transcript — built from the actual questions asked and the actual
  // answers already submitted this session, not scripted dialogue.
  const transcript: { speaker: 'Coach' | 'You'; text: string }[] = []
  for (let i = 0; i <= currentIndex; i++) {
    const q = session.questions[i]
    transcript.push({ speaker: 'Coach', text: q.text })
    const answerText = i < currentIndex ? q.answer?.answer_text : i === currentIndex ? currentEvaluation && userAnswer : null
    if (answerText) transcript.push({ speaker: 'You', text: answerText })
  }

  return (
    <div className="grid gap-[18px]">
      {/* Header */}
      <div className="flex h-[68px] flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-[22px]">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleRestart} title="Restart">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <strong className="block text-[10px] font-bold text-foreground">
              {session.role} &middot; {CATEGORY_LABELS[session.category]} practice
            </strong>
            <small className="text-[8px] text-muted-foreground">{session.seniority}</small>
          </div>
        </div>
        <div className="hidden items-center gap-[7px] sm:flex">
          <i className="h-[7px] w-[7px] rounded-full bg-destructive shadow-[0_0_0_4px_#fee2e2]" />
          <span className="text-[9px] text-muted-foreground">
            Recording <strong className="font-heading text-foreground">{elapsedLabel}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRestart}>
            <RotateCcw size={14} /> Restart
          </Button>
          <Button variant="outline" onClick={handleEndSession}>
            <Square size={14} /> End session
          </Button>
        </div>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="grid gap-3">
          <Card className="px-[22px] py-[20px]">
            <div className="flex items-center justify-between text-muted-foreground">
              <AiBadge label="AI interviewer" />
              <span className="text-[9px]">
                Question {currentIndex + 1} of {session.questions.length}
              </span>
            </div>
            <div className="my-[13px] h-1 overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <h2 className="max-w-[780px] font-heading text-[22px] font-bold leading-[1.35] text-foreground">
              {currentQ.text}
            </h2>
            <p className="mt-[7px] text-[10px] text-muted-foreground">
              Answer in your own words — you&rsquo;ll get a full rubric breakdown right after submitting.
            </p>

            {!currentEvaluation && (
              <div className="mt-4 grid gap-2">
                <Textarea
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="Structure your answer here..."
                  rows={8}
                  disabled={isSubmitting}
                  className="text-sm leading-relaxed"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {wordCount} words {wordCount > 60 && '· Good length'}
                  </span>
                  <Button onClick={handleSubmitAnswer} disabled={isSubmitting || !userAnswer.trim()} size="sm">
                    {isSubmitting ? 'Analyzing…' : 'Submit answer'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Camera stage — visual preview only (no real capture backs this
              yet; see the comment on cameraOn/micOn above). */}
          <Card className="overflow-hidden p-0">
            <div className="relative grid min-h-[375px] place-items-center overflow-hidden rounded-t-[12px] bg-[linear-gradient(145deg,#20253b,#111827)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.12]"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.12) 1px, transparent 1px)',
                  backgroundSize: '48px 48px',
                }}
              />
              {cameraOn ? (
                <>
                  <span className="relative grid h-[112px] w-[112px] place-items-center rounded-full border-4 border-white/[0.12] bg-gradient-to-br from-[#fde2d9] to-[#f4a28e] font-heading text-[28px] font-extrabold text-[#9a3412] shadow-[0_0_0_7px_rgba(255,255,255,0.04)]">
                    {initials}
                  </span>
                  <div className="absolute bottom-[14px] left-[14px] rounded-md bg-[rgba(15,23,42,0.72)] px-[9px] py-[7px] text-[9px] text-white">
                    {user?.fullName || 'You'}
                    <span className="ml-[7px] inline-flex items-center gap-1 text-[#86efac]">
                      <i className="h-[5px] w-[5px] rounded-full bg-[#22c55e]" /> Live
                    </span>
                  </div>
                </>
              ) : (
                <div className="relative grid justify-items-center gap-2 text-[10px] text-white/60">
                  <VideoOff size={25} />
                  <span>Camera is off</span>
                </div>
              )}
              <div className="absolute bottom-[14px] right-[14px] flex h-[29px] items-center gap-[2px] rounded-md bg-[rgba(15,23,42,0.7)] px-2">
                {[3, 7, 11, 6, 14, 9, 5, 12, 8, 4, 10, 6].map((height, index) => (
                  <span
                    key={index}
                    className={cn('w-[2px] rounded-[2px]', micOn ? 'bg-[#86efac]' : 'bg-white/20')}
                    style={{ height }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 p-3">
              <Button variant={micOn ? 'outline' : 'coral'} size="icon" onClick={() => setMicOn(!micOn)} title="Toggle microphone">
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </Button>
              <Button variant={cameraOn ? 'outline' : 'coral'} size="icon" onClick={() => setCameraOn(!cameraOn)} title="Toggle camera">
                {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
              </Button>
              <span className="ml-2 text-[10px] text-muted-foreground">Live video practice — coming soon</span>
            </div>
          </Card>

          {currentEvaluation && (
            <Card className="p-[19px]">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  <Sparkles size={15} className="text-primary" /> AI evaluation
                </span>
                <Badge variant="subtle">{scoreToPercent(currentEvaluation.score)}%</Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-secondary p-2.5 text-center">
                  <span className="block text-[8px] font-bold uppercase text-muted-foreground">Overall</span>
                  <strong className="font-heading text-lg font-extrabold text-primary">
                    {scoreToPercent(currentEvaluation.score)}%
                  </strong>
                </div>
                {dimensionEntries.map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-background p-2.5 text-center">
                    <span className="block truncate text-[8px] font-bold uppercase text-muted-foreground">
                      {humanizeKey(key)}
                    </span>
                    <strong className="font-heading text-lg font-extrabold text-foreground">{scoreToPercent(value)}%</strong>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-lg border border-success/20 bg-success-tint p-3">
                  <span className="text-[9px] font-bold uppercase text-success">What you did well</span>
                  {currentEvaluation.strengths.length === 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">Nothing standout noted.</p>
                  ) : (
                    <ul className="mt-1 grid gap-1 text-[11px] text-foreground">
                      {currentEvaluation.strengths.map((s, i) => (
                        <li key={i}>&bull; {s}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-warning/20 bg-warning-tint p-3">
                  <span className="text-[9px] font-bold uppercase text-warning">Could be improved</span>
                  {currentEvaluation.weaknesses.length === 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">No notable weaknesses.</p>
                  ) : (
                    <ul className="mt-1 grid gap-1 text-[11px] text-foreground">
                      {currentEvaluation.weaknesses.map((w, i) => (
                        <li key={i}>&bull; {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {currentEvaluation.missing_points.length > 0 && (
                <div className="mt-2.5 rounded-lg border border-border bg-background p-3">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground">What was missing</span>
                  <ul className="mt-1 grid gap-1 text-[11px] text-foreground">
                    {currentEvaluation.missing_points.map((m, i) => (
                      <li key={i}>&bull; {m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {currentEvaluation.sample_answer && (
                <div className="mt-2.5 rounded-lg border border-border bg-background p-3">
                  <span className="text-[9px] font-bold uppercase text-muted-foreground">Improved answer</span>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{currentEvaluation.sample_answer}</p>
                </div>
              )}

              {!modelAnswer ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={handleShowModelAnswer} disabled={isLoadingModelAnswer}>
                  <BookOpen size={13} /> {isLoadingModelAnswer ? 'Loading…' : 'View model answer'}
                </Button>
              ) : (
                <div className="mt-2.5 rounded-lg border border-border bg-background p-3 text-[11px] text-muted-foreground">
                  <p className="mb-1 flex items-center gap-1.5 font-bold text-foreground">
                    <BookOpen size={13} className="text-primary" /> Model answer
                  </p>
                  <p>{modelAnswer.plain_explanation}</p>
                  <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-secondary p-2.5">{modelAnswer.ideal_answer}</p>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-[10px] text-muted-foreground">Score saved to your session history.</span>
                <Button onClick={handleNextQuestion}>
                  {isLastQuestion ? 'Complete interview' : 'Next question'} <ArrowRight size={16} />
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Right: live transcript (real Q&A so far, not scripted) + tip —
            one card, matching Figma's transcript-panel structure. */}
        <Card className="flex min-h-[590px] flex-col self-start p-[18px]">
          <div className="flex items-center justify-between border-b border-border pb-[13px]">
            <span className="flex items-center gap-[7px] text-[13px] font-bold text-foreground">
              <span className="h-[7px] w-[7px] rounded-full bg-success" /> Live transcript
            </span>
            <span className="text-[8px] text-muted-foreground">Auto-saved</span>
          </div>
          <div className="grid flex-1 content-start gap-[15px] overflow-y-auto py-[17px]">
            {transcript.map((line, index) => (
              <div key={index} className="grid grid-cols-[26px_1fr] gap-2">
                <span
                  className={cn(
                    'grid h-[26px] w-[26px] place-items-center rounded-[7px] text-[8px] font-extrabold',
                    line.speaker === 'Coach' ? 'bg-secondary text-primary' : 'bg-coral-tint text-[#9a3412]'
                  )}
                >
                  {line.speaker === 'Coach' ? 'AI' : initials || 'You'}
                </span>
                <div className="min-w-0">
                  <strong className="text-[8px] text-foreground">{line.speaker === 'Coach' ? 'Coach' : 'You'}</strong>
                  <p className="mt-[3px] text-[9px] leading-[1.55] text-muted-foreground">{line.text}</p>
                </div>
              </div>
            ))}
            {isSubmitting && (
              <div className="ml-[35px] flex gap-[3px]">
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex gap-[9px] rounded-lg border border-[#fed7cc] bg-coral-tint p-[11px]">
            <span className="shrink-0 text-coral">
              <Sparkles size={15} />
            </span>
            <p className="text-[8.5px] leading-relaxed text-foreground">
              <strong className="block text-[10px]">Live tip</strong>
              <span className="mt-[3px] block">
                {currentEvaluation?.learning_suggestions[0] ??
                  'Close with the measurable result and what you learned.'}
              </span>
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
