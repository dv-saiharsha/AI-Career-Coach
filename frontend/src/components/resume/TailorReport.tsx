import { AlertTriangle, Check, CircleCheck, CircleX, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type {
  CheckStatus,
  Importance,
  MatchLevel,
  RequirementMatch,
  ScoreChange,
  ScoreSource,
  ShortlistOutlook,
  SmartTailorResult,
} from '@/types/resumeTailor'
import { cn } from '@/lib/utils'

/* The Tailor Resume report: progress while the pipeline runs, then the
   Resume ↔ JD analysis, what changed and why, and the quality checklist.
   Rendered by ResumeMatchPage; every number shown comes from the backend. */

/** What the backend does, in order. One request does all of it, so these are
 *  narrated by elapsed time, not reported by the server — the label says so. */
export const PIPELINE = [
  { label: 'Reading your resume', at: 0 },
  { label: 'Analyzing the job description', at: 2 },
  { label: 'Matching requirements to your evidence', at: 20 },
  { label: 'Rewriting bullets and summary', at: 30 },
  { label: 'Fact-checking every rewrite', at: 75 },
  { label: 'Fitting to one page', at: 90 },
  { label: 'Running quality checks', at: 100 },
]


const IMPORTANCE_ORDER: Importance[] = ['critical', 'high', 'medium', 'low']
const IMPORTANCE_BADGE: Record<Importance, 'high' | 'medium' | 'low' | 'subtle'> = {
  critical: 'high',
  high: 'medium',
  medium: 'subtle',
  low: 'low',
}
const MATCH_META: Record<MatchLevel, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' }> = {
  exact: { label: 'Exact match', variant: 'success' },
  related: { label: 'Strong related', variant: 'info' },
  transferable: { label: 'Transferable', variant: 'warning' },
  missing: { label: 'Missing', variant: 'destructive' },
}

export function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
      {children}
    </span>
  )
}

export function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CircleCheck size={16} className="shrink-0 text-success" />
  if (status === 'warn') return <AlertTriangle size={16} className="shrink-0 text-warning" />
  return <CircleX size={16} className="shrink-0 text-destructive" />
}

/** Landing state when there's no job_id yet — either from Job Portal, or by
 *  pasting a posting's text in directly. Kept as one card with a divider,
 *  matching the same Card/Button/Label language as the rest of this page,
 *  rather than a separate page or a different visual system. */
export function TailorProgress({ elapsed }: { elapsed: number }) {
  const current = PIPELINE.reduce((acc, step, i) => (elapsed >= step.at ? i : acc), 0)
  return (
    <div className="grid w-full max-w-sm gap-2.5" aria-live="polite">
      {PIPELINE.map((step, i) => (
        <div key={step.label} className="flex items-center gap-2.5 text-xs">
          {i < current ? (
            <Check size={14} className="text-success" />
          ) : i === current ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-border" />
          )}
          <span className={cn(i <= current ? 'text-foreground' : 'text-muted-foreground', i === current && 'font-semibold')}>
            {step.label}
          </span>
        </div>
      ))}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {elapsed}s elapsed. This usually takes 1–3 minutes when the AI writer runs locally. Steps are an estimate;
        the server works on all of them in one request.
      </p>
    </div>
  )
}

function RequirementRow({ r }: { r: RequirementMatch }) {
  const meta = MATCH_META[r.match]
  return (
    <div className="grid gap-1 border-t border-border py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">{r.requirement}</span>
        <Badge variant={meta.variant} className="text-[9px]">
          {meta.label}
        </Badge>
        {r.buried && (
          <Badge variant="outline" className="text-[9px]">
            Was buried
          </Badge>
        )}
      </div>
      {r.resume_evidence && r.match !== 'missing' && (
        <p className="text-[11px] text-muted-foreground">
          {r.via && r.match !== 'exact' ? (
            <>
              Shown by <strong className="text-foreground">{r.via}</strong>:{' '}
            </>
          ) : null}
          “{r.resume_evidence}”
        </p>
      )}
      {r.match === 'transferable' && (
        <p className="text-[10px] text-warning">Related experience; not written onto the resume as {r.requirement}.</p>
      )}
    </div>
  )
}

export function AnalysisView({
  result,
  confirmed,
  onToggleConfirmed,
}: {
  result: SmartTailorResult
  /** When given, each gap gets an "I have this" checkbox. */
  confirmed?: Set<string>
  onToggleConfirmed?: (skill: string) => void
}) {
  const a = result.analysis
  const grouped = IMPORTANCE_ORDER.map((imp) => ({
    importance: imp,
    items: a.requirements.filter((r) => r.importance === imp),
  })).filter((g) => g.items.length > 0)
  const missingSkills = a.missing.filter((m) => m.kind === 'skill')

  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <AiBadge label="Hiring intent" />
        <p className="mt-2 text-sm leading-relaxed text-foreground">{a.hiring_intent}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>Strong matches</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {a.strong_matches.length ? (
              a.strong_matches.map((s) => (
                <Badge key={s} variant="success" className="text-[10px]">
                  {s}
                </Badge>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">None of the key requirements are evidenced yet.</p>
            )}
          </div>
          {a.transferable.length > 0 && (
            <>
              <SectionLabel>
                <span className="mt-3 block">Transferable</span>
              </SectionLabel>
              <ul className="grid gap-1 text-[11px] text-muted-foreground">
                {a.transferable.map((t) => (
                  <li key={t.requirement}>
                    <strong className="text-foreground">{t.requirement}</strong> ← your {t.via}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card className="p-4">
          <SectionLabel>Genuine gaps — not added</SectionLabel>
          {missingSkills.length ? (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Your resume shows no evidence of these, so they were left off.
                {onToggleConfirmed && ' If you really have one, tick it and re-run: it will be listed as a skill (never written into a bullet).'}
              </p>
              <div className="grid gap-1.5">
                {missingSkills.map((m) => (
                  <label key={m.requirement} className={cn('flex items-center gap-2 text-xs', onToggleConfirmed && 'cursor-pointer')}>
                    {onToggleConfirmed && (
                      <input
                        type="checkbox"
                        checked={confirmed?.has(m.requirement) ?? false}
                        onChange={() => onToggleConfirmed(m.requirement)}
                        className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      />
                    )}
                    <span className="text-foreground">{m.requirement}</span>
                    <Badge variant={IMPORTANCE_BADGE[m.importance]} className="text-[9px] capitalize">
                      {m.importance}
                    </Badge>
                    {onToggleConfirmed && <span className="text-[10px] text-muted-foreground">I have this</span>}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No skill gaps for this job.</p>
          )}
          {a.missing.filter((m) => m.kind !== 'skill').map((m) => (
            <p key={m.requirement} className="mt-2 text-[11px] text-destructive">
              Not met: {m.requirement}
            </p>
          ))}
        </Card>
      </div>

      <Card className="p-4">
        <SectionLabel>JD keywords</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {a.keywords.map((k) => (
            <span
              key={k.term}
              title={k.supported ? (k.on_resume ? 'On the tailored resume' : 'Supported but not on the page') : 'No evidence — not used'}
              className={cn(
                'rounded-full border px-2 py-[3px] text-[10px] font-semibold',
                k.on_resume
                  ? 'border-success/40 bg-success-tint text-success'
                  : k.supported
                    ? 'border-warning/40 bg-warning-tint text-warning'
                    : 'border-border text-muted-foreground line-through'
              )}
            >
              {k.term}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Green: on your tailored resume. Struck through: the job asks for it, your resume has no evidence, so it was
          not used.
        </p>
        {(a.buried.length > 0 || a.listed_not_shown.length > 0) && (
          <div className="mt-3 grid gap-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
            {a.buried.length > 0 && (
              <p>
                <strong className="text-foreground">Moved up:</strong> {a.buried.join(', ')} — relevant evidence that
                was buried low in your resume.
              </p>
            )}
            {a.listed_not_shown.length > 0 && (
              <p>
                <strong className="text-foreground">Underrepresented:</strong> {a.listed_not_shown.join(', ')} — listed
                in skills, but no bullet shows you using it. Worth adding a real example if you have one.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <SectionLabel>Every requirement, by importance</SectionLabel>
        <div className="grid gap-4">
          {grouped.map((g) => (
            <div key={g.importance}>
              <Badge variant={IMPORTANCE_BADGE[g.importance]} className="mb-1 text-[9px] capitalize">
                {g.importance}
              </Badge>
              {g.items.map((r) => (
                <RequirementRow key={r.key} r={r} />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function ChangesView({ result }: { result: SmartTailorResult }) {
  const t = result.tailoring
  return (
    <div className="grid gap-4">
      {t.ai.note && (
        <Card className="flex items-start gap-2 border-warning/40 p-3 text-xs text-foreground">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" /> {t.ai.note}
        </Card>
      )}
      <Card className="p-4">
        <SectionLabel>What changed and why</SectionLabel>
        <ul className="grid gap-2.5">
          {t.changes.map((c, i) => (
            <li key={i} className="text-xs">
              <p className="font-semibold text-foreground">{c.change}</p>
              <p className="text-[11px] text-muted-foreground">{c.reason}</p>
            </li>
          ))}
        </ul>
      </Card>
      {t.bullet_changes.length > 0 && (
        <Card className="p-4">
          <SectionLabel>Bullet rewrites</SectionLabel>
          <div className="grid">
            {t.bullet_changes.map((c, i) => (
              <div key={i} className="grid gap-1 border-t border-border py-3 first:border-t-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground">{c.entry}</span>
                  <Badge variant={c.status === 'rewritten' ? 'success' : 'warning'} className="text-[9px]">
                    {c.status === 'rewritten' ? 'Applied' : 'Kept original'}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground line-through">{c.original}</p>
                <p className={cn('text-[11px]', c.status === 'rewritten' ? 'text-success' : 'text-muted-foreground')}>
                  {c.tailored}
                </p>
                {c.reasons.length > 0 && (
                  <p className="text-[10px] text-warning">Rejected by the fact check: {c.reasons.join('; ')}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export function QualityView({ result }: { result: SmartTailorResult }) {
  return (
    <Card className="p-4">
      <SectionLabel>Quality validation</SectionLabel>
      <div className="grid">
        {result.validation.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-2.5 border-t border-border py-2.5 first:border-t-0">
            <StatusIcon status={c.status} />
            <div>
              <p className="text-xs font-semibold text-foreground">{c.label}</p>
              <p className="text-[11px] text-muted-foreground">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const OUTLOOK_TONE: Record<ShortlistOutlook['band'], string> = {
  strong: 'border-success text-success',
  competitive: 'border-primary text-primary',
  possible: 'border-warning text-warning',
  long_shot: 'border-destructive text-destructive',
}

/** The shortlist band with what drives it. Never a percentage chance. */
export function OutlookCard({ title, outlook }: { title: string; outlook: ShortlistOutlook }) {
  return (
    <section className={cn('border-l-2 pl-3', OUTLOOK_TONE[outlook.band].split(' ')[0])} aria-label={title}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <p className={cn('mt-1 font-heading text-xl font-bold', OUTLOOK_TONE[outlook.band].split(' ')[1])}>{outlook.label}</p>
      <ul className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground">
        {outlook.drivers.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {outlook.basis === 'coverage_only' && 'Based on requirement coverage only; no ATS score is available. '}
        {outlook.note}
      </p>
    </section>
  )
}

const CHANGE_COPY: Record<ScoreChange['direction'], { text: (d: number) => string; tone: string }> = {
  improved: { text: (d) => `Improved by ${d.toFixed(1)} points`, tone: 'text-success' },
  unchanged: { text: () => 'No meaningful change', tone: 'text-muted-foreground' },
  declined: { text: (d) => `Down ${Math.abs(d).toFixed(1)} points`, tone: 'text-destructive' },
}

/** Original → tailored ATS score for the same job and model, shown as soon
 *  as a draft exists rather than only after saving. */
export function scoreName(source: ScoreSource | null | undefined): string {
  return source === 'keyword_fallback' ? 'Keyword match score' : 'ATS score'
}

export function ScoreComparison({
  before,
  after,
  change,
  afterCaption,
  source,
}: {
  before: number | null
  after: number | null
  change: ScoreChange | null
  afterCaption: string
  source?: ScoreSource | null
}) {
  const fmt = (v: number | null) => (v == null ? 'Unavailable' : `${Math.round(v)}`)
  return (
    <section aria-label="ATS score comparison" className="grid gap-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{scoreName(source)} for this job</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-[11px] text-muted-foreground">Original</p>
          <p className="font-heading text-3xl font-bold tabular-nums text-foreground">{fmt(before)}</p>
        </div>
        <span className="pb-2 text-muted-foreground">→</span>
        <div>
          <p className="text-[11px] text-muted-foreground">Tailored</p>
          <p className={cn('font-heading text-3xl font-bold tabular-nums', change ? CHANGE_COPY[change.direction].tone : 'text-foreground')}>
            {fmt(after)}
          </p>
        </div>
      </div>
      {change && (
        <p className={cn('text-sm font-semibold', CHANGE_COPY[change.direction].tone)}>
          {CHANGE_COPY[change.direction].text(change.delta)}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {before == null || after == null
          ? 'No score could be computed for this job description.'
          : source === 'keyword_fallback'
            ? `${afterCaption} The share of this job's keywords the resume covers; the trained ATS model is not installed on this server.`
            : afterCaption}
      </p>
    </section>
  )
}
