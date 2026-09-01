# Zenith — Development Roadmap

The implementation order for the remainder of the project. Sequenced around the
**core user experience** of a premium AI Career Operating System, with
engineering-risk findings attached to the milestone that actually introduces
each risk rather than batched into a separate hardening phase.

This file is **append-only** for status — milestones are marked complete in
place, never deleted. Revisions to the plan itself are recorded at the bottom.

**Reference:** the full product specification (all 10 modules, UX principles,
design system) is the long-term vision document. This roadmap is the
*execution order* against it. A milestone is only implemented when explicitly
requested.

**Numbering:** unified as of 2026-08-27. Earlier revisions of this file
numbered milestones by the original plan, which put AI Job Matching at #7 and
Interview Preparation at #3 — the two features were then built in the reverse
of that order at the user's direction, which produced a confusing "two
numbering systems" situation for one revision. The table below is now the
single source of truth; `CHANGELOG.md` and `PROJECT_STATUS.md` use these same
numbers.

---

## Status at a glance

| # | Milestone | Status | Completed |
|---|---|---|---|
| 1 | Resume Studio | ✅ **Complete** | 2026-08-27 |
| 2 | AI Resume Review | ✅ **Complete** | 2026-08-27 |
| 3 | AI Job Matching | ✅ **Complete** (Phase 1 — see §3) | 2026-08-27 |
| 4 | AI Interview Preparation | ✅ **Complete** | 2026-08-27 |
| 5 | AI Mock Interview (Text) | ✅ **Complete** | 2026-08-27 |
| 6 | AI Career Coach (Chat) | ✅ **Complete** | 2026-08-28 |
| 7 | Voice Interview | ✅ **Complete** | 2026-08-29 |
| 8 | Intelligent Application Tracker | ✅ **Complete** | 2026-08-30 |
| 9 | AI Career Dashboard | ✅ **Complete** | 2026-08-31 |
| 10 | Notifications | ✅ **Complete** | 2026-09-01 |
| 11 | Platform Polish & User Experience | ✅ **Complete** | 2026-09-02 |
| 12 | Performance, Security & Production Readiness | ⚪ Not started | — |

**The Interview Engine.** Milestones 4, 5, 7, and a future Live AI Interview
are one system, not four unrelated features — Interview Preparation teaches
concepts, Mock Interview (Text) practices them under a scored session, Voice
Interview extends that same session model to spoken answers, and a future
Live AI Interview is the natural end state. Each should build on what the
last one shipped rather than standing alone.

**The Career Coach as orchestrator.** Milestone 6 sits above the Interview
Engine, Resume Engine, and Job Matching Engine rather than beside them — it
is the one surface that reads across all of them (via
`career_coach/context.py`'s grounding) instead of owning a domain of its own.
Application Tracker (#8), Dashboard (#9), and any future engine become one
more thing the Coach can reference, not a reason to touch its architecture.

---

## Engineering risks and where they live

Reordering by user experience does not remove the risks found in the
architecture review — it means some surface earlier than a risk-minimising
order would place them. Each is attached to the milestone that introduces it:

- **Milestones 6 and 7** each ship a scoped rate limit on their own new
  endpoint as part of that milestone's scope. Milestone 6 (open-ended chat) is
  the one surface with no natural per-action cost ceiling, so this is
  non-negotiable there — shipped as an in-process sliding window
  (`career_coach/ratelimit.py`), 30 messages/hour/user.
- **Milestone 10** cannot deliver reliably on a multi-instance deployment
  without Redis-backed SSE fan-out. Resolved by construction, not
  reimplemented: notifications publish through the existing `event_manager`
  singleton, which already picks `RedisEventManager` over the in-process one
  whenever `REDIS_URL` is set. The remaining risk is purely operational — set
  `REDIS_URL` before running more than one API worker — not a code gap.
- **Frontend consistency cleanup** is dissolved: fixed opportunistically inside
  whichever feature milestone already has the file open, with **Milestone 11**
  as the mop-up pass. This keeps the roadmap incremental instead of batching a
  large refactor.
- Everything not blocking a specific feature — full rate-limit coverage, CORS
  lockdown, JWT test coverage, API versioning, observability — moves to
  **Milestone 12**, where there is a real product to harden rather than
  endpoints in isolation.

---

## 1. Resume Studio ✅ Complete (2026-08-27)

Consolidated analyzer, tailor, autofill, compile-and-score, and quality-report
into one coherent workspace. No backend, API, or database changes — entirely a
frontend structure and navigation change.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 2. AI Resume Review ✅ Complete (2026-08-27)

Replaced a single opaque score with Resume Health (job-independent) and Job
Match (job-specific, the trained model's own score, never blended), plus
per-category reasoning — why each score is what it is, not just the number.
Grammar shipped declared-but-unavailable rather than silently missing, which
became the template Job Matching later followed for its own deferred
dimensions.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail, including the
same-day refinement pass (shared score vocabulary, a dead-end next-action
fix, duplicate-action removal).

---

## 3. AI Job Matching ✅ Complete — Phase 1 (2026-08-27)

Per-listing Resume Match and Skills Match against the user's primary resume,
reusing the existing trained model (`predict_score()`) and skill taxonomy —
no new model training, no changes to job ingestion or caching. Built as a
small provider registry specifically so Experience/Education/Salary/Location
can each be added later as one more provider, without touching the engine.

Operates on the live job *feed* (a shared, user-less cache table), computing
scores fresh per request rather than persisting them — not the
`job_applications.match_score` column, which is per-*application* and already
written elsewhere, lazily, by the dashboard.

**Deferred, not incomplete:** Experience, Education, Salary, and Location
Match all require structured data that doesn't exist today on one or both
sides of the comparison (see `PROJECT_STATUS.md`'s Milestone 3 section for
the exact gap and unlock condition per dimension). Education Match
specifically cannot be added without extending the job ingestion pipeline's
enrichment schema, which this milestone was explicitly scoped not to touch.

---

## 4. AI Interview Preparation ✅ Complete (2026-08-27)

Teaches concepts rather than testing memorisation — distinct from Mock
Interview (#5), which is the scored practice loop. Every question carries
difficulty, estimated answer time, an ideal answer, a concept explanation, a
beginner-friendly explanation, a real-world example, what the interviewer is
testing, interview tips, common mistakes, important keywords, and follow-up
questions — all visible immediately, nothing gated behind an attempt.

Shared cache keyed by role + category + difficulty + prompt version + model
version, mirroring the job feed's caching philosophy with one addition the
job feed doesn't need: the version axis lets a future prompt or model change
mint new content without invalidating or silently mixing with old rows.
Bookmarks, completion, and notes are the one user-specific layer, kept
separate from the shared cache and attached per question on read.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 5. AI Mock Interview (Text) ✅ Complete (2026-08-27)

The timed question → typed answer → evaluation loop as its own polished
session flow — the second stage of the Interview Engine, building on what
Interview Preparation (#4) already established rather than starting fresh.
Sources its questions directly from Prep's cache; scores every answer across
seven named dimensions with strengths/weaknesses/missing points/an improved
rewrite, then a final report: overall score, readiness band, performance
summary, topics to improve, practice plan, and next recommended actions.
Resume Interview, Restart Interview, Exit Interview, and Continue Later are
all supported — the last two need no dedicated endpoint, since every answer
persists the moment it's submitted.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail, including the
Interview Engine's architecture (`engine.py` / `evaluation.py` /
`reports.py`) that Voice Interview (#7) is expected to extend, not replace.

---

## 6. AI Career Coach (Chat) ✅ Complete (2026-08-28)

Open-ended conversational mentor grounded in the user's own resume, profile,
mock-interview readiness, and application pipeline — orchestrating the other
engines rather than reimplementing them. Shipped the one genuinely new
backend capability the earlier analysis flagged: a **streaming** completion
method on `core/llm.py` (`ClaudeClient.stream_message`, `AsyncAnthropic`-
backed) — every other method there stays non-streaming tool-JSON.

Built in two phases per explicit direction: a dedicated `/coach` page now,
with the chat/streaming logic in a standalone hook
(`useCareerCoachChat.ts`) so a later floating quick-entry assistant can reuse
it without any backend change. Follow-up suggestions are short clickable
chips (`{response, follow_ups}`) from one small non-streaming call after the
streamed reply — not interleaved tool-use inside the stream, kept simple on
purpose.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 7. Voice Interview ✅ Complete (2026-08-29)

Spoken answers as an alternative input method on the existing Interview
Engine, not a parallel system — the engine, evaluation pipeline (`evaluation.py`),
and report generation (`reports.py`) are byte-for-byte unchanged from
Milestone 5. Deepgram Nova-3 transcribes an accepted recording into plain
text that enters the same `/evaluate` endpoint a typed answer already used.

No raw audio is ever stored: bytes exist only for the duration of the
transcription request. Voice-only observations (speaking rate, long pauses,
filler-word count) are surfaced per-question, informational only, never
blended into the seven-dimension score — and each is independently omitted
rather than fabricated when Deepgram's response can't support it.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 8. Intelligent Application Tracker ✅ Complete (2026-08-30)

Upgraded from a 5-stage board into a 12-stage hiring pipeline (Recruiter
Contacted through Final Interview, Accepted, Withdrawn), with a real
Kanban (drag-and-drop), a List view, and a Timeline/activity feed. The
point of this milestone: it's the one surface that reads across every
other engine already built — Resume, Job Matching, Interview, and Career
Coach — rather than adding a fifth isolated one. The detail drawer shows
the resume used, a live job-match breakdown, interview readiness with a
practice link, and four Career Coach quick-prompts, all pulled from those
engines' own existing data with zero new scoring logic.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail, including the
disclosed one-time remap of legacy `'interviewing'` rows and the new
`application_status_history` table that makes Analytics' interview/offer
rates exact instead of an approximation.

---

## 9. AI Career Dashboard ✅ Complete (2026-08-31)

The front door to everything built in 1–8, answering "what should I do
next?" — composed entirely from existing engines' own functions, with two
small new aggregates (mock-interview average score, prep completion count)
added beside the data each already owns. Also resolved the known
duplicate-fetch issue flagged since Milestone 3: the page fetched its data
two different ways at once (react-query plus a separate raw `useEffect`);
consolidated onto the one new `/dashboard/home` endpoint.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail, including a
pre-existing, never-triggered response-serialization bug this milestone's
more thorough end-to-end testing caught and fixed at the source.

---

## 10. Notifications ✅ Complete (2026-09-01)

Built the Notification Engine: a persistent `notifications` table as the
system of record, a dedupe/group/priority/expiration decision layer in front
of it, event-driven triggers wired into Resume, Application, and (via a
periodic sweep) Interview/Jobs/Career Coach/Analytics, and a Notification
Bell + Center on top. This milestone's own investigation corrected an
assumption in this roadmap's earlier note above ("persist the events already
flowing through core/events.py") — nothing was actually flowing. Grepping
the whole backend for `event_manager.publish(` and the frontend for
`useRealtimeStream(` (the call site, not just the definition) turned up zero
matches: the SSE pipe existed end to end but had no publisher and no
subscriber. Milestone 10 is what wires both ends for the first time, not
just what adds persistence in front of an existing stream.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 11. Platform Polish & User Experience ✅ Complete (2026-09-02)

The mop-up pass this file scoped, plus the cohesion work that only becomes
visible once every module exists. Preceded by a Code Stabilization Sprint
(2026-09-01) that cleared all build/type/lint debt first.

Headline findings: three finished pages (Analytics, Reports, Offers) had no
inbound link anywhere in the product; the ⌘K palette had not been updated
since Milestone 5, so Career Coach and the Application Tracker were
unreachable from it; twelve pages carried three different `<h1>` treatments
and two eyebrow classes that resolved to identical CSS; Settings shipped a
"Save preferences" button wired to nothing.

See `CHANGELOG.md` and `PROJECT_STATUS.md` for full detail.

---

## 12. Performance, Security & Production Readiness ⚪

Generalise the scoped rate limiters into comprehensive coverage; CORS
lockdown; JWT verification test coverage; Redis fan-out made mandatory in
production; API versioning (`/api/v1`); refreshed documentation; basic
observability; a full end-to-end launch pass. (Merged from two separate
milestones in an earlier revision of this plan — see revision history.)

---

## Revision history

- **2026-08-27** — Milestone 1 (Resume Studio) marked complete. Milestone 2
  entered analysis phase.
- **2026-08-27** — Roadmap resequenced from the original 6-milestone
  engineering-first draft to a 13-milestone product-experience order.
  Engineering findings from the original draft were not dropped; they were
  redistributed to the milestones that introduce each risk (see above).
- **2026-08-27** — Milestone 2 (AI Resume Review) marked complete, plus a
  same-day refinement pass. AI Job Matching completed next, out of the
  13-milestone plan's original sequence (where it was #7), at the user's
  explicit direction. Experience/Education/Salary/Location Match documented
  as deferred future enhancements, not incomplete work.
- **2026-08-27** — AI Interview Preparation completed. Numbering unified:
  the 13-milestone plan's #7 (AI Job Matching) and #3 (AI Interview
  Preparation) are now permanently #3 and #4, matching the order they were
  actually built in, resolving the "plan order vs. actual order" split that
  existed for one revision. Performance & Security and Production Readiness
  (previously separate #12/#13) merged into one #12. Total milestone count:
  13 → 12. AI Mock Interview (Text) — now #5 — entered analysis phase.
- **2026-08-27** — AI Mock Interview (Text) completed, establishing the
  Interview Engine (session lifecycle, evaluation pipeline, report
  generation) that a future Voice Interview and Live AI Interview are
  expected to extend rather than rebuild.
- **2026-08-28** — AI Career Coach completed. Reordered ahead of Voice
  Interview at the user's explicit direction: AI Career Coach is now
  permanently #6, Voice Interview #7 (previously the reverse). The Coach
  became the platform's orchestration layer before Voice Interview, per the
  stated reasoning that voice should extend an already-central coach rather
  than the coach being bolted on after.
- **2026-08-29** — Voice Interview completed as an input-method extension of
  the existing Interview Engine — no changes to session lifecycle,
  evaluation, or reports. Deepgram Nova-3 chosen over Whisper for native
  word-timestamps and filler-word detection, plus lower cost.
- **2026-08-30** — Intelligent Application Tracker completed: 12-stage
  pipeline (from 5), `application_status_history`, Kanban/List/Timeline
  views, and a detail view aggregating the Resume, Job Matching, Interview,
  and Career Coach engines with zero new scoring logic.
- **2026-08-31** — AI Career Dashboard completed, composing every existing
  engine's own functions with zero new scoring logic. Resolved the
  duplicate-fetch issue flagged since Milestone 3 and, as a side effect of
  more thorough end-to-end testing, a pre-existing response-serialization
  bug in `/user/activity` that had never actually been exercised by a test.
- **2026-09-01** — Notifications completed: a persistent `notifications`
  table plus a dedupe/group/priority/expiration engine, event-driven
  triggers on resume scans and application status changes, a periodic sweep
  (interview reminders, follow-up nudges, Career Coach suggestions, weekly/
  monthly summaries, milestones) piggybacked on the dashboard's existing
  `/home` request rather than a new scheduler, and the first real publisher
  and subscriber for the `core/events.py` SSE pipe that every earlier
  milestone had left connected end to end but silent. Several spec-named
  notification types were consolidated or honestly deferred rather than
  fabricated — see `CHANGELOG.md` for the full list and why.
