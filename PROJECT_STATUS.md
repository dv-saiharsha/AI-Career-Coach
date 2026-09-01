# Zenith — Project Status

Living record of what has shipped, the architecture decisions behind it, and the
debt carried forward. **Append-only** — new milestone sections go at the top;
previous entries are never removed or rewritten.

**Last updated:** 2026-09-02
**Current phase:** Awaiting approval to begin Milestone 12 — Performance, Security & Production Readiness
**Last completed:** Milestone 11 — Platform Polish & User Experience — 2026-09-02

> **Numbering unified as of 2026-08-27.** This file's milestone numbers now
> match `ROADMAP.md` exactly (1 Resume Studio, 2 AI Resume Review, 3 AI Job
> Matching, 4 AI Interview Preparation, 5 AI Mock Interview…). An earlier
> revision carried two different numbers for the same work, because AI Job
> Matching was built ahead of Interview Preparation while `ROADMAP.md` still
> reflected the original plan's order (where Job Matching was #7). Both files
> now use one number per milestone, permanently — see `ROADMAP.md`'s revision
> history for the full reconciliation.
>
> **Reordered again on 2026-08-28:** AI Career Coach and Voice Interview
> swapped — Career Coach is now permanently #6, Voice Interview #7 — at the
> user's explicit direction, so the orchestration layer exists before a
> second interview modality is added under it.

---

## Architecture baseline

Established before the milestone roadmap; the rows below are unchanged since.
One row added by Milestone 2, then extended by Milestone 3.

| Layer | Choice |
|---|---|
| Frontend | Next.js App Router, near-fully client-rendered; RSC used only for the auth gate |
| Backend | FastAPI, 13 feature modules, `router.py` + `services.py` per module |
| Database | Supabase-hosted Postgres — **schema owned exclusively by Alembic** (24 migrations); `supabase/migrations/` is a deliberate empty placeholder |
| Supabase role | Auth (Google OAuth + email/password) and Storage (avatars) only. The backend connects directly as table owner and never uses PostgREST |
| Auth | Two-layer: `proxy.ts` middleware + `(protected)/layout.tsx` server check; JWKS-first JWT verification with documented HS256 fallback |
| Score vocabulary | One shared band system — EXCELLENT/STRONG/GOOD/NEEDS WORK/WEAK/NOT CHECKED, defined once in `rubric.band()` (backend) and mirrored in `scoreBands.ts` (frontend). `ScoreRing`, Resume Review, and Job Matching all read from it; a new scored feature should too rather than inventing a fourth vocabulary |
| RLS | Enabled with **zero policies** on data tables — deny-by-default defence-in-depth, *not* the primary control. Ownership is enforced in the FastAPI query layer |
| AI | Strict hybrid: the trained `GradientBoostingRegressor` always owns the numeric score; Claude produces qualitative feedback only and is explicitly instructed never to score |
| State | TanStack Query for server state; React Context for auth + command palette; `useState` local. No Redux/Zustand |
| Design | "Porcelain & Obsidian" — no chroma accent, ink is the CTA, WCAG-measured tokens, dark mode via `[data-theme='dark']` |

---

## Milestone 1 — Resume Studio ✅

**Completed:** 2026-08-27
**Status:** Validated and approved

### Summary
Consolidated the resume workflow into one coherent workspace. The `/resume`
route previously did five jobs in one 827-line file and presented two different
"get a new PDF" affordances stacked in a single scroll with no framing to
distinguish them. This milestone split the file along its real seams and turned
that stack into an explicit choice.

### Files modified
- `frontend/src/app/(protected)/resume/page.tsx` — 827 → ~230 lines

### Components created
- `frontend/src/components/resume/ScanUploadForm.tsx`
- `frontend/src/components/resume/ScanningState.tsx`
- `frontend/src/components/resume/ScanResults.tsx`

### Components reused (untouched)
`ResumeBuilderPanel`, `ResumeQualityPanel`, `Waveform`, `AnimatedNumber`,
`useTailorProgress` + `TailorProgressStepper` (via `/resume/tailor`),
`ui/button`, `ui/input`, `ui/textarea`, `usePrefersReducedMotion`,
`jobContext.ts`.

### Architecture decisions

**1. Two PDF paths presented as alternatives, not a sequence.**
`/resume` offered a quick "Tailor my resume" (`POST /generate/{id}` — appends
staged skills to the *original* file, preserving its layout) and, stacked
immediately below it, the entire `ResumeBuilderPanel` (`POST /compile-and-score`
— a from-scratch LaTeX-rendered PDF). These are different products with
different backends. A segmented control now frames them as a choice. This was
the substantive fix; the file split was structural groundwork around it.

**2. Scan progress stays timer-narrated, deliberately.**
`useTailorProgress` argues against scripted progress bars, and it is right — but
that argument assumes a multi-step pipeline exists to report on. `POST /analyze`
is one atomic call with no incremental signal, so a narrated stage list is the
honest option actually available. Giving it real progress requires backend
streaming, which was out of scope. Recorded here so it reads as a conscious
trade-off rather than an oversight.

**3. No aggregation endpoint added.**
Scoped as "maybe" during planning; after reading the code, every piece already
fetches what it needs. This was a layout and navigation problem, not a
data-fetching one.

**4. `/resume/tailor` made discoverable without being modified.**
The split-view workspace was reachable *only* via a query-param handoff from a
job card. A link into `/jobs` now surfaces it from `/resume`. The workspace
itself is the highest-quality UX in the app and was left entirely alone.

### Validation performed
Live browser verification via a temporary unauthenticated preview harness
(deleted after use), plus confirmation that `/resume` still redirects
unauthenticated to `/login?from=%2Fresume`.

- Upload → scan → results flow: works end to end
- Quick tailor ↔ Studio toggle: verified both directions
- Console: clean (only expected `ERR_CONNECTION_REFUSED` with no backend running
  — exercises the pre-existing graceful-degradation path)
- TypeScript, lint, production build: all clean
- Responsive: 1440px / 768px / 375px — no overflow or broken layout
- Themes: light and dark verified at all three breakpoints (6 combinations)
- Keyboard/focus: tab order reaches real controls with correct `aria-label`s;
  `focus-visible` ring renders

### Bugs found and fixed
1. **Magic-number drift risk** — after the split, `page.tsx` hardcoded `4` / `6`
   in place of `STAGES.length` / `FLAVOR_LINES.length`. Fixed by exporting the
   arrays so the two files cannot silently desync.

> **Correction (2026-08-27, post-approval).** The original completion report
> for this milestone claimed the refactor was fully behaviour-preserving and
> that no bugs were found in shipped behaviour. **That was wrong.** A
> subsequent review found two real defects introduced by the split, both since
> fixed in the cleanup pass below. The QA that produced the original claim
> exercised static rendered states but never transitions or toggle
> round-trips, which is precisely where both defects lived. Recorded here
> rather than edited away, because the process failure is the more useful
> lesson than the bugs.

Investigated and dismissed: the ATS score briefly rendered `0/100` in early
screenshots. Root cause was the throwaway test harness stacking three
full-height sections, pushing the score below the fold — `AnimatedNumber`'s
count-up is `IntersectionObserver`-gated. Confirmed correct (74/100) once
scrolled into view. Not reproducible on the real page, where the score is the
first thing visible after a scan.

### Known limitations
- Scan progress is narrated, not measured (see decision 3 above).
- The Studio has no resume **version history** or **version comparison** — both
  named in the product specification for this module, both confirmed unbuilt,
  deliberately not started.
- `/history` has no direct "tailor for this posting" entry point on resume rows.

### Technical debt carried forward
| Item | Why deferred | Target |
|---|---|---|
| `/history` tailor link | That page mixes resume + interview concerns and carries a separately-flagged hardcoded-colour issue; touching it now crosses into unrelated-module territory | M11 |
| Timer-scripted scan progress | Requires backend streaming on `/analyze` | Future |
| Tailwind arbitrary-value lint suggestions on moved animation code (e.g. `w-[104px]`) | Cosmetic, pre-existing, carried over verbatim | M11 |

---

## Milestone 1.5 — Engineering cleanup ✅

**Completed:** 2026-08-27
**Scope:** Milestone 1 files + clear wins; no new features, no redesign.

### Defects fixed (introduced by the Milestone 1 split)

**B1 — Dead exit animations.** The `key` props driving
`<AnimatePresence mode="wait">` were moved inside the extracted components,
where they are inert: `AnimatePresence` reads `child.key` via
`Children.forEach` (chosen deliberately so React does not supply positional
keys), so all three views resolved to `key === ""`, `exitingChildren` was
always empty, and `mode="wait"` never sequenced. Every view transition became
a hard cut. No dev warning fires because that warning requires more than one
rendered child. Fixed by hoisting the keys to the `AnimatePresence` call site,
matching the convention already used in `profile/`, `login/`, and `register/`.

**B2 — Data-loss trap on the build-mode toggle.** `ResumeBuilderPanel` was
conditionally mounted, so Studio → Quick tailor → Studio destroyed roughly a
dozen fields of local form state and re-fired its autofill request. Fixed by
replacing the two bare buttons with Radix `Tabs` using `forceMount`
(`present: forceMount || isSelected`, `hidden: !present`), which keeps both
panels mounted and hides the inactive one. Verified: typed input survives a
full round-trip.

### Also fixed
- **Accessibility (segmented control):** mode was previously signalled only by
  colour — invisible to a screen reader. Radix `Tabs` supplies `role="tab"`,
  `aria-selected`, and arrow-key navigation. Verified in-browser.
- **Accessibility:** `role="alert"` on error banners, `role="status"` on the
  download confirmation, `aria-live="polite"` on the scan progress narration
  (previously silent to AT for several seconds), `aria-busy` on the generating
  button, `aria-hidden` on decorative icons, `aria-labelledby` on the dropzone,
  `htmlFor`/`id` pairing on the job-description field, and `preventDefault` on
  Space so it no longer both activates and scrolls.
- **Inverted dependency removed:** the scan timers, `STAGES`, and
  `FLAVOR_LINES` moved into `ScanProgressPanel`. The page previously imported
  narration constants *out of* a presentational component purely to read
  `.length` for its own intervals. Removed 3 props, 2 effects, 2 state vars.
- **Dead code:** an unreachable ternary (`maxKeywordFreq >= 1`, always true
  because the value is `Math.max(1, …)`) plus the prop and computation that
  existed only to feed it.
- **Duplicate logic:** three union types were duplicated verbatim across files
  — structurally compatible, so TypeScript would never flag a divergence. Now
  owned by `scanShared.ts`. The duplicated `EASE` constant moved there too, and
  the copy-pasted error banner became `InlineError`.
- **Performance:** keyword partitioning went from four `.filter()` passes per
  render to one memoised pass; `ACCEPTED_FILE_TYPES` hoisted to module scope.
- **Naming:** `ScanningState` → `ScanProgressPanel`, `ScanResults` →
  `ScanResultsPanel` (matching the folder's `<Domain><Thing><UI-noun>`
  convention), `onSetFullName`/`onSetResultTab` → `onFullNameChange`/
  `onResultTabChange`, and the one relative component import switched to `@/`.
- **Type safety:** `status: ScanStatus` narrowed to `hasError: boolean` on the
  upload form (it only ever read one value); `selectedSkills` typed
  `ReadonlySet` to make the read-only contract enforceable.

### Reported, deliberately not fixed
- **1,092 Tailwind `-[var(--x)]` instances across 64 files.** The canonical
  `-(--x)` shorthand is equivalent, but converting the 3 files touched here
  would leave them inconsistent with the other 61. This is an all-or-nothing
  codebase-wide decision → M11.
- **Nested interactive controls:** the dropzone is a `role="button"` div
  containing a real `<button>`. Invalid ARIA, but fixing it means restructuring
  the dropzone — a redesign, which this pass excluded.
- **Stale file chip:** dropping an invalid file over a valid one shows the
  error while the previous file stays staged and scannable. Arguably correct
  (the old file *is* still selected), but the banner reads as if nothing is.
  Changing it alters behaviour, so it needs a product call.
- **No scan timeout:** if `/analyze` hangs, the progress narration pins at its
  final stage indefinitely. A timeout is a behaviour change; also relates to
  the deferred streaming work.
- **`genStatus` / `genError` model one state in two props** and can disagree;
  `genStatus === 'error'` is never read. Collapsing them into a discriminated
  union is the right fix but touches the page's state contract.

---

## Milestone 2 — AI Resume Review ✅

**Completed:** 2026-08-27
**Status:** Validated and approved (Phase 1 + Phase 2)

### Summary
Added a categorised, explained review on top of the resume-analysis pipeline —
Resume Health (job-independent), Job Match (job-specific, the trained model's
own score, never blended), and per-category reasoning — surfaced inside the
existing Resume Studio flow rather than as a separate page.

### Files created
- `backend/app/modules/resume_analyzer/review.py` — the aggregation layer
- `backend/app/schemas/resume_review.py`
- `backend/tests/test_resume_review.py`
- `frontend/src/components/resume/ResumeReviewPanel.tsx`
- `frontend/src/lib/scoreBands.ts` — the shared score-band vocabulary later
  reused by Milestone 3

### API changes (additive only)
- `GET /api/resume/review/{analysis_id}` — job-specific mode (Mode B), reuses
  a stored scan, zero writes
- `POST /api/resume/review/general` — resume-only mode (Mode A), stateless,
  not persisted (`resume_analyses.job_description`/`.ats_score` are `NOT NULL`,
  so a JD-less scan has no row shape without a migration)

### Architecture decisions
**Resume Health is job-independent in both modes, by design.** Two of the
seven rubric metrics (hard skill match, title alignment) only mean anything
relative to a posting — including them would make the same resume's Health
score move depending on whether a job description happened to be pasted.
Verified live, not just asserted: the same resume scored 96.8 in both Mode A
and Mode B.

**Grammar is declared but marked unavailable**, not omitted — Phase 1 added no
LLM call. A gap the user can see is honest; a silently missing category is
not. This became the template Job Matching later followed for its own
deferred dimensions.

### Bugs found and fixed
- `extract_text`'s `ValueError` for unsupported file types wasn't caught in
  the new `/review/general` handler — would have 500'd instead of 400'd.
  Caught during live TestClient verification, fixed before ship.

### Verification
Backend: full suite passing throughout. Frontend: TypeScript/ESLint/build
clean; live-rendered via a temporary unauthenticated preview harness with
the real network call intercepted (not bypassed props), across desktop/
tablet/mobile × light/dark. Harness deleted after use.

---

## Milestone 2.5 — Resume Review refinement ✅

**Completed:** 2026-08-27
**Scope:** polish and consistency only — no new functionality.

### Fixed
- **Score-vocabulary fragmentation.** `ScoreRing` computed its own
  Strong/Competitive/Needs work/At risk bands at 80/60/40, independent of
  whatever band string the API had already sent — the same score could read
  two different ways in the same feature. Unified onto `scoreBands.ts`
  (EXCELLENT/STRONG/GOOD/NEEDS WORK/WEAK/NOT CHECKED, matching
  `rubric.band()` exactly); `ScoreRing` now accepts an optional `band`
  override and falls back to the same shared derivation.
- **Dead-end next action.** `tailor_resume`'s href pointed at
  `/resume/tailor` with no `job` query param, which that route hard-requires
  — a guaranteed dead end in job-specific mode, since a pasted job
  description was never tied to a real `job_listings` row. Repointed to
  `/jobs`, matching what a since-removed hardcoded link already did
  correctly. Regression-tested.
- **Duplicated next actions.** Two hardcoded links inside the Quick-tailor
  panel ("Have a specific job in mind…", "Practice the interview next")
  overlapped the AI-generated Next Actions row once the href above was
  fixed. Removed the hardcoded pair; kept the generated version, per
  explicit instruction to prefer it when two actions serve the same purpose.
- **Color-only accessibility gap** in `RecommendationCard`'s priority
  indicator (a dot, no text) — introduced in Milestone 2 itself. Added a
  visible text label matching `CategoryChip`'s existing convention.

### Changed
- Folded the old free-text "Suggestions" tab into the Recommendations tab
  rather than merging every tab group into one — the bigger merge would
  have entangled two components that intentionally read from different
  endpoints. Added a "Detailed breakdown" heading so the remaining two tab
  groups read as one hierarchy.

---

## Milestone 3 — AI Job Matching ✅

**Completed:** 2026-08-27
**Status:** Phase 1 approved. Experience/Education/Salary/Location Match
explicitly deferred — see Future enhancements below.

### Summary
Layered a matching engine on top of the existing job feed without touching
ingestion, caching, or fetch logic. Resume Match and Skills Match are
computed per request against the caller's primary resume when one exists;
computation is skipped entirely otherwise, not attempted with a placeholder.

### Files created
- `backend/app/modules/job_market/matching.py` — the Job Matching Engine: a
  `MatchProvider` registry (`MatchContext` in, dimension dict or `None` out),
  two providers shipped (`score_resume_match`, `score_skills_match`)
- `backend/tests/test_job_matching.py`
- `frontend/src/lib/jobSort.ts` — standalone sort utility (Best Match /
  Newest / Recently Posted / Salary / Company), deliberately not embedded in
  the page component so a future Dashboard or Career Coach surface can reuse
  it directly

### API changes (additive only)
`GET /api/jobs` — each listing gains an optional `match` field, `null`
whenever the caller has no primary resume on file. No new endpoints, no
change to fetching, caching, or filter logic.

### Architecture decisions
**Overall Match is Resume Match's own score, not a blend with Skills
Match.** Each dimension stays inspectable on its own rather than
disappearing into a weighted average nobody can unpack — an explicit product
decision, not an engineering default.

**The registry is real, not decorative.** Both providers share one call
signature (`MatchContext, job -> dict | None`) specifically so a future
Experience/Education/Salary/Location provider is one function appended to
`PROVIDERS`, with nothing else in the engine changing.

**No cache introduced.** `predict_score()` is a local model call and the
skills overlap is a set intersection over a few dozen listings — there is no
measured cost problem yet to justify one. Revisit if profiling says
otherwise.

### Verification
Backend: 9 new tests plus a live end-to-end smoke test through the real
endpoint (isolated SQLite, not the shared database — a placeholder test user
tripped a real foreign-key constraint against the actual configured
`DB_URL`, confirming it points at live Supabase Postgres and must never be
used for ad-hoc verification). Frontend: real component rendered via
Playwright with network interception, proving actual reordering for three
sort options (not a fixture coincidence) and confirming the no-resume path
preserves the original feed order exactly.

### Deferred: Experience, Education, Salary, and Location Match
Not incomplete features — explicitly out of scope until the required
structured data exists, per product decision:

| Dimension | What's missing today | What would unlock it |
|---|---|---|
| **Experience Match** | Job side has a clean 4-bucket enum (`entry/mid/senior/lead`); user side has only free-text `Profile.seniority`/`current_title`, no years-of-experience number | A structured years-of-experience field (profile input, or a deterministic parser over the resume's dated experience section) |
| **Education Match** | Neither side has real data — resume analysis only checks whether an Education section *exists*, never a degree; `enrichment.py`'s extraction schema never captures education requirements | Extending `enrichment.py`'s schema (the job ingestion pipeline) — explicitly out of bounds for this milestone by direct instruction |
| **Salary Match** | `salary_range` is an unparsed display string, never split into numeric bounds; no desired-salary field on `Profile` | A salary-range parser (job side) + a desired-salary field (profile side) |
| **Location Match** | Job side has `location` + `work_mode`; `Profile` has no location or relocation-preference field at all | A preferred-location / remote-only field on `Profile` |

---

## Milestone 4 — AI Interview Preparation ✅

**Completed:** 2026-08-27
**Status:** Approved.

### Summary
A teaching module, deliberately distinct from Mock Interview (Milestone 5):
every question returns its full answer, explanation, and context the moment
it's fetched — nothing is gated behind an attempt. Five categories (HR,
Technical, Behavioral, Screening, Scenario), each question carrying
difficulty, estimated answer time, an ideal answer, a concept explanation, a
beginner-friendly explanation, a real-world example, what the interviewer is
testing, interview tips, common mistakes, important keywords, and follow-up
questions.

### Files created
- `backend/app/models/interview_prep.py` — `PrepQuestion` (shared cache, no
  `user_id`) and `PrepQuestionUserState` (bookmark/completed/notes, the one
  genuinely user-specific layer, unique on `user_id + prep_question_id`)
- `backend/app/modules/interview_coach/prep.py` — cache-first generation
  (`get_prep_questions`), one Claude call producing all three difficulties
  for a role+category at once, and the per-user state overlay
  (`attach_user_state` / `upsert_user_state`)
- `backend/tests/test_interview_prep.py`
- `frontend/src/components/interview/InterviewPrep.tsx` and
  `PrepQuestionCard.tsx` — role/category/difficulty filters, search, and the
  collapse-expand card carrying every field

### API changes (additive only)
`GET /api/interview/prep/questions` (role, category) and
`PATCH /api/interview/prep/questions/{id}/state` — new endpoints on the
existing interview coach router; no change to any prior interview endpoint.

### Architecture decisions
**Cache key includes prompt and model version**, not just role + category +
difficulty — mirrors the job feed's shared-cache philosophy with one
addition it doesn't need: a future prompt or model change mints new content
under a new key instead of invalidating everything or silently mixing old
and new rows under one key.

**Screening (general) is deliberately separate from job-specific Screening
Prep.** Same underlying concept, different scope — one is JD-grounded, the
other is general recruiter-screen practice for a role. Kept as one category
label with disambiguating UI copy rather than two competing terms.

### Fixed
- The "N of M marked complete" progress counter never updated after a
  toggle — `PrepQuestionCard`'s bookmark/completed state was purely local
  and never reached the parent's aggregate. Added an `onStateChange`
  callback that lifts every change into the parent's question list; caught
  and verified via Playwright (a real bug, not a hypothetical).

### Verification
Backend: cache-hit/miss, role-normalisation collapsing, per-category cache
isolation, per-user state isolation, and partial-update-doesn't-reset-other-
fields all covered on isolated SQLite. Frontend: real component rendered via
Playwright across light/dark and desktop/mobile, covering expand/collapse,
bookmark + complete toggles, notes autosave, search, difficulty filter, and
the offline/error state.

---

## Milestone 5 — AI Mock Interview (Text) ✅

**Completed:** 2026-08-27
**Status:** Approved. This milestone establishes the **Interview Engine** —
the shared session lifecycle, evaluation pipeline, and report generation
that Voice Interview (Milestone 7 — reordered after AI Career Coach; see
Milestone 6) and a future Live AI Interview extend rather than rebuild.

### Summary
The timed question → typed answer → evaluation loop as a full session, not a
free-generation quiz. Question sourcing reuses Interview Preparation's own
cache directly (`prep.get_prep_questions`) instead of a second generation
path — a mock session practices content Prep already produced. Every answer
is scored across seven named dimensions (Technical Accuracy, Completeness,
Communication, Structure, Problem Solving, Relevance, Practical Thinking)
with strengths, weaknesses, missing points, and learning suggestions that
each state *why*, not just a label — plus an improved rewrite of the
candidate's own answer. A session ends in a generated report: overall score,
readiness band (the same `rubric.band()` vocabulary Resume Review and Job
Matching already use), a performance summary, strongest/weakest skills,
topics to improve, a practice plan, and next recommended actions.

### Files created
- `backend/alembic/versions/4bc9e19e5c8b_interview_engine.py` — additive
  only: new nullable columns (or NOT NULL with a server default) on all
  three existing interview tables; `feedback`/`improvement_tips` relaxed to
  nullable rather than dropped, so old answers keep their exact original
  shape
- `backend/app/modules/interview_coach/engine.py` — session lifecycle
  (start / get-active / abandon) and question sequencing, sourced from
  Prep's cache with a snapshot-at-creation-time text copy plus a
  `prep_question_id` FK for provenance
- `backend/app/modules/interview_coach/evaluation.py` — the seven-dimension
  evaluation pipeline, reusable as-is by Voice Interview later (which only
  needs to transcribe audio to text and hand it to the same function)
- `backend/app/modules/interview_coach/reports.py` — one Claude call per
  completed session (not one per answer) for the narrative fields; every
  score, dimension average, and strongest/weakest ranking is computed in
  plain Python from data already on file, never re-derived by the model
- `backend/tests/test_interview_engine.py` — 21 tests

### Components created
- `frontend/src/lib/interviewCategories.ts` — the one category vocabulary
  (value/label/icon for HR/Technical/Behavioral/Screening/Scenario), now
  shared by Interview Preparation and Mock Interview instead of each
  maintaining its own list
- `SessionReportPanel`, `ReportQuestionRow`, `NextActionCard` (in
  `interview/page.tsx`) — the final report view: score, readiness band,
  per-dimension performance bars, strongest/weakest skill chips, topics to
  improve, practice plan, next-action cards, and collapsible per-question
  detail

### Components reused
`Skeleton`, `InlineError`, the existing card/motion/collapse-expand
language, `Button`/`Input`/`Textarea` primitives, `bandColor`/`bandLabel`
from `scoreBands.ts`, and the `{key,label,description,href,priority}`
next-action shape Resume Review's `NextActionSchema` already established
(imported directly, not re-declared).

### API changes (additive only)
- `POST /api/interview/questions` — now requires `category`; sources
  questions via the Interview Engine instead of free generation
- `POST /api/interview/evaluate` — now runs the seven-dimension pipeline
- `GET /api/interview/sessions/active` (new) — powers both "detect a
  resumable session" and Resume Interview itself; no separate resume
  endpoint exists because every answer is already persisted on submission
- `POST /api/interview/sessions/{id}/abandon` (new) — powers Restart
  Interview; idempotent
- `GET /api/interview/sessions/{id}/report` (new) — cache-first; the
  narrative fields are generated once and served from the session row
  thereafter
- `POST /api/interview/model-answer` — when the question came from Prep's
  cache, now serves that question's own `ideal_answer`/tips directly with
  **no LLM call at all**, instead of generating a second, independent model
  answer

### Database changes (additive only)
`interview_sessions` gained `category`, `status`, `overall_score`,
`readiness_band`, `performance_summary`, `topics_to_improve`,
`practice_plan`, `completed_at`, `updated_at`. `interview_questions` gained
`prep_question_id` (FK to `prep_questions`, `ON DELETE SET NULL`) and
`sequence_order`. `interview_answers` gained `strengths`, `weaknesses`,
`missing_points`, `learning_suggestions`, `dimension_scores`. No column
dropped; no existing row rewritten. Migration verified both directions
(upgrade/downgrade/upgrade) against a throwaway SQLite file.

### Architecture decisions
**Question sourcing reuses Prep's cache verbatim rather than generating
anything new for Mock Interview.** A direct consequence, disclosed rather
than hidden: repeated attempts at the same role+category draw from the same
underlying question pool Prep already cached (question order is shuffled
per session so it isn't identical every time). This is the literal
instruction — "avoid duplicate question generation... use existing cached
content" — not an oversight.

**A session covers one category, not a mixed set.** The pre-existing drills
flow generated a mix of technical/behavioral questions client-bucketed into
a permanently-buggy three-tab scheme (`system_design` was unreachable, since
the backend only ever emitted `"technical"`/`"behavioral"`). Replaced with
Prep's real five-category scheme end to end — one category per session,
matching how Prep itself already works, which is what "unify onto the
5-category scheme" (the approved architectural refinement) means in
practice.

**Only one session "in_progress" per user.** Starting a new one abandons
whichever was active; nothing is lost, since every answer was already
persisted immediately on submission. Simpler than letting sessions race for
an "active" slot.

**"Category Performance" in the report is the seven evaluation dimensions,
not the session's Prep category** (a session only ever has one of those).
Deterministic, computed from `dimension_scores` already stored on each
answer — never re-asked of Claude, and re-computed fresh on every read
rather than cached, since it's a cheap join.

**Legacy drill sessions (`category IS NULL`) never surface as resumable.**
Their `status` column reads `"in_progress"` only because that is the
migration's server default, not because a lifecycle was ever tracked for
them — `get_active_session` filters `category IS NOT NULL` so history stays
exactly as it was without an old, un-resumable row appearing as a live
session.

### Fixed (opportunistic, same file already open)
A layout bug on the Mock Interview setup screen: `.eyebrow` labels are
`inline-flex`, so a label immediately following another `inline-flex`
sibling (the mode-tab pill row, the seniority pill row) rode up onto the
same visual line instead of starting its own — pre-existing before this
milestone, newly visible because the added Category section repeated the
pattern a second time. Given an explicit `display: block` on the three
affected labels rather than touching the shared `.eyebrow` class globally.

### Verified
Backend: 21 new tests (session lifecycle, abandonment, legacy-session
exclusion, the evaluation pipeline including its offline fallback, session
completion + report generation, report payload shape, retry-safety of
report generation) plus the full 581-test suite with zero regressions.
Migration verified upgrade → downgrade → upgrade against a throwaway
SQLite file, and the resulting schema inspected column-by-column. Frontend:
TypeScript, ESLint, and production build all clean; a real component
rendered via Playwright with network interception covering fresh start,
category selection, answering all three questions, the seven-dimension
feedback panel, the full final report (all sections), the resume banner,
resuming a partially-answered session, restarting (confirming the abandon
call actually fires), exiting without abandoning, mobile viewport, dark
mode, and the setup-time error state.

### Remaining technical debt
- `dashboard/services.py` still calls `predict_score()` directly for
  `JobApplication.match_score` rather than through `job_market.matching`
  (tracked since Milestone 3, target Milestone 9 — unrelated to this
  milestone, not touched).
- Legacy drill-session rows (pre-Milestone-5) have no `category`; their
  history-list `status` is derived on read (completed if fully answered,
  abandoned otherwise) rather than backfilled in the database, since they
  are read-only history nobody can act on further.
- No automated accessibility audit tool was run; keyboard/ARIA patterns
  followed the same conventions already established elsewhere in this
  module (verified by inspection, not tooling).

### Recommendation before Milestone 7 (Voice Interview)
Voice Interview should extend `evaluation.py`'s `evaluate_answer` and
`engine.py`'s session lifecycle unchanged — the only new work is speech-to-
text producing the `answer_text` string these already accept, plus whatever
mic-permission and playback UI the modality needs. A short feasibility spike
on the STT vendor choice (as `ROADMAP.md` already flags) is worth doing
before committing full scope. (AI Career Coach was built first as Milestone
6, ahead of Voice Interview, at the user's explicit direction — see below.)

---

## Milestone 7 — Voice Interview ✅

**Completed:** 2026-08-29
**Status:** Approved. Deepgram Nova-3 chosen (over OpenAI Whisper) during
analysis — cheaper, native word-timestamps, native filler-word detection.

### Summary
Spoken answers as an alternative input method feeding the existing Interview
Engine — explicitly not a second interview system. `engine.py`,
`evaluation.py`, and `reports.py` are unmodified from Milestone 5: a voice
answer becomes a plain `answer_text` string the moment it's accepted, and
from there is indistinguishable from a typed one to every downstream system,
including the Career Coach's grounding context. The one new capability is
narrowly scoped — audio in, transcript + a few honestly-derived observations
out — and stores no audio anywhere, at any point.

### Files created
- `backend/alembic/versions/9a95c3ae4c54_add_voice_metrics_to_interview_answers.py`
  — one nullable column, nothing else touched
- `backend/app/modules/interview_coach/voice.py` — the Deepgram integration:
  retries transient 5xx/timeout (not 4xx — a bad recording fails the same
  way every time, so retrying it only adds latency), and derives
  `speaking_duration_seconds`, `average_confidence`, `speaking_rate_wpm`,
  `long_pause_count` (word-timestamp gaps ≥2.5s), and `filler_word_count`
  (our own match against a short, deliberately narrow interjection list —
  "uh"/"um" and close variants, not contextual words like "like" that would
  false-positive on ordinary sentences) — computed from the *original*
  transcript before any user edit, since editing for clarity shouldn't be
  measured as a speaking behavior
- `backend/tests/test_voice_transcription.py` — 12 tests, all against a real
  `httpx.Client` wired to `httpx.MockTransport` (so the actual request-
  building and retry code runs, not just the function signature)
- `frontend/src/components/interview/VoiceAnswerComposer.tsx` — Record /
  Pause / Resume / Stop / Replay / Re-record via `MediaRecorder`

### Components reused
The existing Textarea + Submit button *are* the transcript-preview/edit/
accept step — no separate accept UI exists. `analyzeResume`'s
`onUploadProgress` axios pattern, reused verbatim for the audio upload.
`UploadFile = File(...)`, the same multipart pattern `resume_analyzer`'s
`/analyze` already used. The Career Coach, Interview Engine, session
lifecycle, question sequencing, and history required zero changes.

### API changes
- `POST /api/interview/transcribe` (new) — stateless; touches no session/
  question/answer row
- `POST /api/interview/evaluate` (existing) — accepts an optional
  `voice_metrics` field, persisted alongside the answer; never passed into
  `evaluate_answer`'s scoring

### Database changes (additive only)
One nullable `voice_metrics` (JSON text) column on `interview_answers`.

### Architecture decisions
**Voice is a frontend-only concept below the API layer.** No
`input_mode`/session-level column exists anywhere — the backend cannot tell
a voice-submitted answer from a typed one except by whether
`voice_metrics` is present, and that's by design: input method doesn't
affect question generation or evaluation, so it never needed to reach the
database as its own field.

**No persistent audio storage, anywhere.** Audio bytes exist in browser
memory (for client-side replay) and transiently inside the `/transcribe`
request handler (forwarded to Deepgram, discarded on return) — never on
disk, never in the database. This is a privacy-by-design choice, not a
policy promise: voice recordings are closer to biometric data than text,
and not retaining them sidesteps most of that exposure rather than managing
it after the fact.

**Filler-word count is computed by us, from Deepgram's raw word list, not
read from a vendor-provided flag** — Deepgram's `filler_words=true` surfaces
fillers as ordinary entries in the transcript's word array rather than a
separately tagged field, so counting them against an explicit, narrow list
(mirroring `resume_analyzer/rubric.py`'s own `_STOPWORDS` pattern) keeps the
metric inspectable and honestly bounded rather than trusting undocumented
vendor internals.

**Every voice metric is independently optional and computed from real
data or omitted — never fabricated.** `VoiceMetricsSchema`'s fields are all
`Optional`; `voice.py`'s `_voice_metrics()` only ever adds a key when its
specific inputs (duration, confidence, timestamped words) are actually
present in Deepgram's response.

### Fixed (caught during Playwright verification, not shipped)
An ESLint `react-hooks/purity` violation in `VoiceAnswerComposer`: several
`Date.now()` calls, made from plain arrow functions in the component body
(not wrapped in `useCallback`), were flagged as impure calls reachable from
render. Fixed by isolating the wall-clock read behind a module-level `now()`
helper — the same indirection `ConversationSidebar.tsx`'s `relativeLabel`
already used for the identical reason.

### Verified
Backend: 12 new tests plus the full 608-test suite, zero regressions.
Migration verified upgrade → downgrade → upgrade. A live end-to-end smoke
test through the real FastAPI/Starlette stack, with Deepgram mocked at the
httpx transport layer (no real Deepgram API key exists in this
environment — flagged below as the one gap automated testing cannot close).
Frontend: TypeScript, ESLint, and production build all clean; a real
component rendered via Playwright with a faked `MediaRecorder`/
`getUserMedia` — record/pause/resume/stop, transcript preview with editing,
re-record, mic-permission-denied, unsupported-browser (native
`MediaRecorder` explicitly removed to actually exercise that path, since
real Chromium always has one), a transcription failure, mobile viewport,
dark mode, and a regression pass confirming Text mode renders and behaves
exactly as before.

### Remaining technical debt
- **Not verified against the real Deepgram API** — no `DEEPGRAM_API_KEY`
  exists in this environment. Every test mocks Deepgram at the httpx
  transport layer, which exercises all of this module's own logic
  correctly but cannot catch a genuine mismatch between this code's
  assumptions and Deepgram's actual current response shape. Recommend one
  real manual test with a live key before this reaches production.
  Response schema was confirmed against Deepgram's own current API
  reference during analysis, not left to memory.
- No mid-session mode switching — Input method is chosen once at setup,
  matching category/seniority's own pattern; not requested, easy to add later.
- No aggregate voice analytics across a session (e.g. "average pace this
  session") — each metric surfaces per-question only, matching the
  instruction to leave `reports.py` unchanged.

### Recommendation before Milestone 8
Application Tracker needs no changes from this milestone — voice answers
are indistinguishable from typed ones by the time anything outside
`interview_coach` sees them. The one open item worth closing before this
ships to real users is the live-Deepgram verification noted above.

---

## Milestone 8 — Intelligent Application Tracker ✅

**Completed:** 2026-08-30
**Status:** Approved. The point of this milestone: the tracker becomes the
one surface that reads across every other engine already built (Resume,
Job Matching, Interview, Career Coach) rather than adding a fifth isolated
one, per explicit instruction not to build it as a standalone feature.

### Summary
Upgraded the original 5-stage board (saved/applied/interviewing/offer/
rejected) into a 12-stage hiring pipeline with three views — Kanban (real
drag-and-drop), List (sortable table), Timeline (cross-application activity
feed) — plus a detail drawer that aggregates what the other engines already
know about an application: the resume used, a live job-match breakdown,
interview readiness with a practice link, and four Career Coach
quick-prompts. Every status change is now timestamped in its own history
table, which also made an existing, previously-disclosed Analytics
limitation exact instead of approximate (see Architecture decisions).

### Files created
- `backend/alembic/versions/23061ee9a125_expand_application_pipeline_stages.py`
  — the stage expansion, the legacy-status remap, `application_status_history`
  plus its one-time backfill
- `backend/tests/test_application_tracker.py` — 17 tests
- `frontend/src/lib/applicationStages.ts` — stage labels/markers, one place
  now shared by the Kanban board, List view, Timeline view, and detail
  drawer instead of four copies
- `frontend/src/components/applications/{ApplicationCard,KanbanBoard,
  ListView,TimelineView,ApplicationDetailDrawer}.tsx`

### Components reused
`Skeleton`, `InlineError`, `Button`/`Input`/`Textarea`, the segmented-control
pill pattern (`layoutId` + spring) already established for Category/
Seniority/Input-method pickers, `bandColor`/`bandLabel` from `scoreBands.ts`,
optimistic-mutation-with-rollback (unchanged from the original board),
`/interview?role=` (Milestone 4's own handoff mechanism, unmodified) for
"Practice for this role", and the Career Coach's existing chat pipeline
entirely unmodified — quick-prompts are just a `?prompt=` link.

### API changes
- `GET /api/applications/{id}` (new) — the detail drawer's one request
- `GET /api/applications/activity` (new) — the Timeline view's feed;
  declared ahead of `/{application_id}` so "activity" is never parsed as an id
- `POST/PATCH /api/applications[...]` — additive `recruiter_name`/
  `recruiter_email` fields; `match_score` (already computed lazily
  elsewhere) now exposed read-only

### Database changes
New `application_status_history` table. `job_applications` gains
`recruiter_name`, `recruiter_email`, and a widened 12-value status CHECK
constraint. Existing `'interviewing'` rows remapped to
`'recruiter_screening'` — disclosed as the least presumptuous read available,
since the old scheme never recorded which round was actually reached.
Migration verified upgrade → downgrade → upgrade against seeded data,
confirming both the forward remap and the reverse (lossy, also disclosed).

### Architecture decisions
**Voice-mode-style non-invasion:** the detail view calls straight into
`job_market.matching.build_job_match`, the same function the job feed uses,
and correlates interview sessions by the same `normalise_query()` role
matching the feed already relies on for its cache keys. No new scoring
model, no new matching logic, no new interview-linking schema — an
application has no FK to an interview session; the correlation is
deliberately soft (a normalised-role match), not a hard link, and
documented as best-effort rather than authoritative.

**Job Match falls back to the user's latest resume scan when no resume is
explicitly tailored for the application; "Resume Used" does not.** These
read differently on purpose: "Resume Used" is a factual claim ("this is
what you submitted") and stays strictly tied to `tailored_resume_id`, while
a match estimate against the user's current resume is still useful
information even without an explicit link, so it's shown with a fallback.

**Career Coach integration required zero backend changes.** A quick-prompt
is a plain `/coach?prompt=<encoded text>` link; `/coach` pre-fills the
composer from a one-shot query-param read (mirroring `/interview`'s own
`?role=` handoff) without sending, so the user can still edit. The prompt
text itself carries the company/role context — the Coach's own grounding
(resume, mock-interview readiness, pipeline stats) does the rest, exactly as
Milestone 6 built it.

**`application_status_history` made an existing analytics limitation exact
instead of approximate.** `pipeline_funnel`'s `reached_interviewing` /
`reached_offer` previously read current `status` ordinally (a card at
'offer' must have passed through 'interviewing') and explicitly disclosed
that a rejection after progressing would under-count — the stage was real
but no longer visible in `status`. With per-application history now
recorded, both figures query "did this application ever reach a
qualifying stage", which is exact, not a floor.

**Kanban drag lives on a dedicated handle, not the whole card.** dnd-kit's
pointer sensor is configured with an 8px activation distance so a plain
click still opens the detail drawer or the per-card select — but the drag
listeners themselves are scoped to a small grip icon rather than the card
body, so an accidental card-body drag (dragging by the title, say) can
never fire; only a deliberate grab on the handle can.

### Fixed (caught during Playwright verification, not shipped)
Two pre-existing test-fixture gaps surfaced by the stage expansion:
`analytics`/`applications`/`dashboard` tests hardcoded the old 5-value
status list and a status literal (`"interviewing"`) that stopped being
valid — updated to the new stage names rather than left broken. Separately,
the detail drawer's delete flow invalidated (and therefore refetched) the
just-deleted application's own detail query before closing, guaranteeing a
404 on every delete; reordered so the drawer closes first.

### Verified
Backend: 17 new tests (status history recording and its no-append cases,
the cross-application activity feed and its ownership isolation, the detail
view's aggregation across all three engines including the resume/job-match
fallback behavior and the soft interview correlation) plus the full
625-test suite, zero regressions. Migration verified upgrade → downgrade →
upgrade with real seeded data, confirming the remap and backfill logic
concretely, not just that the DDL runs. Frontend: TypeScript, ESLint, and
production build all clean; a real component rendered via Playwright
covering a genuine mouse-simulated drag between Kanban columns (not just
the accessible select fallback), List view sorting, the Timeline feed, the
full detail drawer (all four engine sections, recruiter-field editing,
stage change, Escape-to-close), the two-step delete confirmation, mobile
viewport, dark mode, and the pre-existing add-application flow as a
regression check.

### Remaining technical debt
- The interview↔application correlation is soft (normalised role match),
  not a hard link — a user who practices under a slightly different role
  name than what they saved the application as won't see it connected.
  Acceptable given no schema link was requested and the alternative (a
  manual link field) adds friction for a best-effort convenience feature.
- No per-application audio/voice-interview-specific surfacing beyond what
  the Interview Engine's own readiness/topics already provide — Voice
  Interview (Milestone 7) already made voice indistinguishable from typed
  answers at the data layer, so nothing extra was needed here.
- List view sorting is client-side over the already-fetched pipeline: fine
  at today's realistic pipeline sizes, would need server-side pagination if
  a user's tracked-application count grew into the thousands.

### Recommendation before Milestone 9
Dashboard's own known duplicate-fetch issue (flagged since Milestone 3) is
still open and is explicitly this milestone's stated point to resolve.
Beyond that, Dashboard can reuse `applications.get_pipeline` and the new
`get_activity_feed` directly for an "recent activity" widget rather than
re-deriving either.

---

## Milestone 11 — Platform Polish & User Experience ✅

**Completed:** 2026-09-02
**Status:** Approved. Cohesion pass across all ten shipped modules. Preceded
by a Code Stabilization Sprint (2026-09-01) that cleared build/type/lint debt
so this milestone started from a green baseline.

### Summary
Ten milestones of vertical feature work leave a product that is coherent
inside each module and inconsistent across them. Every finding below is drift,
not a decision anyone made.

The most consequential were navigational, not visual: **Analytics, Reports and
Offers had no inbound link anywhere in the app** — three finished, working
pages reachable only by typing the URL — and the ⌘K palette had not been
touched since Milestone 5, so Career Coach and the Application Tracker were
missing from it entirely. The top bar compounded this by falling back to
"Overview" for any route absent from the sidebar, so six routes displayed the
wrong page title.

### UI improvements
- `PageHeader` replaces three `<h1>` treatments, two eyebrow classes and
  inconsistent entrance animations across nine pages. The italic display face
  won because it is what the most recent approved work (M8/M9) and the Resume
  scan screen already used, and it distinguishes a page title from the
  `font-semibold` used for section headings.
- Eyebrow classes collapsed from three aliases to one (`.eyebrow`).
- Form controls consolidated: Settings and Profile now compose
  `ui/select` / `ui/switch` instead of re-implementing Radix inline. This
  removed a hardcoded `bg-white` thumb, an `rgba(0,0,0,0.6)` popover shadow,
  and a trigger whose only focus signal was a border colour.
- Dashboard chart colours moved off baked-in dark-theme hexes onto the
  existing `useChartTheme()`.

### UX improvements
- Sidebar regrouped into Menu / Insights / Account; Analytics, Reports and
  Offers reachable for the first time.
- ⌘K palette gained Career Coach, Applications, Offers and Policy News.
- Page titles correct on every route.
- Toast layer added — the product previously had no success feedback at all.
  Wired first to the three optimistic mutations that rolled back **silently**
  (Applications move/delete, Offers delete), where a failure previously just
  made the card reappear with no explanation.

### Honesty fixes
Settings' "Save preferences" button had no handler and no backend to call.
Adding a confirmation toast there would have fabricated success, so the button
is disabled with an explicit note. Flagged as debt below rather than papered
over.

### Performance improvements
- recharts (~360KB, the bundle's largest chunk) lazily loaded on the dashboard
  via `next/dynamic` — the chart is below the fold on every viewport.
  Deliberately *not* applied to Analytics/History, where the chart is the page.
- Seven zero-reference dependencies removed.
- Code splitting was considered for `ApplicationDetailDrawer` and
  `JobDetailDrawer` and rejected: both own their `AnimatePresence`
  internally, so the conditional render needed to make `dynamic()` defer
  anything would destroy their exit animations. Recorded as debt.

### Accessibility improvements
- Toast viewport is a persistent `role="status"` / `aria-live="polite"`
  region; dismiss control keyboard-reachable with a visible focus ring in
  both themes.
- Shared Select/Switch restored proper `focus-visible` rings on two pages
  that had `focus:outline-none` with only a colour change.
- An audit of icon-only buttons found **no** missing accessible names — the
  nine flagged during stabilization were all detector false positives.

### Verified
TypeScript, ESLint, production build clean. 676 backend tests pass. Playwright
sweep across 4 viewports × 7 routes (28 combinations): zero horizontal
overflow, zero console errors, both themes.

### Remaining technical debt
- `interview/page.tsx` is 1331 lines — by far the largest file in the app and
  the obvious next extraction. Deliberately not attempted here: it owns the
  session lifecycle for text *and* voice interviews, and splitting it is a
  refactor with real regression surface, not polish.
- Settings notification preferences are not persisted (no endpoint, no
  columns). Now honest in the UI, still unimplemented.
- Protected pages were verified for overflow only indirectly — the Playwright
  sweep covers public routes plus a component harness, since the app pages sit
  behind a Supabase session.
- 78 Tailwind canonical suggestions remain, all raw pixel layout dimensions
  where the canonical form reads worse (`max-w-[1280px]` vs `max-w-320`).
- `ui/card.tsx` and `ui/progress.tsx` remain unreferenced primitives.

### Recommendation before Milestone 12
Production readiness should start with the two things this pass could not
honestly resolve: settings persistence (a real endpoint, not a disabled
button) and the interview page extraction. Both are prerequisites for
calling the app production-complete rather than production-stable.

---

## Milestone 10 — Notifications ✅

**Completed:** 2026-09-01
**Status:** Approved. A production Notification Engine — durable storage,
dedupe/group/priority/expiration, triggers wired into six existing engines,
and the first real publisher and subscriber for the SSE pipe every earlier
milestone left connected but silent.

### Summary
Before writing any code, grepped the whole backend for
`event_manager.publish(` and the frontend for `useRealtimeStream(` (the call
site, not the definition). Both came back empty: `core/events.py`'s SSE
pub/sub and `useRealtimeStream.ts`'s `INVALIDATIONS` map had existed since
Milestone 6 (built for Career Coach's own chat stream, which uses a
different transport) but nothing had ever published a domain event through
it, and nothing had ever mounted the hook. This corrected an assumption in
`ROADMAP.md`'s own Milestone 10 placeholder note ("persist the events
already flowing through core/events.py") — there were no events flowing.
Milestone 10 is therefore two things at once: a new persistent
`notifications` table with a decision layer in front of it (the actual
"engine" the spec asks for), and the first real wiring of the existing
realtime channel end to end.

A `Notification` row is the unit of both durability and delivery. Every
insert goes through one function, `create_notification`, which decides
dedupe (has this exact event already fired, ever or within a window),
grouping (does an active, related notification exist to fold this into
instead of adding a new row), and expiration — then, only for a genuinely
new or updated row, enqueues a `BackgroundTasks` call to
`event_manager.publish` so an open tab updates live. The list/unread-count/
history reads never depend on the SSE channel; a client that missed every
live push still sees correct state on next load, because the table is the
source of truth and the channel is a nicety on top of it.

Two trigger shapes, matching how the six named categories actually produce
signal in this codebase: **event-driven** (`notify_resume_scanned` from
`resume_analyzer/router.py`'s `/analyze`, right after a scan is saved;
`notify_application_status_changed` from `applications/services.py`'s
`update_application`, at the exact point that already detects and records
the transition) and **periodic** (`check_periodic`, an opportunistic sweep
for the time-based types — mock/voice interview reminders, follow-up nudges,
Career Coach suggestions, weekly/monthly summaries, career milestones —
that nothing "happens" to trigger). There is no task scheduler anywhere in
this project, so periodic checks piggyback on `GET /api/dashboard/home`,
which every signed-in user already visits often enough to stand in for one;
every check inside it is independently dedupe-guarded, so running it on
every visit is safe and cheap (most calls do nothing).

### Files created
- `backend/app/models/notification.py` — `Notification`, plus the
  `NOTIFICATION_TYPES`/`NOTIFICATION_CATEGORIES`/`NOTIFICATION_PRIORITIES`
  vocabularies
- `backend/alembic/versions/e885039971d2_add_notifications_table.py` —
  additive, one table
- `backend/app/schemas/notification.py`
- `backend/app/modules/notifications/service.py` — the engine: `create_notification`
  (dedupe/group/expire/publish), list/unread-count/mark-read/mark-all-read/
  archive, the two event-driven trigger functions, and `check_periodic`
- `backend/app/modules/notifications/router.py` — `GET /api/notifications`,
  `GET /unread-count`, `POST /{id}/read`, `POST /read-all`, `POST /{id}/archive`
- `backend/tests/test_notifications.py` — 32 tests
- `frontend/src/hooks/useNotifications.ts` — the Center's one data source;
  the first real caller of `useRealtimeStream` anywhere in the app
- `frontend/src/components/notifications/NotificationBell.tsx` — bell,
  unread badge, popover list with priority dots, category + relative-time
  labels, grouped-count chips, mark-read/mark-all-read/archive
- `frontend/src/components/ui/popover.tsx` — thin shadcn wrapper over
  `@radix-ui/react-popover`, already a dependency with no existing wrapper

### Components/infrastructure reused
`core/events.py`'s `event_manager` singleton and `format_sse` (no changes
to either — this milestone is its first caller, not a modification);
`useRealtimeStream.ts`'s existing `INVALIDATIONS` map (one line added:
`notification` → `['notifications']`); `interview_coach.dashboard.
dashboard_summary`, `interview_coach.prep`, `job_market.services.
top_matches`, `applications.get_pipeline`, `dashboard.services.
_resume_section`/`_stale_recruiter_stage_application`, `analytics.services.
pipeline_funnel` — every periodic check reads an existing engine's own
function, none recomputes a score or a match; `INTERVIEW_STAGES` from
`models/application.py`; the `/coach?prompt=` query param Milestone 8 added,
now also used by Career Coach notification links; `BackgroundTasks`, the
same FastAPI primitive `job_market/router.py` already uses for background
work (the one difference: that call site uses a raw daemon thread because a
scrape runs minutes — a notification publish is one fast async call, so
`BackgroundTasks.add_task(event_manager.publish, ...)` is the right-sized
tool here, not a second thread pattern); `Skeleton`, `InlineError`, `Badge`,
`Button` on the frontend.

### APIs added
`GET /api/notifications`, `GET /api/notifications/unread-count`,
`POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`,
`POST /api/notifications/{id}/archive`. No changes to any existing endpoint
signature except adding an optional `background_tasks` parameter to
`applications.services.update_application` (default `None`, so every
existing caller — including every prior test — is unaffected) and to the
`/resume/analyze` and `/dashboard/home` router functions.

### Database changes
One additive migration: `notifications` (id, user_id, type, category,
priority, title, message, href, dedupe_key, group_key, occurrence_count,
read_at, archived_at, expires_at, created_at, updated_at), CHECK constraints
on type/category/priority mirroring `job_applications.status`'s existing
pattern, RLS enabled with zero policies (same deny-by-default posture as
every other table). Verified upgrade and downgrade against a scratch SQLite
database built from the full migration chain from scratch — this also
caught and fixed a real branching error: the new migration's `down_revision`
initially pointed at `992a070f86cb` (the career-coach tables migration),
which was a branch point, not the chain's actual tip; `alembic heads`
showed two heads until it was corrected to descend from `23061ee9a125`
(Milestone 8's pipeline-stages migration, the true prior tip — Milestone 9
added no migration at all).

### Architecture decisions
**One insertion path, three orthogonal decisions.** `create_notification`
is the only function that writes a row. Dedupe (has this exact event fired
already, permanently or within a window), grouping (fold into an active
related row instead of inserting), and expiration are each a parameter, not
three separate code paths a caller has to coordinate by hand.

**Dedupe is checked before grouping, not the other way around.** An early
version checked "is there an existing row with this dedupe_key, and if so
does its group_key match" — which only ever looked at rows sharing the
*same* dedupe_key, so a second distinct event meant to join an existing
group (e.g. a second qualifying job the same week) never found the group at
all and just inserted its own row. Caught by a test
(`test_matching_group_key_bumps_existing_row_instead_of_inserting`)
asserting the second call's row IS the first call's row. Fixed by checking
"has this exact event already fired" first (dedupe_key alone, independent
of grouping), and only for a genuinely new event, separately asking "is
there an active row in this group to fold into instead."

**Grouping is exercised by exactly one real trigger, not left theoretical.**
`_check_job_matches` is the one case where multiple *distinct* qualifying
events (two different high-match jobs) can legitimately be found in the
same sweep and are collapsed into one growing notification
(`group_key=f"high_match_jobs:{iso_week}"`) rather than one row each. Every
other trigger in this milestone names one specific, individually meaningful
event (a specific application's status change, a specific resume score
delta) where collapsing multiple into one row would destroy information the
spec asked to preserve — grouping was deliberately not forced onto those.

**Live push is best-effort and never the source of truth.**
`_publish` is a no-op when the caller has no `BackgroundTasks` (true for
every call inside `check_periodic`, which isn't running inside a request
that has one to give — periodic notifications are still created and stored
correctly, they just don't push live). This was a deliberate scope
decision, not an oversight: the Notification Center never depends on having
received a push to be correct, since every mount re-fetches from the
database.

**Honestly scoped, disclosed rather than fabricated, matching this
project's own established pattern from Milestones 3 and 9.** Three named
notification types in the original spec don't map to anything this schema
can honestly support:
- *Interview Scheduled* / *Interview Date Approaching* — there is no
  scheduling feature or calendar anywhere in this app (the same constraint
  Milestone 9 hit for "Upcoming Interviews"). Both collapse into
  `interview_stage_reached`, fired when an application moves into an
  interview-pipeline stage — a real event, not an invented date.
- *Match Score Improved* — job matches are computed fresh per request by
  design (`job_market/services.py`'s own documented choice not to persist
  them), so there is no per-user, per-job score history to diff against.
  Only `high_match_job` (a new listing crossing the high-match bar) exists.
- *Resume Health Improved* and *ATS Score Changed* are the same underlying
  event — a new scan's score against the previous one — collapsed into one
  type, `resume_score_changed`, whose title reflects direction.

### Fixed
- The dedupe/grouping ordering bug above, caught by its own test before
  ever reaching a real trigger.
- Nothing pre-existing was broken or discovered broken this milestone —
  unlike Milestones 8 and 9, this was net-new surface area with no prior
  code path to regress.

### Verified
Backend: 32 new tests (dedupe permanence and windowing, grouping bump
semantics including the fixed ordering bug, expiration exclusion, ownership
isolation, both event-driven triggers including a full router round trip,
the periodic sweep's idempotency, the job-match grouping trigger via a
monkeypatched `top_matches`) plus the full 676-test suite, zero regressions.
Migration verified both directions against a scratch SQLite database built
from the complete chain (25 revisions, one head). Frontend: TypeScript,
ESLint, and production build all clean. A real component rendered via
Playwright (`qa-preview-notifications`, deleted after verification) covering
the closed bell with an unread badge, the open popover with a grouped
"+1 more" chip and mixed priorities, mark-all-read clearing the badge
against a stateful mock, the empty state, a 500 error state, the loading
skeleton, mobile, dark mode, and the archive action firing its request —
zero console/page errors across every state except the intentional 500 in
the error-state case.

### Performance considerations
`check_periodic` runs up to five independent checks on every
`/dashboard/home` load, each 1-3 small queries; none calls an LLM or the
trained ML model. Every check is dedupe-guarded, so the common case (nothing
new to report) is a handful of cheap `SELECT`s that find nothing and return.
No caching layer in front of `/api/notifications` — acceptable at today's
realistic per-user notification volume (the list is capped at 50, indexed on
`(user_id, archived_at, created_at)` matching the one query shape the
Center actually issues).

### Remaining technical debt
- `_check_job_matches`'s per-job dedupe window (14 days) means a job folded
  into a group can theoretically resurface after that window even if it
  never stopped being a top match — a disclosed simplification rather than
  building a separate "which specific items are in this group" tracking
  table for one trigger.
- No email, push, or calendar delivery — explicitly out of scope per the
  milestone brief ("future-ready architecture... do not implement external
  delivery yet"). The category/priority/href shape on every row is already
  what an email digest or push payload would read from.
- `useRealtimeStream` is now mounted exactly once, inside
  `useNotifications`, which itself mounts once via `DashboardNav` — correct
  today since that's the only consumer, but a second feature wanting live
  events will need to either add its own mount (fine, the hook is cheap and
  idempotent per-component) or this should move up to a shared provider.
  Not done here since there is still only one caller.

### Recommendation before Milestone 11
Premium UI/UX Polish is the mop-up pass `ROADMAP.md` already scopes it as.
One concrete item this milestone surfaced: `NotificationBell`'s popover has
no dedicated empty/loading visual polish beyond what `Skeleton`/`InlineError`
already provide generically — worth a pass alongside whatever else
Milestone 11 sweeps up, but not blocking.

---

## Milestone 9 — AI Career Dashboard ✅

**Completed:** 2026-08-31
**Status:** Approved. The home page after login, answering one question:
"what should I do next to improve my chances of getting hired?" — composed
entirely from existing engines' own functions, per explicit instruction not
to recreate analytics already available elsewhere.

### Summary
One new endpoint, `GET /api/dashboard/home`, aggregating Resume, Job
Matching, Interview, Application, and Career Coach data that five other
modules already compute. Two genuinely new pieces exist because nothing
already answered their specific question: a cross-session mock/voice
interview aggregate, and a prep-completion count. Everything else — pipeline
stage counts, the ATS/interview funnel, top job matches, activity — is a
direct call into an existing service function. Also resolved the
long-flagged duplicate-fetch issue and, incidentally, caught a real
pre-existing bug via more thorough end-to-end testing than this data path
had previously received.

### Files created
- `backend/app/modules/interview_coach/dashboard.py` — `dashboard_summary`:
  completed-session count/average score, voice-answer count, latest report
- `backend/tests/test_dashboard_home.py` — 19 tests
- `frontend/src/components/NextActionCard.tsx` — extracted from two
  byte-for-byte duplicate implementations (Resume Review, Mock Interview
  report)

### Components reused
`ScoreRing`, `Skeleton`, `InlineError`, `glass-card`/`chip` styling,
Framer Motion stagger/entrance conventions, Recharts (already a dependency,
now driven by real data), `OnboardingModal`/`ResumeReminderDrawer`
unchanged, `bandColor`/`bandLabel`, `categoryLabel`, and — the biggest
reuse of this milestone — five other modules' own functions called
directly rather than reimplemented: `user_profile.dashboard_stats`,
`analytics.summary`, `applications.get_pipeline`/`get_activity_feed`,
`job_market.services.get_jobs`/`attach_matches` (via the new `top_matches`
wrapper), and `resume_analyzer.rubric.band`.

### APIs added
`GET /api/dashboard/home` (new). `GET /api/dashboard/overview` unchanged —
still what `/news` reads, deliberately not touched.

### Database changes
None. Every figure is read from tables that already exist, through read
paths that already exist or are thin compositions of them.

### Architecture decisions
**Two new aggregates, each placed beside the data it owns, not inside
`dashboard/services.py` itself.** `interview_coach/dashboard.py` and
`interview_coach/prep.py`'s `dashboard_progress` both query
`InterviewSession`/`InterviewAnswer`/`PrepQuestionUserState` directly —
`dashboard/services.py` calls them, it doesn't reach across the module
boundary to query interview tables itself the way its older
`_pipeline_metrics` already does for `JobApplication` (a pre-existing
pattern in this file, not repeated here).

**"Success rate" is `analytics.pipeline_funnel`'s own `offer_rate`, not a
recomputed figure.** The Applications section's active/offer/rejection
counts are pure re-groupings of `get_pipeline`'s stage buckets in Python —
zero SQL of their own.

**"Upcoming Interviews" means applications currently at an interview
stage, not a calendar.** Nothing in this schema tracks a scheduled
interview date. Interpreting the phrase as "real pipeline state" rather
than fabricating a date field was the honest reading available.

**Next actions are deterministic, reusing the same shape a fourth time.**
`_next_actions_for_dashboard` follows resume_analyzer/review.py's
`{key,label,description,href,priority}` exactly (already reused by the
Mock Interview report and, implicitly, Career Coach's framing). No LLM
call exists anywhere in this milestone.

### Fixed (caught during this milestone's own testing, not shipped as bugs)
- **The duplicate-fetch issue itself** (flagged since Milestone 3):
  `dashboard/page.tsx` fetched via react-query (profile/stats/activity)
  *and* a separate raw `useEffect` (`getDashboardOverview`) for the same
  page. `useDashboardData` now owns only onboarding/profile; the rest reads
  from one `/dashboard/home` query.
- **A pre-existing, never-triggered bug**: `user_profile.recent_activity`
  left `created_at` as a raw `datetime`, which `ActivityItemSchema` (typed
  `str`) rejects under FastAPI's response validation. No prior test called
  `/user/activity` through an actual HTTP round trip — only the service
  function directly — so this had shipped silently. Fixed at the source.
- A duplicated resume-lookup block in `job_market/router.py`, extracted
  into `job_market.services.resolve_primary_resume_text` and reused by the
  new `top_matches`.
- Two `apiClient.ts` interfaces both named `ActivityItem`, silently merged
  by TypeScript declaration merging into one over-permissive type that
  happened not to break any existing call site. Renamed Milestone 8's to
  `ApplicationActivityItem`.
- A fully hardcoded twelve-point chart fixture (`PERFORMANCE_DATA`) that
  never reflected a real scan, replaced with `analytics.summary`'s actual
  `ats_history` — this was the one clear "do not fabricate" violation this
  analysis pass turned up, on a page that had shipped it since Milestone 1.

### Verified
Backend: 19 new tests (empty-state honesty for a brand-new user, each
section's arithmetic against seeded data, next-action trigger conditions
including the stale-recruiter-stage check, `progress_buckets`' week/month
grouping) plus the full 644-test suite, zero regressions. A live
end-to-end smoke test seeding a real `JobListing` + `Profile` +
`ResumeAnalysis` and running the actual trained model — the one
integration path unit tests couldn't easily cover — confirmed the Jobs
section end to end. Frontend: TypeScript, ESLint, and production build all
clean; a real component rendered via Playwright covering a fully
populated dashboard, the brand-new-user empty state, the loading skeleton,
a 500 error state, mobile, dark mode, and the onboarding-modal gate as a
regression check.

### Remaining technical debt
- The headline `ScoreRing` still falls back to `0` when there's no ATS
  score, which reads as "Weak" for a user with no data rather than a
  neutral "no data" state — pre-existing since the original dashboard,
  not introduced or fixed here.
- List-style sections (top matches, recent activity, upcoming interviews)
  are capped at small fixed limits with no "view more" affordance beyond
  the existing linked pages — acceptable at today's realistic data volumes.
- No caching layer on `/dashboard/home` — it fans out to five services on
  every load. None of them are expensive individually (no LLM call
  anywhere in this path), but a future perf pass could memoize per-request
  if this page's load time ever becomes a concern.

### Recommendation before Milestone 10
Notifications can reuse `applications.get_activity_feed` and this
milestone's own `next_actions` derivation as real trigger sources — e.g. a
notification the moment a next-action's underlying condition becomes true
— rather than inventing a second "what happened" detector.

---

## Milestone 6 — AI Career Coach ✅

**Completed:** 2026-08-28
**Status:** Approved. Reordered ahead of Voice Interview (now Milestone 7)
at the user's explicit direction, so the platform's orchestration layer
exists before a second interview modality is added under it.

### Summary
A conversational coach that orchestrates Resume Review, Job Matching,
Interview Preparation, and Mock Interview rather than reimplementing any of
them. Every specific claim it makes is grounded in data another module
already computed — the system prompt is built from a compact context
assembled fresh on every turn (`career_coach/context.py`), not from
anything the model is asked to recall or infer. Replies stream token-by-
token over SSE; a small follow-up-suggestion call runs once the stream ends,
producing short clickable chips that re-prompt the conversation rather than
navigate away from it. Built in two explicit phases: a dedicated `/coach`
page now, with the chat and streaming logic isolated in a hook
(`useCareerCoachChat.ts`) specifically so a later floating quick-entry
assistant (Phase 2, not built) can reuse it without any backend change.

### Files created
- `backend/alembic/versions/992a070f86cb_add_career_coach_tables.py` —
  `coach_conversations` / `coach_messages`, purely additive new tables
- `backend/app/models/career_coach.py` — `CoachConversation`,
  `CoachMessage` (`ON DELETE CASCADE` — unlike interview history, a deleted
  conversation is meant to actually disappear)
- `backend/app/modules/career_coach/context.py` — grounding: latest resume
  scan (score, band, missing skills), latest completed mock-interview
  readiness, in-progress-session flag, application pipeline stats, profile —
  each pulled via the query pattern (or, for analytics/applications, the
  actual public function) the owning module already uses
- `backend/app/modules/career_coach/chat.py` — turn orchestration: persist
  the user message, stream the reply, generate follow-ups, persist the
  reply — safe under a client disconnect mid-stream (partial text is still
  saved; follow-ups are skipped as a wasted call once nobody's listening)
- `backend/app/modules/career_coach/ratelimit.py` — in-process sliding
  window, 30 messages/hour/user, the scoped limiter `ROADMAP.md` flagged as
  non-negotiable for open-ended chat
- `backend/app/modules/career_coach/router.py` — conversations CRUD plus
  the streaming send endpoint
- `backend/tests/test_career_coach.py` — 15 tests
- `frontend/src/hooks/useCareerCoachChat.ts` — chat state, TanStack Query
  for conversation/message reads, local state for the in-flight stream
- `frontend/src/components/coach/` — `CoachMarkdown`, `ConversationSidebar`,
  `MessageBubble` / `FollowUpChips`
- `frontend/src/app/(protected)/coach/page.tsx`

### Components reused
`Skeleton`, `InlineError`, `Button`/`Input`/`Textarea`, `Sheet` (mobile
sidebar, the same pattern `DashboardNav` uses), Framer Motion entrance/
stagger conventions already established across every prior milestone.
`format_sse` and the hand-rolled `StreamingResponse` pattern imported
directly from `events/router.py` rather than re-implemented.
`parseFrame`/`splitFrames` from `realtimeStream.ts` reused as-is for the
frontend's SSE parsing — both were already transport-agnostic.

### API changes (additive only, new router)
- `GET /api/career-coach/conversations`, `POST /api/career-coach/
  conversations`, `GET /api/career-coach/conversations/{id}/messages`,
  `DELETE /api/career-coach/conversations/{id}`
- `POST /api/career-coach/conversations/{id}/messages` — streams the reply
  over SSE (`token*`, then `followups`, then `done`; `error` in place of
  `followups` on failure)

### Database changes (additive only)
Two new tables, `coach_conversations` and `coach_messages`. No existing
table touched.

### Architecture decisions
**One new streaming capability on `core/llm.py`, everything else
untouched.** `ClaudeClient.stream_message()` uses a separate `AsyncAnthropic`
client specifically so the nine existing synchronous callers across every
other module needed zero changes.

**Follow-ups are one small non-streaming call after the stream ends, not a
tool-use event interleaved inside it.** Explicit simplicity choice per
direction received during analysis: two ordinary, sequential calls (one
streaming, one `complete_tool_json` — a pattern already proven everywhere
else in this codebase) are easier to reason about and test than one call
producing mixed event types on the wire.

**Suggested actions and suggested follow-up questions were unified into one
mechanism**, not built as two (a deterministic next-action engine plus a
separate conversational-continuation engine, as analysis had first
proposed). A follow-up chip re-prompts the conversation with its own text
rather than navigating anywhere; the coach still links to modules directly
via Markdown links in its prose, grounded by the same instruction that
tells it which app paths are real.

**The user's message persists before any Claude call runs, and the
assistant's message persists in a `finally` around the stream** — so a
client disconnect mid-reply keeps whatever text had been generated, and a
total LLM failure still keeps the user's own message. Verified directly: an
async generator receiving `GeneratorExit` mid-stream must not yield again
after its cleanup runs, so `stream_reply` explicitly catches `GeneratorExit`,
skips the (now-pointless) follow-up call, and re-raises after persisting.

**No live job-market grounding.** Job Matching computes scores on demand
against the feed and persists nothing beyond a saved application's
`match_score` — there is no "current matches" table to read. The system
prompt states this limitation outright rather than letting the model imply
a search it cannot perform.

### Fixed (caught during Playwright verification, not shipped)
A real race in `useCareerCoachChat`: the effect that reconciles local chat
state on a `conversationId` change was unconditionally resetting
`sending`/`sendError` at its top, including on the very transition that
`send()` itself causes when it creates a new conversation for the message
currently streaming. Because the mocked (near-instant) response often
completed before React flushed that effect, the reset silently wiped the
error banner the instant it was set. Fixed by checking "is this the
conversation I just created myself" *before* touching any state, not after.

### Verified
Backend: 15 new tests (grounding context including which figures are
surfaced honestly when absent, rate-limit windowing and per-user isolation,
turn orchestration including title derivation, bounded history, the
disconnect-safety path, and the total-failure path) plus the full 596-test
suite, zero regressions. Migration verified upgrade → downgrade → upgrade.
A live end-to-end smoke test through the real FastAPI/Starlette streaming
stack (not just mocked unit tests) on isolated SQLite, proving the
`AsyncAnthropic` stream actually reaches the client as SSE frames end to
end. Frontend: TypeScript, ESLint, and production build all clean; a real
component rendered via Playwright covering an existing conversation's
Markdown rendering (bold/list/link), the empty-state starter prompts, a
full multi-turn exchange via follow-up chip clicks, conversation delete
(two-step confirm), mobile (Sheet-based sidebar), dark mode, and the
send-error state (which is what caught the race above).

### Remaining technical debt
- The rate limiter is in-process only, like `events.py`'s in-process SSE
  fan-out — correct for a single worker, an undercount across several. Not
  a concern until this backend actually runs multi-worker (tracked with the
  same Redis-fan-out note as Milestone 10).
- No manual conversation rename; titles are derived from the first message
  only. Not requested; straightforward to add later.
- No automated accessibility audit tool was run; keyboard/ARIA patterns
  followed the same conventions already established elsewhere (verified by
  inspection).

### Recommendation before Milestone 7 (Voice Interview)
Unchanged from the note above: Voice Interview extends the Interview
Engine's `evaluation.py`/`engine.py` as-is. Separately, the Career Coach's
grounding context (`context.py`) is a natural place to add a "latest voice
session" summary once that milestone ships — no other change needed there,
since it already reads whichever `InterviewSession` rows exist regardless
of modality.

---

## Known project-wide debt (pre-existing, not introduced by any milestone)

Carried from the architecture review. Each is assigned to a milestone in
`ROADMAP.md` rather than tracked as loose work.

| Item | Severity | Target |
|---|---|---|
| CORS `allow_origins=["*"]` with `allow_credentials=True` | High — spec-invalid, red flag in any security review | M12 |
| No rate limiting on Claude-calling endpoints | High — security *and* cost-control gap | M5, M6 (scoped), M12 (comprehensive) |
| No unit tests for JWT verification (`core/security.py`) | High — the backend is the *only* authorization boundary; RLS has no policies to back it up | M12 |
| Redis-backed SSE fan-out optional, not mandatory | High at multi-instance scale — events silently drop across workers | M10 / M12 |
| `apiClient.ts` at 1030 lines (client + types + some logic) | Medium | M11 |
| Mixed data-fetching (TanStack Query vs raw `useEffect`), incl. a duplicate fetch on the dashboard | Medium | M9, M11 |
| ~1,200-var CSS compatibility bridge in `globals.css` | Medium — legacy blue/violet system aliased onto current tokens | M11 |
| 6 unused shadcn primitives + their Radix deps | Low | M11 |
| `docs/api-contract.md` stale (covers only the original 3 phases) | Low | M13 |
| `.env.example` pooler-port mismatch (5432 documented vs 6543 recommended) | Low | M13 |
| No API versioning | Low today, grows with surface area | M13 |
| No route-level `loading.tsx` / `error.tsx` anywhere | Low | M11 |
| `dashboard/services.py` calls `predict_score()` directly for `JobApplication.match_score`, independent of `job_market/matching.py`'s equivalent wrapper (found during Milestone 3's review; same underlying call, not duplicated algorithm — just an inconsistent second call site) | Low | M9 |

---

## Future enhancements (identified, not scheduled)

- Resume version history and side-by-side version comparison (specified for the
  Resume Studio module; not yet built).
- Incremental progress reporting on `POST /analyze` to unify loading UX quality
  with `/resume/tailor`.
- `/history` → tailor-workspace deep link.
- **Experience Match** — a structured years-of-experience field (profile input,
  or a deterministic parser over the resume's dated experience section) would
  let this compare against the job side's existing 4-bucket enum.
- **Education Match** — needs degree/field extraction on the resume side, and
  an education-requirement field added to `enrichment.py`'s schema on the job
  side — the latter means touching the job ingestion pipeline, which Milestone
  3 was explicitly scoped not to do.
- **Salary Match** — needs a numeric parser over `salary_range` (job side) and
  a desired-salary field on `Profile` (user side).
- **Location Match** — needs a preferred-location / remote-only field on
  `Profile`; the job side already has `location` and `work_mode`.
- A true data-driven "Recommended Actions" list for job listings, matching
  Resume Review's `next_actions` pattern exactly, if the existing
  `JobDetailDrawer` buttons (Match resume / Practice / Save / Apply / Cover
  letter / Tailor) ever stop being sufficient.
