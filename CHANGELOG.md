# Changelog

All notable changes to Zenith (ApplyCenter) are recorded here.

This file is **append-only** — new entries go at the top, previous history is
never rewritten or removed. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601.

Entries above `0.1.0` were reconstructed from git history when this file was
introduced (2026-08-27), so they summarise commits rather than having been
written at the time.

---

## [Milestone 11] — Platform Polish & User Experience — 2026-09-02

Ten milestones of feature work left the product cohesive within each module
and inconsistent across them. This pass treats the app as one platform.

### Fixed — discoverability
- **Analytics, Reports and Offers had no inbound link anywhere in the
  product.** Three finished pages reachable only by typing the URL. All
  three now appear in the sidebar under a new "Insights" group (Analytics,
  Reports, History), with Offers promoted to its own entry.
- **The ⌘K palette had not been updated since Milestone 5** — Career Coach
  and the Application Tracker, the two largest features, were absent, along
  with Offers and Policy News. All five added. `/cover-letter` deliberately
  left out: it needs a `job_id` from the Job Market drawer, so arriving cold
  lands on a page the user cannot act on.
- **The top bar showed "Overview" on any route not in the sidebar** —
  Analytics, Reports, Offers, Cover Letter and both resume sub-pages all
  displayed the wrong page title. Now resolved from the nav groups plus an
  explicit map for contextual routes.
- "Applications & Offers" renamed to "Applications" — it never led to Offers.

### Fixed — honesty
- **Settings' "Save preferences" button had no `onClick` at all.** There is
  no preferences endpoint and no column on `profiles` to store any of it, so
  the toggles were always a local-only preview. Rather than wire a toast that
  would fabricate success, the button is disabled with a line stating plainly
  that preferences aren't stored yet.
- The dashboard trend chart drew its grid, tooltip cursor and active-dot ring
  from hardcoded `#1e1e1e` / `#262626` / `#0A0A0A` — dark-theme values baked
  in, so on porcelain the gridlines rendered near-black. Now reads the
  existing `useChartTheme()` that Analytics and History already used.

### Added
- `components/PageHeader.tsx` — one header for every workspace route,
  replacing three `<h1>` treatments (`font-medium italic` vs `font-semibold`,
  breaking at `sm:` vs `md:` vs not at all), two eyebrow classes, and
  entrance animations some pages had and others didn't. Applied to nine
  pages: analytics, applications, cover-letter, history, jobs, offers,
  profile, reports, settings.
- `components/ui/toast.tsx` — the product had no success-feedback layer at
  all. Built in-house (one context, one list, one animated element) rather
  than adding a dependency. `role="status"` + `aria-live="polite"`, capped at
  three visible, errors held longer than successes.
- Toasts wired to the mutations that previously failed **silently**: the
  optimistic move/delete on Applications and delete on Offers all rolled back
  with no user-facing message, so a failed action just made the card reappear
  with no explanation.

### Changed — consistency
- `.eyebrow`, `.section-eyebrow` and `.section-eyebrow-violet` were three
  aliases for one identical rule. `.section-eyebrow` was unused; the "violet"
  name was a leftover from a palette this product no longer has (it rendered
  `ink-dim`). Collapsed to `.eyebrow`, 13 call sites renamed.
- Settings and Profile each re-implemented Radix Select inline, shadowing
  `ui/select.tsx`; Settings did the same for Switch. The local copies had
  drifted — a hardcoded `bg-white` thumb, a
  `shadow-[0_20px_60px_rgba(0,0,0,0.6)]` popover far too heavy for porcelain,
  and `focus:outline-none` with only a border colour to signal focus. Both
  pages now compose the shared components.

### Performance
- recharts (~360KB, the largest chunk in the bundle) is now lazily loaded on
  the dashboard via `next/dynamic` — the trend chart is the last block on the
  page, below the fold on every viewport. Analytics and History still import
  it directly, correctly: there the chart *is* the page.
- Removed 7 dependencies with zero references anywhere: `react-hook-form`,
  `zod`, `@hookform/resolvers`, `react-dropzone`, `@radix-ui/react-checkbox`,
  `@radix-ui/react-scroll-area`, `@radix-ui/react-tooltip`.

### Verified
TypeScript, ESLint and production build clean; 676 backend tests pass. A
Playwright sweep across 4 viewports × 7 routes (28 combinations) found zero
horizontal overflow and zero console errors. Toast live region, keyboard
reachability and focus-ring visibility confirmed in both themes.

---

## [Milestone 10] — Notifications — 2026-09-01

Before writing any code: grepped the whole backend for `event_manager.publish(`
and the frontend for `useRealtimeStream(` (the call site, not the
definition). Both came back empty — the SSE pub/sub in `core/events.py` and
the `useRealtimeStream` hook had existed since Milestone 6 but nothing had
ever published a domain event or mounted the hook. This milestone is
therefore both a new persistent Notification Engine and the first real
wiring of that dormant realtime channel end to end.

### Added
- `notifications` table (additive migration) — type/category/priority/title/
  message/href/dedupe_key/group_key/occurrence_count/read_at/archived_at/
  expires_at.
- `notifications/service.py` — the engine. One insertion path
  (`create_notification`) deciding dedupe (permanent or windowed),
  grouping (fold into an active related row instead of inserting), and
  expiration, then best-effort live push via the existing `event_manager`.
  Plus list/unread-count/mark-read/mark-all-read/archive, two event-driven
  triggers, and `check_periodic` — a dedupe-guarded sweep for the
  time-based types, piggybacked on `GET /api/dashboard/home` rather than a
  new scheduler this project has no infrastructure for.
- `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`,
  `POST /api/notifications/{id}/archive`.
- Event-driven triggers: a resume scan's score change/needs-attention
  (`resume_analyzer/router.py`'s `/analyze`), an application's status
  change and interview-stage-reached (`applications/services.py`'s
  `update_application`, at the exact point that already detects the
  transition).
- Periodic triggers (via `check_periodic`, run from `/dashboard/home`):
  mock/voice interview reminders, practice streaks, a follow-up reminder
  (reusing Milestone 9's own `_stale_recruiter_stage_application`), Career
  Coach suggestions (resume advice, interview advice, suggested learning —
  each linking into `/coach?prompt=...`), weekly/monthly progress, career
  milestones, and grouped high-match-job alerts.
- `NotificationBell` + Notification Center popover — unread badge, priority
  dots, category + relative-time labels, grouped "+N more" chips, mark-
  read/mark-all-read/archive — replacing the static, non-functional bell
  placeholder in `DashboardNav.tsx`.
- `useRealtimeStream` mounted for the first time anywhere in the app, inside
  the new `useNotifications` hook — one line added to its existing
  `INVALIDATIONS` map (`notification` → `['notifications']`).
- `components/ui/popover.tsx` — thin wrapper over `@radix-ui/react-popover`,
  already a dependency with no existing shadcn wrapper.

### Architecture decisions
- **Dedupe is checked before grouping.** An early version looked up an
  existing row by dedupe_key first and only then checked its group_key,
  which meant a second *distinct* event meant to join a group (e.g. a
  second high-match job the same week) never found the group and just
  inserted its own row. Caught by a unit test asserting the second call
  returns the first call's row; fixed by checking "has this exact event
  fired" independently of "is there a group to join."
- **Grouping is exercised by one real trigger** (`high_match_job`, scoped
  to the ISO week), not left as untested engine capability — every other
  trigger names one specific, individually meaningful event where
  collapsing multiple into one row would destroy information.
- **Live push is best-effort, never the source of truth.** A caller with no
  `BackgroundTasks` (every periodic check) simply doesn't push live; the
  Center always re-fetches from the database on mount, so a missed push
  never produces stale-but-wrong state.
- **Multi-instance SSE fan-out was already solved, not reimplemented.**
  Publishing goes through the existing `event_manager` singleton, which
  already selects `RedisEventManager` over the in-process one whenever
  `REDIS_URL` is set — the risk `ROADMAP.md` flagged for this milestone is
  now purely an operational setting, not a code gap.
- **Three spec-named types honestly consolidated rather than fabricated**,
  matching this project's established pattern (Milestone 3's deferred
  Experience/Education/Salary Match, Milestone 9's "Upcoming Interviews"):
  "Interview Scheduled"/"Interview Date Approaching" → `interview_stage_reached`
  (no calendar or scheduling feature exists to name a real date against);
  "Match Score Improved" omitted (job matches are computed fresh per
  request by design, so there is no per-user/per-job score history to
  diff); "Resume Health Improved"/"ATS Score Changed" → one
  `resume_score_changed` type whose title reflects direction.

### Fixed
- The dedupe/grouping ordering bug above, caught by its own test before it
  ever reached a real trigger.
- A migration branch-point error: the new migration's `down_revision`
  initially targeted `992a070f86cb` (a branch point, not the chain's actual
  tip), producing two `alembic heads`. Corrected to descend from
  `23061ee9a125`, Milestone 8's migration — the true prior tip, since
  Milestone 9 added none.

### Database
One additive migration: `notifications`, with CHECK constraints on
type/category/priority mirroring `job_applications.status`'s existing
pattern, RLS enabled with zero policies. Verified upgrade and downgrade
against a scratch SQLite database built from the full 25-revision chain.

### Verified
Backend: 32 new tests (dedupe permanence/windowing, grouping semantics
including the fixed ordering bug, expiration, ownership isolation, both
event-driven triggers through a full router round trip, periodic-sweep
idempotency, the job-match grouping trigger) plus the full 676-test suite,
zero regressions. Frontend: TypeScript/ESLint/build clean; a real component
rendered via Playwright covering the badge, the open popover with grouping
and mixed priorities, mark-all-read against a stateful mock, empty state,
error state, loading skeleton, mobile, and dark mode.

---

## [Milestone 9] — AI Career Dashboard — 2026-08-31

The home page after login, answering one question: "what should I do next
to improve my chances of getting hired?" Composed entirely from what the
Resume, Job Matching, Interview, Application, and Career Coach engines
already compute — no new score, no new matching logic anywhere in this
milestone.

### Added
- `GET /api/dashboard/home` — the one request the dashboard makes, built
  from `user_profile.dashboard_stats`, `analytics.summary`,
  `applications.get_pipeline`/`get_activity_feed`, and
  `job_market.services.top_matches` (new, but a thin top-N wrapper over the
  same `get_jobs`/`attach_matches` the main feed already uses).
- Two small, genuinely new aggregates, each living beside the data it
  aggregates rather than reaching across module boundaries:
  `interview_coach/dashboard.py`'s `dashboard_summary` (completed-session
  average score, voice-answer count) and `interview_coach/prep.py`'s
  `dashboard_progress` (prep completion count).
- `analytics.services.progress_buckets` — a pure re-grouping of
  `ats_history` into weekly/monthly points, not a second query.
- Deterministic "What to do next" recommendations (`_next_actions_for_dashboard`),
  the same `{key,label,description,href,priority}` shape Resume Review and
  the Mock Interview report already use, reused a fourth time. Reacts to
  real state: no resume scanned, no completed interview, an empty pipeline,
  or an application sitting untouched at an early interview stage for 5+
  days with a recruiter contact on file.
- `frontend/src/components/NextActionCard.tsx` — extracted from two
  byte-for-byte-identical copies (Resume Review, Mock Interview report) into
  one shared component; both call sites now use it.
- A real "Resume Improvement Trend" chart, replacing a fully hardcoded
  twelve-month fixture array that never reflected an actual scan.

### Fixed
- **The known duplicate-fetch issue** (flagged since Milestone 3): the
  dashboard page fetched its data two ways at once — react-query for
  profile/stats/activity, a separate raw `useEffect` for pipeline metrics
  and fresh jobs. Consolidated onto one `/dashboard/home` react-query call;
  `useDashboardData` now owns only onboarding and the profile.
- **A pre-existing, never-triggered bug** in `user_profile.recent_activity`:
  `created_at` was left as a raw `datetime` instead of an ISO string, which
  FastAPI's response validation rejects — undiscovered until Milestone 9
  reused the function through an endpoint whose response was actually
  exercised end-to-end. Fixed at the source, so `/user/activity` is correct
  too, not just the new endpoint.
- A duplicated resume-lookup block in `job_market/router.py`, extracted into
  `job_market.services.resolve_primary_resume_text` and reused by both the
  router and the new `top_matches`.
- Two interfaces both named `ActivityItem` in `apiClient.ts` (a user-level
  one and an application-status one from Milestone 8), silently merged by
  TypeScript's declaration merging into a permissive union that happened not
  to break at any existing call site. Renamed the latter to
  `ApplicationActivityItem`.
- `analytics.pipeline_funnel`'s naive/aware datetime handling, hit by the
  new "stale recruiter stage" next-action check on SQLite's naive
  timestamps — reused the module's own existing `_as_utc` helper.

### Database
None. Every figure is read from existing tables through existing or
newly-composed read paths — no migration in this milestone.

### Verified
Backend: 19 new tests (empty-state honesty, section-by-section correctness,
next-action triggering conditions, `progress_buckets`) plus the full
644-test suite, zero regressions; a live end-to-end smoke test seeding a
real `JobListing` and running the actual trained model to confirm the Jobs
section's hardest integration path. Frontend: TypeScript/ESLint/build
clean; a real component rendered via Playwright covering a fully populated
dashboard, the empty state, the loading skeleton, an error state, mobile,
dark mode, and the onboarding-modal regression path.

---

## [Milestone 8] — Intelligent Application Tracker — 2026-08-30

Upgraded the 5-stage pipeline into a real hiring-pipeline tracker, and made
it the one place that reads across every other engine — Resume, Job
Matching, Interview, and Career Coach — rather than a fifth isolated module.

### Added
- 12 pipeline stages (from saved/applied/interviewing/offer/rejected) —
  Recruiter Contacted, Recruiter Screening, Online Assessment, Technical/
  Manager/Final Interview, Accepted, and Withdrawn now exist as real stages
  instead of one catch-all "interviewing" bucket.
- `application_status_history` — one row per status change, timestamped.
  Backfilled with a synthetic "arrival" row for every pre-existing
  application so the Timeline is never empty for old data.
- `GET /api/applications/{id}` — the detail view's one request: status
  history plus whatever the Resume, Job Matching, and Interview engines
  already know about this application (resume used, job match breakdown,
  interview readiness) — pure aggregation, no new scoring anywhere.
- `GET /api/applications/activity` — every status change across the whole
  pipeline, newest first; powers the new Timeline view.
- Kanban board real drag-and-drop (`@dnd-kit/core`), a List view (sortable
  table), and a Timeline view (activity feed) — three ways to look at the
  same pipeline data. The existing per-card stage `<select>` stays as the
  keyboard/screen-reader-accessible way to move a card without dragging.
- `ApplicationDetailDrawer` — recruiter contact fields, notes, resume used,
  job match, interview readiness with a practice link, four Career Coach
  quick-prompt links, and the per-application timeline.
- `recruiter_name` / `recruiter_email` fields, and `match_score` (already
  computed lazily elsewhere) now exposed read-only through this API.

### Changed
- `analytics.pipeline_funnel`'s `reached_interviewing` / `reached_offer` now
  query `application_status_history` for "ever reached this stage", instead
  of approximating from current `status` alone — which previously
  under-counted a card rejected after progressing. The old ordinal
  approximation's limitation was disclosed at the time; the new table makes
  it exact.
- `dashboard`'s `SENT_STAGES` / stage-count dict now derive from
  `APPLICATION_STATUSES` instead of a second hardcoded 5-item list, so a
  future stage addition can't silently fall out of that count again.

### Database (additive + one disclosed remap)
New `application_status_history` table. `job_applications` gains
`recruiter_name`, `recruiter_email`, and a widened status CHECK constraint.
Existing `'interviewing'` rows are remapped to `'recruiter_screening'` — the
least presumptuous read of "somewhere in the interview process" available,
since the old scheme never recorded which round was reached. Migration
verified upgrade → downgrade → upgrade with real seeded data.

### Verified
Backend: 17 new tests (status history recording, the activity feed, and the
detail view's aggregation across all three engines) plus the full 625-test
suite, zero regressions — including the pre-existing analytics/dashboard/
applications tests whose fixtures hardcoded the old 5-stage scheme, updated
rather than left broken. Frontend: TypeScript/ESLint/build clean; a real
component rendered via Playwright covering a genuine mouse-simulated
drag-and-drop move (not just the select fallback), List view sorting,
the Timeline feed, the full detail drawer (all four engine sections,
recruiter-field editing, stage change, Escape-to-close), delete, mobile,
dark mode, and the add-application regression path.

---

## [Milestone 7] — Voice Interview — 2026-08-29

Spoken answers as an alternative input method on top of the existing
Interview Engine — not a second interview system. The engine, evaluation
pipeline, and reports are byte-for-byte unchanged from Milestone 5; voice
only ever produces a plain `answer_text` string that enters the exact same
`/evaluate` call a typed answer would.

### Added
- `backend/app/modules/interview_coach/voice.py` — Deepgram Nova-3
  integration: retries transient 5xx/timeout failures (not 4xx, which would
  fail identically every time), and derives `speaking_duration_seconds`,
  `average_confidence`, `speaking_rate_wpm`, `long_pause_count` (from
  Deepgram's word-level timestamps), and `filler_word_count` (our own
  deterministic match against the returned words, computed from the
  original unedited transcript so a later manual edit can't distort it) —
  each field independently omitted, never fabricated, if its inputs are
  missing.
- `POST /api/interview/transcribe` — the one new endpoint. Pure
  transformation (audio in, transcript + voice_metrics out); touches no
  session/question/answer row and stores no audio anywhere, at any point.
- `frontend/src/components/interview/VoiceAnswerComposer.tsx` — Record /
  Pause / Resume / Stop / Replay / Re-record via `MediaRecorder` (not the
  Chrome-only `SpeechRecognition` API), with upload-progress reusing the
  exact pattern `analyzeResume` already established. Once a transcript
  arrives it hands off entirely to the page's existing Textarea + Submit
  button — that pair already *is* the transcript-preview/edit/accept step,
  so no separate accept UI was built.
- An "Input method" toggle (Type / Speak) on the Mock Interview setup
  screen, alongside the existing seniority and category pickers.
- A "Voice observations" section in the per-question feedback view —
  informational only, never blended into the seven-dimension score.

### Database (additive only)
One nullable `voice_metrics` column on `interview_answers`. Null for every
existing row and for every typed answer going forward.

### Privacy
No raw audio is ever written to disk or the database — bytes exist only for
the duration of the `/transcribe` request, forwarded to Deepgram and
discarded. `DEEPGRAM_API_KEY` is server-side only.

### Verified
Backend: 12 new tests (successful transcription, omitted-not-fabricated
metrics, retry-then-succeed, no-retry-on-4xx, exhausted-retries, timeout,
malformed response, pause detection) plus the full 608-test suite, zero
regressions; a live end-to-end smoke test through the real ASGI stack
(Deepgram itself mocked at the httpx transport layer — no real API key
exists in this environment). Migration verified upgrade → downgrade →
upgrade. Frontend: TypeScript/ESLint/build clean; a real component rendered
via Playwright with a faked `MediaRecorder`/`getUserMedia` covering the full
record→stop→transcript→edit→submit flow, re-record, mic-permission-denied,
unsupported-browser, a transcription failure, mobile, dark mode, and a
regression pass confirming Text mode is completely unaffected.

---

## [Milestone 6] — AI Career Coach — 2026-08-28

The central intelligence layer: a conversational coach that orchestrates
Resume Review, Job Matching, Interview Preparation, and Mock Interview rather
than reimplementing any of them. Reordered ahead of Voice Interview (now
Milestone 7) at the user's explicit direction.

### Added
- `backend/app/modules/career_coach/context.py` — grounding, not
  generation: pulls the user's latest resume scan, completed mock-interview
  readiness, and application pipeline from the modules that already compute
  them (`analytics.summary`, `applications.get_pipeline`, `rubric.band()`),
  formatted into the chat system prompt so every claim traces to real data.
  Deliberately excludes live job-market search — Job Matching scores listings
  on demand and persists nothing beyond a saved application's `match_score`,
  so the prompt says so rather than implying a search it can't do.
- `POST /api/career-coach/conversations/{id}/messages` — a real-time
  streamed reply over Server-Sent Events, reusing `events/router.py`'s
  hand-rolled SSE framing and fetch-based auth pattern (`format_sse`,
  Bearer-only, no `EventSource`) rather than a second transport.
  `ClaudeClient.stream_message()` is the one new capability on `core/llm.py`
  — an `AsyncAnthropic`-backed generator; every other method there stays
  synchronous and untouched.
- Follow-up suggestions as short, clickable chips (`{response, follow_ups}`)
  generated by one small non-streaming `complete_tool_json` call after the
  streamed reply finishes — two ordinary sequential calls, not interleaved
  tool-use inside the stream, by explicit choice for simplicity.
- `coach_conversations` / `coach_messages` tables, additive only. Unlike the
  interview tables, deleting a conversation actually deletes its messages
  (`ON DELETE CASCADE`) — chat history carries no scoring value once
  discarded.
- A scoped in-process rate limiter (30 messages/hour/user) on the one
  endpoint with no natural per-action cost ceiling — the risk `ROADMAP.md`
  flagged for whichever milestone shipped open-ended chat.
- `frontend/src/hooks/useCareerCoachChat.ts` — chat state and streaming
  decoupled from the `/coach` page itself, so the planned Phase 2 floating
  assistant can reuse it without touching the backend.
- `frontend/src/components/coach/CoachMarkdown.tsx` — Markdown rendering
  (`react-markdown` + `remark-gfm`, the one new frontend dependency this
  milestone needed) with internal links routed through Next's `Link`.

### Verified
Backend: 15 new tests (grounding context, rate limiting, turn orchestration
including disconnect-safety and title derivation) plus the full 596-test
suite, zero regressions; a live end-to-end smoke test through the actual
FastAPI/Starlette streaming stack on isolated SQLite. Frontend: TypeScript/
ESLint/build clean; a real component rendered via Playwright covering
markdown rendering, multi-turn conversations, follow-up chips, conversation
delete, mobile, dark mode, and the send-error state — the last of which
caught a real race (a reconciliation effect was unconditionally resetting
`sending`/`sendError` on the very conversation-creation transition `send()`
itself caused, wiping the error message before it rendered), fixed and
re-verified.

---

## [Milestone 5] — AI Mock Interview (Text) — 2026-08-27

The scored practice loop on top of Interview Preparation (Milestone 4),
establishing the **Interview Engine** — session lifecycle, question
sequencing, evaluation, and reporting — that Voice Interview and a future
Live AI Interview extend rather than rebuild.

### Added
- `backend/app/modules/interview_coach/engine.py` — session start/resume/
  abandon, sourcing questions directly from Interview Preparation's cache
  (`prep.get_prep_questions`) instead of a second generation path.
- `backend/app/modules/interview_coach/evaluation.py` — every answer scored
  across seven named dimensions (Technical Accuracy, Completeness,
  Communication, Structure, Problem Solving, Relevance, Practical
  Thinking), with strengths/weaknesses/missing points/learning suggestions
  that each state *why*, plus a rewritten improved answer.
- `backend/app/modules/interview_coach/reports.py` — one Claude call per
  completed session for the narrative (performance summary, topics to
  improve, practice plan); scores, dimension averages, and strongest/
  weakest rankings are computed deterministically from data already on
  file.
- `GET /api/interview/sessions/active`, `POST /api/interview/sessions/{id}/
  abandon`, `GET /api/interview/sessions/{id}/report` — Resume Interview,
  Restart Interview, and the final report. Exit Interview and Continue
  Later needed no new endpoint: every answer already persists on
  submission, so "resuming" is just re-fetching the active session.
- `frontend/src/lib/interviewCategories.ts` — one category vocabulary
  (HR/Technical/Behavioral/Screening/Scenario), shared by Interview
  Preparation and Mock Interview instead of two independent lists.
- A full final-report UI: overall score, readiness band (reusing
  `rubric.band()`), per-dimension performance bars, strongest/weakest skill
  chips, topics to improve, practice plan, and next-action cards.

### Changed
- Mock Interview now sources questions from Interview Preparation's shared
  cache and covers one category per session, replacing the old client-side
  `categorize()` heuristic that bucketed questions into
  fundamentals/system_design/real_world — a scheme where `system_design`
  was permanently unreachable, since the backend only ever emitted
  `"technical"`/`"behavioral"`.
- `POST /api/interview/model-answer` now serves a Prep-sourced question's
  own `ideal_answer` directly, with no LLM call, instead of generating a
  second, independent model answer.

### Fixed
- A pre-existing layout bug on the Mock Interview setup screen: `.eyebrow`
  labels (`display: inline-flex`) rode up onto the same line as a preceding
  inline-flex control row instead of starting their own. Newly visible
  because this milestone's Category section repeated the pattern a second
  time; fixed at all three affected labels.

### Database (additive only)
New nullable columns (or NOT NULL with a server default) on
`interview_sessions`, `interview_questions`, and `interview_answers`.
`feedback`/`improvement_tips` relaxed to nullable rather than dropped — old
answers keep their exact original shape. No column dropped, no row
rewritten. Migration verified upgrade → downgrade → upgrade.

### Verified
Backend: 21 new tests plus the full 581-test suite, zero regressions.
Frontend: TypeScript/ESLint/build clean; a real component rendered via
Playwright with network interception covering the full session flow,
resume, restart (confirming the abandon call fires), exit (confirming it
does not), mobile, dark mode, and the setup-error state.

---

## [Milestone 4] — AI Interview Preparation — 2026-08-27

A teaching module distinct from Mock Interview (Milestone 5) — every
question returns its full answer, explanation, and context the moment it's
fetched, nothing gated behind an attempt.

### Added
- `GET /api/interview/prep/questions`, `PATCH /api/interview/prep/questions/
  {id}/state` — five categories (HR, Technical, Behavioral, Screening,
  Scenario), each question carrying difficulty, estimated answer time, an
  ideal answer, a concept explanation, a beginner-friendly explanation, a
  real-world example, interviewer intent, tips, common mistakes, keywords,
  and follow-up questions.
- Shared cache keyed by role + category + difficulty + prompt version +
  model version — the version axis lets a future prompt or model change
  mint new content without invalidating or mixing with old rows.
- Bookmark, completion, and personal notes — the one per-user layer, kept
  separate from the shared question cache.

### Fixed
- The "N of M marked complete" progress counter never updated after a
  toggle, because a question card's bookmark/completed state was purely
  local and never reached the parent's aggregate. Added an `onStateChange`
  callback to lift state changes up; caught and verified via Playwright.

### Verified
Backend: cache hit/miss, role normalization, per-category/per-user
isolation, partial-update safety, all on isolated SQLite. Frontend: real
component rendered via Playwright across light/dark and desktop/mobile.

---

## [Milestone 3] — AI Job Matching — 2026-08-27

A matching engine layered on top of the existing job feed. **No changes to job
ingestion, caching, or fetch logic** — `GET /api/jobs` gains one additive field.

### Added
- `backend/app/modules/job_market/matching.py` — a small provider registry
  (`MatchContext` in, dimension dict or `None` out). Two providers ship:
  **Resume Match** (thin wrapper around the existing `predict_score()`) and
  **Skills Match** (taxonomy-aware overlap against `JobListing.skills`).
  Overall Match is Resume Match's own score — never blended with Skills
  Match, so each dimension stays inspectable on its own.
- Missing-skill "priority" ranking by cross-feed frequency: the skill most
  worth learning is the one blocking the most of what's currently on screen,
  not just one listing — computed from data already gathered, no new source.
- A deterministic, template-based match explanation (no LLM call), built
  from real matched/missing counts and reusing `rubric.band()`'s tier words.
- `frontend/src/lib/jobSort.ts` — Best Match / Newest / Recently Posted /
  Salary / Company, standalone so a future Dashboard or Career Coach surface
  can sort the same job list the same way.
- Match% badge on the job card; a full match breakdown (ring, matching/
  missing skills, explanation, learning callout) in `JobDetailDrawer`,
  replacing the plain skills list only when a match exists.
- "Sorted by Best Match based on your latest resume." defaults on the first
  scored feed load, then never re-overrides a manual sort choice.

### Not implemented (by design, not oversight)
Experience, Education, Salary, and Location Match — none have reliable
structured data on one or both sides today (see `PROJECT_STATUS.md`'s
Milestone 3 section for the exact gap per dimension). Fabricating a score
for any of them would violate the same "no unexplained numbers" principle
Resume Review's Grammar category already established.

### Fixed (Resume Review refinement, same day)
- `ScoreRing` had its own independent band vocabulary (Strong/Competitive/
  Needs work/At risk at 80/60/40), disagreeing with the backend's own band
  string for the same score. Unified onto one shared system
  (`scoreBands.ts` / `rubric.band()`), which Job Matching then adopted from
  the start rather than inventing a third.
- `tailor_resume`'s next-action href pointed at a route that hard-requires a
  job-listing id it could never have in job-specific Resume Review mode — a
  guaranteed dead end. Repointed correctly; regression-tested.
- Two hardcoded links duplicating the AI-generated Next Actions row, once
  the fix above made the generated version correct.
- A color-only accessibility gap in `RecommendationCard`'s priority
  indicator, introduced in Milestone 2 itself.

### Verified
Backend: 9 new tests plus a live smoke test through the real endpoint on
isolated SQLite. Frontend: TypeScript/ESLint/build clean; real component
rendered via Playwright with network interception, proving actual sort
reordering (not a fixture coincidence) and the no-resume graceful-skip path.

---

## [Milestone 2] — AI Resume Review — 2026-08-27

A categorised, explained review layered onto the resume-analysis pipeline,
surfaced inside Resume Studio rather than as a separate page.

### Added
- `GET /api/resume/review/{analysis_id}` (job-specific) and
  `POST /api/resume/review/general` (resume-only, stateless — not persisted,
  since `resume_analyses` has `NOT NULL` columns a JD-less scan can't fill).
- Resume Health (job-independent in both modes, by design — verified live at
  identical scores in each mode for the same resume) and Job Match (the
  trained model's own score, shown separately, never blended).
- Per-category reasoning: what the metric measures, what *this* resume did,
  and what to do about it. Grammar shipped declared-but-unavailable rather
  than silently absent — a category the user can see is missing is honest.

### Fixed
- `extract_text`'s `ValueError` for unsupported file types wasn't caught in
  the new general-review handler — caught during live verification before
  ship, would have been a 500 instead of a 400.

---

## [Milestone 1.5] — Engineering cleanup — 2026-08-27

Quality and maintenance pass over the Milestone 1 files. No new features, no
redesign, no API/schema changes.

### Fixed
- **Dead exit animations.** `AnimatePresence mode="wait"` had stopped
  sequencing because the view `key`s were moved inside the child components,
  where the parent cannot see them — every transition had silently become a
  hard cut. Keys hoisted back to the call site.
- **Data loss on the build-mode toggle.** `ResumeBuilderPanel` was
  conditionally mounted, so switching to Quick tailor and back wiped every
  field the user had typed. Replaced the two buttons with Radix `Tabs` +
  `forceMount`, keeping both panels alive.
- **Segmented-control accessibility.** Active mode was conveyed by colour
  alone. Now carries `role="tab"` / `aria-selected` with arrow-key navigation.
- Added `role="alert"` / `role="status"` / `aria-live` to error, success, and
  progress surfaces that were previously silent to assistive tech; `aria-busy`
  on the generating button; accessible names on the dropzone and job-description
  field; `preventDefault` on Space activation.

### Changed
- `ScanningState` → `ScanProgressPanel`, `ScanResults` → `ScanResultsPanel`,
  matching the folder's naming convention.
- Scan-progress timers and narration constants moved into
  `ScanProgressPanel`, removing an inverted dependency where the page imported
  them back out of a presentational component.
- Shared `scanShared.ts` now owns the three union types and the easing
  constant that had been duplicated across files.
- Added `InlineError` for the error banner duplicated across two components.
- Keyword partitioning memoised (four filter passes per render → one).

---

## [Milestone 1] — Resume Studio — 2026-08-27

Consolidation of the resume workflow into one coherent workspace. **No backend,
API, schema, or database changes** — this milestone was entirely a frontend
structure and navigation change.

### Changed
- `frontend/src/app/(protected)/resume/page.tsx` reduced from 827 lines to ~230.
  It is now a thin orchestrator: it owns all scan/tailor state and handlers, and
  renders one of three views based on scan status.
- The post-scan UI no longer stacks the quick-tailor action and the full resume
  builder in a single scroll. They are now presented as an explicit choice via a
  segmented control (**Quick tailor** / **Rebuild in the Studio**), because they
  are two different backend paths producing two different kinds of PDF.

### Added
- `frontend/src/components/resume/ScanUploadForm.tsx` — upload + job-description
  entry (idle/error state).
- `frontend/src/components/resume/ScanningState.tsx` — scan progress narration.
- `frontend/src/components/resume/ScanResults.tsx` — score, tabs, diagnostics,
  and the new build-mode segmented control.
- A "Have a specific job in mind? Tailor for that posting" link into `/jobs`,
  making the `/resume/tailor` split-view workspace discoverable from `/resume`.
  Previously it was reachable *only* via a `?job=&analysis=` query-param handoff
  from a job card, so a user starting at `/resume` never found it.

### Fixed
- Stage/flavour-line counts in the scan loading state are now derived from the
  exported `STAGES` / `FLAVOR_LINES` arrays instead of hardcoded integers, so the
  page and the component cannot silently desync if either list changes.

### Notes
- Behaviour-preserving by design: every existing endpoint call, component
  internal, and both PDF-generation code paths were left untouched.
- Validated against desktop (1440px), tablet (768px), and mobile (375px) in both
  light and dark themes; production build, typecheck, and lint all clean.

---

## [0.1.x] — Pre-milestone history (reconstructed from git) — 2026-07-11 → 2026-08-26

Development prior to the milestone-based roadmap. Summarised by theme rather
than per-commit.

### Auth & accounts
- Migrated auth to Supabase; added social sign-in, then deliberately reduced the
  provider set to **Google only** (`2adaaf5`) after dropping LinkedIn, GitHub,
  and Apple as unused account-linking attack surface. Apple specifically was
  dropped because its client secret is a JWT capped at 6 months, requiring an
  ongoing renewal owner.
- Added an OAuth provider readiness check (`npm run check:oauth`) and the real
  callback URL (`f2e4896`).

### Resume analysis
- Served the trained ATS model for live scoring (`51dabe8`).
- Added skill taxonomy, bullet quality, and layout diagnostics (`80110ee`).
- Added deterministic score breakdown and parse-compatibility checks (`7b7f6bd`).
- Added resume CRUD, builder autofill reading the form back out of the uploaded
  resume (`26e6c93`), and a real-progress stepper (`cce2693`).
- Added split-view tailoring behind an acceptance gate (`df86742`) and the FAANG
  filename convention with a read-only tailoring preview (`456e7a0`).
- Added grounded cover-letter generation plus three real parse checks (`8d48792`).

### Jobs, applications & dashboard
- Added Apify ingestion, dashboard feeds, and the us-east-1 migration (`a829feb`).
- Added jobs, applications, offers, analytics, and prep API modules (`357ae0c`)
  with the matching UI views (`1ae49f5`).
- Added pipeline KPIs and moved policy news to its own route (`6773d08`).
- Eliminated an N+1 on the job feed by not deferring description (`2684b8c`).

### Data & infrastructure
- Added profile, job, application, offer, and story tables (`d0c581c`).
- Enabled row-level security on all public tables (`e58e723`) — deny-by-default,
  since the FastAPI backend connects as table owner and bypasses RLS; this is
  defence-in-depth against the PostgREST surface, not the primary control.
- Added Supabase project config so the GitHub integration can link (`047403f`).
- Pinned CI to Python 3.12 (numpy 2.5.1 resolution) and Node 24, and made the
  lockfile reproducible for `npm ci`.

### Design system
- Rebuilt the design foundation on Tailwind v4 and a tokenised palette
  (`7b4a99d`) — the "Porcelain & Obsidian" system.
- Migrated all routes to the primitives and fixed the contrast bugs that exposed
  (`db538ec`).
- Redrew the logomark, added scroll-aware nav and a command palette (`50e84ad`).
