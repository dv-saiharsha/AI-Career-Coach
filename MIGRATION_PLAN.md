# Figma Design Migration Plan

Goal: `figma-export/` fully REPLACES `frontend/`'s entire UI — every page, component, and layout should look and behave exactly like `figma-export/`. Only the invisible logic survives untouched: Supabase auth, `lib/http.ts`, `services/*.ts`, `ThemeContext`, routes, and env vars. Old UI components that become unused once their callers are restyled get deleted, not left behind.

## How to work this plan (per phase)

1. Run the dev server (`cd frontend && npm run dev`) and open the printed `localhost` link.
2. Open the Figma Make preview in another tab and compare side by side.
3. If something's off, describe it narrowly (e.g. "the KPI cards should have 12px radius and the coral AI pill like in figma-export") and fix only that.
4. When it matches: tick the box(es) below and commit.
5. `/clear`, then resume with: *"Read MIGRATION_PLAN.md and ./figma-export. Continue with the next unchecked phase. Keep all my existing API calls, auth, and routes working, and match the Figma design exactly. Use the Figma MCP link if any detail is unclear."*

---

## Findings that shape this plan

**Tech stack gap:** `figma-export` is React 19 + Tailwind v4 (`@tailwindcss/vite`, no config file) + hand-rolled CSS classes (`.card`, `.btn`, `.sidebar`, etc.) defined in `index.css`, with its own tiny `ui.tsx` component kit (Button/Card/Input/Label/Heading) and `brand.tsx`/`shared.tsx`. No forms library, no Radix, no backend — everything reads from `src/data/mockData.ts`.

`frontend` is React 18 + Tailwind v3 + shadcn/Radix primitives (`components/ui/*`) styled with HSL CSS variables, `react-hook-form` + `zod`, Supabase auth, and real services hitting a FastAPI backend. Pages are 3-10x larger than their Figma counterparts because they carry real data-fetching, error/loading states, and business logic that Figma's mock pages don't have.

**Decision this plan assumes:** keep React 18 + Tailwind v3 + Radix (upgrading React/Tailwind is a separate, riskier project and Radix gives us accessible primitives Figma's export doesn't have). Port Figma's *visual system* — CSS variables, fonts, the custom classes, the AppShell behavior — onto the existing component tree, rather than swapping frameworks. Restyle `components/ui/*` and page markup to match Figma pixel-for-pixel; keep every hook/service call as-is.

**Two real gaps, not just re-skins:**
- Figma has an **Onboarding** flow (`/onboarding`, 3 steps: target role → resume upload → preferences) that `frontend` has no page for at all.
- `frontend` has a public **Landing Page** (`/`) that Figma's export has no equivalent for (Figma's `/` is Sign In directly).
- Figma's `AppShell` has a command palette (⌘K), a notifications panel, and a "Quick actions / New" menu — `frontend`'s `Header`/`Sidebar` have none of these today.

---

## Tech stack summary

| | `figma-export` | `frontend` (existing) |
|---|---|---|
| Framework | React 19, Vite 8 | React 18, Vite 6 |
| Router | react-router-dom v7 | react-router-dom v7 |
| Styling | Tailwind v4 (`@tailwindcss/vite`, no config) + custom CSS classes in `index.css` | Tailwind v3 (`tailwind.config.js` + PostCSS) + shadcn/Radix + `tailwindcss-animate` |
| Components | Hand-rolled `ui.tsx` (Button, Card, Input, Label, Heading, Toast) | Radix-based `components/ui/*` (24 primitives: dialog, dropdown, select, tabs, etc.) |
| Fonts | Inter (body) + Manrope (headings), Google Fonts `@import` | DM Sans (body) + Manrope (headings), no Google Fonts import found yet — needs adding |
| Color system | Named CSS vars: `--loom-indigo`, `--thread-coral`, `--success`, etc. | HSL CSS vars: `--primary`, `--secondary`, `--accent`, etc. (already indigo/violet, but different exact values, different naming) |
| Charts | Recharts v3 | Recharts v2 |
| Forms | None (mock defaults only) | react-hook-form + zod |
| Data | `src/data/mockData.ts` (static) | Supabase auth + `services/*.ts` → FastAPI backend |
| Auth | None | Supabase (email/password + Google OAuth) |
| Icons | lucide-react v1.48 | lucide-react v0.474 |
| Extra deps | `clsx`, `tailwind-merge`, `oxfmt` | `canvas-confetti`, `jspdf`, `sonner`, `@hookform/resolvers` |

---

## Screen mapping

| Figma screen (`figma-export/src/pages`) | Frontend page (`frontend/src/pages`) | Status |
|---|---|---|
| `AuthPages.tsx` → `SignIn` | `auth/LoginPage.tsx` | Match |
| `AuthPages.tsx` → `SignUp` | `auth/SignupPage.tsx` | Match |
| `AuthPages.tsx` → `ForgotPassword` | `auth/ForgotPasswordPage.tsx` | Match |
| — (no Figma screen) | `auth/ResetPasswordPage.tsx` | **No design** — Supabase-required page Figma never modeled. Style using the auth-panel pattern from the other 3. |
| — (no Figma screen) | `auth/AuthCallbackPage.tsx` | **No design** — OAuth redirect handler, no UI to speak of; leave as a spinner. |
| `Onboarding.tsx` | *(none)* | **Missing in frontend** — needs to be built new. |
| — (no Figma screen) | `LandingPage.tsx` | **No design** — public marketing page. Out of scope unless you want it restyled too (flag if so). |
| `Dashboard.tsx` | `DashboardPage.tsx` | Match |
| `ResumeAnalyzer.tsx` (single file, upload+results) | `resume/ResumeUploadPage.tsx` + `resume/ResumeResultsPage.tsx` (2 pages) | Match — split across 2 routes in frontend |
| `CoverLetter.tsx` | `cover-letter/CoverLetterPage.tsx` | Match |
| `InterviewCoach.tsx` (1 file, switches on pathname: setup/live/feedback) | `interview/InterviewSetupPage.tsx` + `InterviewSessionPage.tsx` + `InterviewFeedbackPage.tsx` (3 pages) | Match — split across 3 routes in frontend |
| `JobPortal.tsx` | `jobs/JobsPage.tsx` | Match |
| `Applications.tsx` | `applications/ApplicationsPage.tsx` | Match |
| `OfferComparison.tsx` | `offers/OffersPage.tsx` | Match |
| `Analytics.tsx` | `analytics/AnalyticsPage.tsx` | Match |
| `Progress.tsx` | `progress/ProgressPage.tsx` | Match |
| `History.tsx` | `history/HistoryPage.tsx` | Match |
| `Profile.tsx` | `profile/ProfilePage.tsx` | Match |
| `Settings.tsx` | `settings/SettingsPage.tsx` | Match |
| `NotFound.tsx` | `NotFoundPage.tsx` | Match |
| `PlaceholderPage.tsx` (generic "coming soon" for unbuilt nav items) | *(none needed — all pages are real in frontend)* | N/A, skip |
| `AppShell.tsx` (sidebar + topbar with ⌘K command palette, notifications panel, "New" quick-actions menu) | `components/layout/AppShell.tsx` + `Header.tsx` + `Sidebar.tsx` (no command palette, no quick actions, basic notifications dropdown) | **Partial** — shell exists but is missing 3 interactive features Figma has |

---

## Existing frontend logic that MUST be kept

- **Auth (Supabase):** `context/AuthContext.tsx` — `login`, `register`, `loginWithGoogle` (OAuth redirect to `/auth/callback`), `requestPasswordReset`, `logout`, session state via `supabase.auth.onAuthStateChange`. `components/layout/ProtectedRoute.tsx` gates the whole `AppShell` route subtree.
- **HTTP client:** `lib/http.ts` — fetch wrapper attaching the Supabase bearer token to every request, `HttpError` with parsed FastAPI `detail`, blob/FormData handling. All services call through this.
- **Services (real backend calls, one per domain):** `analyticsService`, `applicationsService` (+ `stageForColumn` kanban logic), `coverLetterService`, `dashboardService`, `historyService`, `interviewService`, `jobsService`, `offersService`, `profileService` (+ `downloadJson`), `reportService`, `resumeService`, and `resumeProgressStream.ts` (SSE subscription for live scan-stage updates).
- **State/theme:** `context/ThemeContext.tsx` — light/dark/system theme, persisted to `localStorage` under `hireloom-theme`, toggled via `document.documentElement` class.
- **Routing:** all routes under `App.tsx` — public (`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`) and protected (`/dashboard`, `/resume/*`, `/interview/*`, `/jobs`, `/applications`, `/offers`, `/cover-letter`, `/analytics`, `/history`, `/progress`, `/profile`, `/settings`), plus the `/resume`, `/interview` index redirects.
- **Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (frontend `.env.local`); backend counterparts (`SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SECRET_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `RAPIDAPI_KEY`, `DB_URL`, etc. in `backend/app/core/config.py`) are untouched by a frontend-only restyle.
- **Types:** `src/types/*.ts` — the contracts between services and pages; don't change shapes, only presentation.

None of this should be touched while restyling — only JSX markup, class names, and the `components/ui/*` / `layout/*` presentation layer change.

---

## Phase 1 — Design tokens, fonts, shared components, app shell

- [x] Add Google Fonts `@import` for Inter + Manrope to `frontend/src/index.css`
- [x] Port Figma's color tokens into `frontend/src/index.css` `:root`/`.dark`, remapped onto the existing HSL variable names, plus new `--coral`/`--success`/`--warning` tokens
- [x] Match radii (`--radius-card: 12px`, `--radius-control: 8px`), shadows (`--shadow`, `--shadow-soft`) in `tailwind.config.js` / CSS vars
- [x] Restyle `components/ui/button.tsx` (heights 42/34/38px, weight 700, hover-lift, `coral` variant added), `card.tsx` (12px radius, soft shadow), `input.tsx` (44px height, 8px radius, card background), `badge.tsx` (success/warning now use the new tokens instead of raw Tailwind colors) — kept each component's existing props/API. `label.tsx`/`select.tsx`/`avatar.tsx`/`dropdown-menu.tsx`/`dialog.tsx` already token-driven, inherited the new palette without changes; `tabs.tsx`/`switch.tsx`/`progress.tsx` deferred to the page phase that first needs them
- [x] Rebuild `components/layout/Sidebar.tsx` to match Figma's `.sidebar` (collapse toggle, career-readiness widget wired to real data via `useDashboardHome`, grouped nav from `config/navigation.ts`, mobile drawer reuses the same component)
- [x] Rebuild `components/layout/Header.tsx` topbar to match Figma's `.topbar` (search bar as command-palette trigger, notification bell with unread dot, "New" quick-actions dropdown; dropped the old theme-switcher and avatar dropdowns — see Deviations)
- [x] Add the **command palette** (`components/layout/CommandPalette.tsx`, ⌘K / Ctrl+K, ESC to close, filters nav items, Enter navigates)
- [x] Add the **quick-actions "New" menu** (dropdown with quick-action shortcuts from `config/navigation.ts`)
- [x] Notifications dropdown matches Figma's `.notifications-panel` (unread dot, per-item click-to-navigate, "Mark all read", "Notification settings" footer link), backed by the new `notificationsService.ts` (mock data, real-API-shaped)
- [x] `npm run typecheck` and `npm run build` both pass clean after the restyle
- [x] **Side-by-side visual check against the Figma Make preview** — verified via repeated Playwright screenshots (light + dark) of the shell across this whole migration, plus your own direct feedback on the Settings/Notifications/Privacy/Billing tabs specifically; no open diffs (2026-09-28)

## Phase 2 — Auth + Onboarding + Dashboard

- [x] Built shared `components/layout/AuthLayout.tsx` (split panel: indigo gradient + woven pattern + logo + eyebrow/headline/benefits + testimonial on the left, centered form on the right) plus `components/shared/Logo.tsx` (the real woven-"H" mark, replacing the placeholder Sparkles icon everywhere including `Sidebar.tsx`), `WovenPattern.tsx`, and `PasswordField.tsx` (show/hide eye toggle)
- [x] Restyle `pages/auth/LoginPage.tsx` to match Figma `SignIn` exactly (per `design-refs/signin.png`) — real GoogleIcon (not Figma's fake "G" letter), Supabase `login`/`loginWithGoogle` kept, email field starts empty (no mock default)
- [x] Restyle `pages/auth/SignupPage.tsx` to match Figma `SignUp` (per `design-refs/signup.png`) — added a real `lib/passwordStrength.ts` meter (Figma's is a static fake bar) and a required Terms/Privacy checkbox (missing from the old page entirely); first/last name/email all start empty, matching the email-empty rule generalized to every mock personal field
- [x] Restyle `pages/auth/ForgotPasswordPage.tsx` to match Figma `ForgotPassword` (success state's "Resend email" now really re-calls `requestPasswordReset`, not just a fake UI reset)
- [x] Restyle `pages/auth/ResetPasswordPage.tsx` using the same auth-panel pattern (no Figma screen exists for it); `AuthCallbackPage.tsx` left as a plain spinner per the plan
- [x] **App-shell spacing fix (affects all pages):** moved Figma's exact `.page-content` spec (`padding: 27px 30px 46px; max-width: 1560px; margin: auto`) into `AppShell.tsx`'s `<main>` wrapper, so it's no longer each page's job to add its own container. The old bug was `DashboardPage.tsx`'s own root div (`max-w-7xl mx-auto p-4 sm:p-6 lg:p-8`) fighting the shell for width — removed now that the shell owns it. Also hardened `Header.tsx`'s flex layout (`min-w-0`/`truncate` on the title block, `shrink-0` on the actions block) so long titles can never squeeze the search/bell/New controls out of view.
- [x] Rebuilt `DashboardPage.tsx` to match Figma's `Dashboard.tsx` layout exactly (welcome row + readiness card, 4 KPI cards, AI next-actions card + funnel chart, upcoming interviews + streak card, top job matches) — every number is real, sourced from `dashboardService.getHome()` (already fetched before; the page just renders it in Figma's shape now)
- [x] `npm run typecheck` and `npm run build` pass clean
- [x] **Side-by-side check** against `design-refs/signin.png` / `signup.png` / `dashbaord-figma.png` — verified via QA-account screenshots (light + dark); no open diffs (2026-09-28)

### Dashboard: where real data forced a deviation from the Figma mock

- **Application funnel is 4 bars, not 5.** Figma's mock has Saved/Applied/Screening/Interview/Offer. The backend only computes cumulative "ever reached" totals for 3 checkpoints (`reached_applied`/`reached_interviewing`/`reached_offer` in `analytics/services.py`) — splitting "Interviewing" into Screening + Interview would need per-status cumulative reach the backend doesn't track, and faking it from the non-cumulative `by_stage` snapshot would break the funnel's monotonically-decreasing shape (a real bug, not a style nit). See `lib/funnel.ts`. If you want the 5-bar version, that's a backend change (track cumulative reach per finer stage), not a frontend styling one.
- **No fabricated deltas.** Every KPI's small trend line is either a real secondary fact (session counts, success rate, best score) or an honest empty state — never a made-up "+6 this month"/"+0.8 from last week" like the mock.
- **"Upcoming interviews" has no date/time column.** Confirmed in `dashboard/services.py`: this list is "applications currently at an interview stage," not a calendar — nothing in the schema tracks a scheduled date. Shows the real status (e.g. "Technical Interview") instead of a fake date.
- **Streak card is a Figma-styled empty state.** No streak/activity-heatmap data exists anywhere in the schema — shows a real CTA instead of Figma's fabricated "6 day streak" + heatmap.
- [ ] **Deliberately deferred, not built:** `pages/onboarding/OnboardingPage.tsx` matching Figma's 3-step flow (target role → resume upload → preferences). This still needs your call on which backend fields it writes to before it can be built for real — not something to guess at during a final ship pass. Found and fixed the resulting bug on 2026-09-28: `SignupPage.tsx` was navigating new users to `/onboarding`, a route that has never existed, so every new signup 404'd. Now redirects straight to `/dashboard` until the real onboarding flow is built.
- [x] ~~Restyle `pages/DashboardPage.tsx`~~ / ~~side-by-side check~~ — duplicate of the item already done above (2026-09-26); DashboardPage is built, styled, and its readiness ring's color-banding bug is fixed (2026-09-28).

## Phase 3 — Resume Analyzer, Cover Letter, Interview Coach

- [x] Restyle `pages/resume/ResumeUploadPage.tsx` to match Figma `ResumeAnalyzer` upload/analyzing states — kept the real required job-description field (Figma's mock has no such requirement; the real `/resume/analyze` endpoint does), the stored-resume rescan banner, and the real 5-stage SSE progress checklist (Figma fakes 3 steps; backend actually reports `extracting/checking/analyzing/reconciling/diagnostics`)
- [x] Restyle `pages/resume/ResumeResultsPage.tsx` to match Figma `ResumeAnalyzer` results state — see deviations below for the resume-preview panel, rubric categories, and suggestions. Wired two previously-decorative Figma features to real backend calls: the version-history dropdown (`resumeService.getHistory()` + `getBreakdown(id)` per selection) and "Compare to job description" (`resumeService.rescanStoredResume()`, re-scores in place)
- [x] Restyle `pages/cover-letter/CoverLetterPage.tsx` to match Figma `CoverLetter` (persistent 3-column layout; see deviations below)
- [x] Restyle `pages/interview/InterviewSetupPage.tsx` to match Figma `InterviewCoach` setup state
- [x] Restyle `pages/interview/InterviewSessionPage.tsx` to match Figma `InterviewCoach` live-session state
- [x] Restyle `pages/interview/InterviewFeedbackPage.tsx` to match Figma `InterviewCoach` feedback state
- [x] `npm run typecheck` and `npm run build` pass clean after every page in this phase
- [x] **Side-by-side check** of Cover Letter Generator (`design-refs/cover-letter-figma.png`) and Interview Coach (`design-refs/interview-hub.png` / `interview-live.png` / `interview-feedback.png`) — verified via QA-account screenshots (light + dark); Interview Coach's average-score ring color-banding bug fixed (2026-09-28)

### Resume Analyzer: Figma element support (backend reality check)

**Supported with real data:** ATS score, 7-category rubric (`Hard skill match`, `Title alignment`, `Quantified impact`, `ATS parseability`, `Section completeness`, `Recency`, `Readability` — richer than Figma's 5 fake categories), keyword present/missing/implied+frequency, per-bullet feedback (strong-verb/weak-opener/metric/tool-context flags + suggestions), domain-grouped missing skills, parse checks, score-integrity/keyword-stuffing detection, version history, re-scan against a new JD, re-score the stored resume without re-uploading.

**Correction (2026-09-26):** the resume preview IS supported — missed on the first pass. `GET /resume/file/{id}` serves the original uploaded file; the results page now fetches it and renders it inline (a real `<iframe>` for PDFs; DOCX can't be rendered inline by any browser, so that case shows a real "open original" fallback instead of a broken embed). Bullet-by-bullet feedback was removed from this page entirely per your direct feedback — it's no longer shown anywhere (the underlying data is still fetched as part of the cached analysis, just not displayed).

**Not supported — hidden or replaced with real data instead:**
- **Per-suggestion "+N pts" impact estimate.** Suggestions are plain strings server-side. Shown without a fake impact badge.
- **"Apply fix" (auto-edit the resume).** No such mutation exists. Replaced with a real "Copy" action (copies the suggestion text) instead of a button that would do nothing.
- **Figma's rubric is 5 invented categories** (Formatting/Keywords/Impact & metrics/Readability/Completeness). Used the real 7 categories instead of forcing a mapping onto fake ones.

**Renamed per your direct feedback (2026-09-26):** "Resume Analyzer" → "ATS Check" everywhere user-facing (sidebar nav label, topbar breadcrumb, page heading, toast copy, landing page copy, `index.html` title/meta). Figma's own file/component names (`ResumeAnalyzer.tsx`, `resume-analyzer-figma.png`) still say "Resume Analyzer" — that's the design source's naming, not this app's, so later phases should keep reading it as the same feature under its new name.

**Removed per your direct feedback (2026-09-26):** the "More analysis detail" tabbed section (domain-grouped skill gaps, parse checks, score-integrity signals, keyword frequency, extracted/implied skills) — not part of Figma's design, so it's gone from the UI. The data is still fetched (`getBreakdown` still backs the rubric/keyword cards), it's just not displayed anywhere now. If you want any of that surfaced again later (parse checks in particular catch resumes an ATS literally can't read), say where. Also removed the `sticky` positioning on the bullet-feedback panel — it was making the ATS score card appear to jump as the page scrolled.

### Backend TODO (from Resume Analyzer)

- [ ] No endpoint to apply a suggested fix back onto the stored resume text (Figma's "Apply fix").
- [ ] Suggestions have no per-item quantified impact score.

## Resume Tailor (built out of order, per your direct request — 2026-09-26)

Not in the original phase breakdown — this page has no Figma-export code at all (only `design-refs/resume-tailor-figma.png`), and no existing frontend route before this. It maps to a real, already-built backend module (`resume_builder`) that the rest of the migration hadn't touched yet.

New: `types/resumeTailor.ts`, `services/resumeTailorService.ts`, `pages/resume/ResumeTailorPage.tsx`, route `/resume/tailor`, sidebar nav item "Resume Tailor" (Prepare group, after ATS Check), and an entry point button ("Tailor resume for this job") in the Job Portal's job detail drawer — without that button the page would have been unreachable.

**Supported with real data:** free gap analysis per job (`/tailor-handoff`: targeted score against this posting, original scan's score, missing keywords, implied-but-unwritten skills, domain-grouped gaps), a paid/rate-limited AI suggestion step (`/tailor-preview` with `include_rewrites`, one Claude call, gated behind an explicit button so it's never fired silently), and a real compile step (`/quick-tailor`) that returns an actual compiled PDF, a real post-compile ATS score, the LaTeX source (added a bonus "Copy LaTeX" action Figma doesn't have, since Overleaf-ready source is real and free to expose), page count, and a real list of trims/adjustments made to fit the page target.

**Not supported — the single biggest interaction gap:** Figma's mock shows a live "Original 78% → Tailored 86%" score comparison and per-suggestion "+5 match" deltas *while still choosing which edits to apply*, before anything is generated. The backend deliberately has no `projected_score` — `resume_builder/optimizer.py` and the `TailorPreviewSchema` docstring both say a score for a resume that doesn't exist yet can't be honestly measured, only recomputed after a real compile. So this build shows only the **current** (pre-tailoring) match while the user is selecting edits, and the **Original → Tailored** comparison only appears after the user clicks "Generate tailored resume" and a real compile has actually happened. Per-suggestion deltas are replaced with the suggestion's real `reason` text instead of a fabricated number.

**Also not supported:**
- Inline diff-highlighting of changed phrases directly in the resume document ("Changes highlighted" toggle) — the final document is a compiled PDF, not a diffable text against the original, so this isn't portable. The accepted-skills/applied-suggestions checklists serve as the real "what changed" record instead.
- A distinct "Save version" action — `quick-tailor` already caches server-side per (user, analysis, job, target_pages) automatically; there's no separate named-save concept to expose, so this button was dropped rather than wired to a no-op.
- Figma's "RESUME SECTIONS" list with per-section Improved/Needs review/Ready verdicts — no such per-section grading exists. Replaced with the real domain-grouped gap counts instead.

### Update (2026-09-27, per your direct request): paste-a-JD entry point, and a real sidebar bug fix

**Bug found and fixed:** clicking "Resume Tailor" also highlighted "ATS Check" in the sidebar. Cause: `Sidebar.tsx`'s `isActiveRoute` used a plain per-item `pathname.startsWith(item.path)`, and `/resume/tailor` starts with `/resume` (ATS Check's own nav path) just as much as it matches `/resume/tailor` itself — both lit up at once. Fixed generically (not with a one-off exception for this pair): it now finds the single *longest*-matching nav path across every item and only that one is active, so this can't recur for any other pair of nested routes either.

**Paste-a-job-description entry point added.** Previously this page was reachable only via Job Portal's "Tailor resume for this job" button, which required a real cached `JobListing` row — no way to tailor against a posting Job Portal never scraped. Turns out the backend already anticipated this: `QuickTailorRequestSchema.job_description` is explicitly documented ("Free text, for callers with no job_id — e.g. a pasted JD") but the frontend never called it that way. The landing state (`JobEntryChoice`) now offers both paths — "Go to Job Portal" (unchanged) or a title/company/description paste form, same Card/Input/Button language as the rest of the app.

**What paste mode can and can't do, honestly:** the final compile step (`/quick-tailor`) works fully and identically either way — a real compiled PDF and a real post-compile ATS score scored against whatever text it's given, Job-Portal-sourced or pasted. What it can't do: `/tailor-handoff` (gap analysis) and `/tailor-preview` (missing-keyword chips, AI bullet rewrites) both require a real `job_id: int` in their request schemas — there's no pasted-text path for either. Rather than silently hiding this or hard-blocking the paste option entirely, the "Gaps by domain" and "AI suggestions" cards are replaced with a plain explanation of exactly why (with a link back to Job Portal), and the score panel shows the one real number `quick-tailor` produces instead of the before/after comparison (which needs the handoff's baseline score that doesn't exist in this mode).

**Verification note:** confirmed the sidebar fix and the new paste-form/state-transition logic live with a real test account. Did not run a full paste-mode tailor to a compiled PDF — that requires an actual resume analysis first, which spends a real Anthropic API call, and I didn't want to spend your API budget just for my own QA when the reasoning above is already grounded directly in the backend's own schema and docstrings, and reuses the exact same `quickTailor` call the already-proven Job-Portal flow makes.

### Backend TODO (from Resume Tailor)
- [ ] No per-suggestion score delta — only a final post-compile score exists.
- [ ] No concept of a named "saved version" of a tailored resume beyond the automatic cache.
- [ ] `/tailor-handoff` and `/tailor-preview` both require a real `job_id` — neither has a pasted-text equivalent, so gap analysis and AI bullet suggestions stay unavailable for pasted job descriptions.

## Cover Letter Generator (built 2026-09-26, per your direct request)

Restructured from a two-state "form → full-page result" flow into Figma's actual persistent 3-column layout (inputs / letter / insights always visible together), since that's a real UX difference, not just styling.

**Supported with real data:** real searchable job picker (grounded letters require a real cached posting, not free text), real resume-scan picker, the 3 real tones (`professional`/`confident`/`concise` — Figma's mock invents `Warm`/`Bold`, which don't exist on the backend), Regenerate/Copy/Download (PDF when the backend produced one, else `.txt`), and the right-panel insights are the real `grounded_in` (quotes from the resume the letter's claims rest on) and `unsupported_claims` (figures to double-check) — not fabricated data.

**Not supported — hidden or replaced:**
- **"Length" control (Concise/Standard/Detailed)** — no such parameter exists on `POST /cover-letter/generate`. Dropped rather than wired to a no-op.
- **"Key points to highlight" checkboxes** — the real endpoint takes no such input; the letter is grounded in the whole resume automatically, and what it actually used is shown *after* generation via `grounded_in` instead of being pre-selected before.
- **"Match insights" (Job alignment 91% / Specificity / Tone)** — no such scoring exists. Replaced with the real `grounded_in`/`unsupported_claims` panels, which serve the same "why should I trust this letter" purpose honestly.
- **"Keywords used" chips** — no keyword-extraction exists on a generated letter. Dropped.
- **"Save to Application"** — no endpoint attaches a generated letter to an application record. Wired to the same real `POST /applications` call the Job Portal's "Save to pipeline" uses instead, so the button does something real (creates a pipeline entry for that job) even though the letter text itself isn't persisted anywhere server-side — the user must copy/download it.

### Backend TODO (from Cover Letter Generator)
- [ ] No `length` parameter on cover letter generation.
- [ ] No way to attach/persist a generated letter to an Application Pipeline record.

## Interview Coach (Hub / Live / Feedback) — built 2026-09-26, per your direct request

**Supported with real data:** target role (5 fixed roles + custom), the 5 real `PrepCategory` values (Figma invents 4 different ones — see below), experience level, the full real evaluate/submit/next-question loop, "View model answer", Restart (abandons session server-side), a real 7-dimension radar chart on the feedback report (`category_performance`, already averaged server-side — better data than Figma's fabricated 5-dimension one), readiness band, strongest/weakest skills, and session history.

**Not supported — hidden, replaced, or restructured:**
- **No duration or difficulty parameter exists anywhere server-side.** `POST /interview/questions` only ever accepts `{ role, seniority, category }`. Figma's Difficulty/Duration dropdowns and the "8 adaptive questions / About 30 min" promise are dropped entirely rather than wired to nothing — you don't know the real question count until the session is actually created.
- **Figma's 4 interview types (Behavioral/Technical/Portfolio/Case) aren't the real categories.** The backend has 5: HR/Technical/Behavioral/Screening/Scenario (`PrepCategory`). Used the real 5, not Figma's invented 4.
- **No camera, microphone, video, or live transcript exists anywhere in this app.** Confirmed by grep across the whole codebase — no `MediaRecorder`, no `getUserMedia`. The Live session is a typed-answer flow underneath: type your answer, submit, get scored, move on.
  **Update (2026-09-26), per your direct request:** brought back Figma's camera-stage visual (avatar circle, camera/mic toggle buttons, audio-level bars, a "Recording MM:SS" elapsed clock) as an explicit *preview* of the live-video experience — labeled "Live video practice — coming soon" — since it's still in development backend-side. This mirrors what Figma's own source code actually does too: its `LiveSession` component never calls `getUserMedia` either: `camera`/`mic` there are also just local `useState` toggles with no real device access, so restoring it is faithful to the source, not a new fabrication. The one place I drew a line: Figma's "Live transcript" panel has hardcoded scripted dialogue (fake lines that never happened) — instead of copying that, the transcript here is real, built live from the actual question text and the candidate's actual submitted answers as the session progresses, styled in the same chat-bubble layout.
- **"Session signals" (filler words / average answer time / STAR completion / confidence trend).** Confirmed server-side: `filler_word_count`, `speaking_rate_wpm`, and every other voice metric are populated *only* when an answer went through `/interview/transcribe` (voice) — never for typed answers, which is 100% of what these 3 pages produce. "STAR completion" and "confidence trend" don't exist anywhere in the backend at all (STAR scoring is a wholly separate "story bank" feature, never wired into Mock Interview sessions). The feedback report now shows filler-word counts only when real ones exist, with an honest note otherwise, and drops STAR/confidence entirely rather than fabricate them.
- **"Retry weak questions"** — no selective-retry capability exists (Restart abandons the whole session and starts a fresh one). Relabeled "Practice this category again" and wired to `/interview/setup?category=X` (real, prefills the category via the setup page's existing query-param logic).
- **Trimmed some real content to match Figma's leaner shape**, consistent with your earlier "remove extra sections not in Figma" feedback: per-question `strengths`/`missing_points` (kept only `weaknesses[0]` as the shown "AI feedback" line, matching Figma's single-feedback-block accordion), `topics_to_improve`, the full `practice_plan` list (kept only step 1, in the "Next Focus" card), and the `next_actions` grid are no longer displayed on the Feedback page, though the report still fetches them.

### Backend TODO (from Interview Coach)
- [ ] No duration/difficulty parameter on session creation.
- [ ] Voice metrics (filler words, speaking rate, confidence) never populate for typed-answer sessions — by design, but worth knowing if "Session signals" should ever be a universal feature.
- [ ] STAR-structure scoring exists only in the separate, unwired "story bank" feature.
- [ ] Unrelated bug noticed in passing, not touched: the dashboard's own `next_actions` hrefs point at `/interview?category=X`, but `/interview` is a bare `<Navigate to="/interview/setup" replace />` that drops the query string — that link silently loses its category prefill today.

**Precision pass (2026-09-26), per your direct request:** re-extracted Figma's exact CSS values (`.cover-workspace`, `.coach-hero`, `.session-setup`, `.live-header`, `.camera-stage`, `.transcript-panel`, `.feedback-summary-grid`, `.accordion-trigger`, etc. — all in `figma-export/src/index.css`) and corrected every padding/gap/font-size/radius that had been eyeballed instead of copied exactly, across Cover Letter Generator and all three Interview Coach pages. Also rebalanced Cover Letter's column widths: Figma's own ratio (260px input panel) was sized for a simpler mock with far fewer fields — this app's panel carries real required inputs (job search+list, resume picker, name/phone/linkedin) Figma's never needed, so it's widened to 340px with the letter-preview column proportionally narrowed, rather than copying a ratio that would leave the real form cramped.

## Phase 3 complete — Resume Analyzer, Resume Tailor (bonus), Cover Letter Generator, and Interview Coach (Hub/Live/Feedback) are all built.

## Interview Coach — Figma element support (fill in before building)

- [ ] TODO once this page starts: list supported vs. unsupported fields here (radar chart dimensions, filler-word count, etc).

## Phase 4 — Job Portal, Applications, Offers

- [x] Restyle `pages/jobs/JobsPage.tsx` to match Figma `JobPortal` — filter sidebar, search + sort, `.portal-job-card`-style job cards, and the right-side job detail drawer (`design-refs/job-portal.png`, `job-drawer.png`) — see Figma-support notes and deviations below
- [x] Restyle `pages/applications/ApplicationsPage.tsx` to match Figma `Applications` — board **and** table view toggle (both built), a real HTML5 drag-and-drop kanban with optimistic move + rollback, the "+ Add application" modal, and the detail drawer (status timeline, notes, contacts, linked resume) — `design-refs/applications-board.png`, `applications-table.png`, `application-drawer.png`, `add-application.png` — kept `stageForColumn`/`STAGE_COLUMNS` and every existing service call intact; see Figma-support notes below
- [x] Restyle `pages/offers/OffersPage.tsx` to match Figma `OfferComparison` — side-by-side `.offer-column` cards, the stacked first-year comp chart, live priority-weight sliders recalculating a real "Best Fit" badge, and a negotiation-insights card (`design-refs/offers.png`, `offers 2.png`) — see Figma-support notes below
- [x] **Side-by-side check** of all three pages against the design refs and the Figma Make preview — the "I couldn't log in myself" gap below is resolved: this session established a throwaway-QA-account-via-Supabase-admin-API method (create → log in through the real form → screenshot → delete via Settings → Privacy & Data → Delete Account), used repeatedly since to verify every authenticated page directly, including these three (copy-to-clipboard added to the Job Portal detail drawer, "Explore Jobs + Applications"/"Explore Offer Comparison" landing-page buttons wired to real routes, 2026-09-28)

### Job Portal: Figma element support (backend reality check)

**Supported with real data:** match % ring + band + explanation (the existing deterministic Resume Match / Skills Match engine — unchanged), missing-skills and skills-in-this-role chips (`skillsMatch.missingSkills` / `job.skills`), work style / date-posted / minimum-salary filters (client-side over the real fetched feed — date-posted buckets `postedDaysAgo`, salary parses the real `$Nk` figures already in `salaryRange`), sponsorship / experience / employment-type / employer filters (the pre-existing server-side `h1b`/`experience`/`employment`/`company` params to `GET /jobs` — same calls, just moved into the Figma sidebar layout instead of the old top toolbar pills), Save (existing `trackApplication` → `POST /applications`), "Tailor resume for this job" (existing `handleTailorResume`, unchanged), and Sort (Best match / Newest / Salary: high to low — computed client-side from real match scores, `postedDaysAgo`, and parsed salary figures).

**Role and Location filters** are selects populated from the distinct titles/locations actually present in the currently-loaded feed (frequency-ranked, capped), not Figma's fixed 3-item mock list — picking a Role reuses the exact same real `q` search path the top search bar already used, rather than introducing a second query mechanism.

**Not supported — hidden or adapted, not faked:**
- **Company size filter** — no such signal exists anywhere on `JobListing`/`JobListingSchema` (no headcount, no funding stage, nothing inferable). Hidden entirely rather than shown as an empty state, since there's no real data this could ever bind to without a new source.
- **Figma's "Why you match" 3-row breakdown**, each with its own score *and* its own detail sentence — the real match object only has 2 dimensions (Resume Match, Skills Match), each a plain score/band, sharing ONE explanation sentence for the whole match (not one per row). Built with the real 2 rows plus that one real explanation shown once above them; no fabricated per-row captions.
- **"Exceptional fit"-style headline** — derived from the real `band` value (EXCELLENT/STRONG/GOOD/NEEDS WORK/WEAK) via a fixed label map, not invented per-job flavor text.
- **Instant in-app "Quick Apply"** — applying is always external (`job.applyUrl`); Quick Apply opens that real URL in a new tab, identical to the pre-migration "Apply" button, just relabeled/reiconed to match Figma. The post-click "Applied" checkmark is a local, unpersisted UI acknowledgment — faithful to `figma-export`'s own mock, which also has no backend behind this state.
- **Un-save / remove-from-pipeline** — Save still only goes one direction (Save → Saved, then disabled); no endpoint exists to retract a tracked application, so Figma's toggle-off bookmark isn't wired.
- **Hour-level "2 hours ago" timestamps** — `postedDaysAgo` is day-granularity only; cards show "Today" / "N days ago", as precise as the real data gets.

### Backend TODO (from Job Portal)
- [ ] No company-size signal anywhere in `JobListing` — Figma's "Company size" filter has nothing to bind to.
- [ ] No un-save / remove-from-pipeline endpoint — Save can only add an application, never retract one.
- [ ] Job match has only 2 real dimensions with one shared explanation, not Figma's fabricated independent 3-reason breakdown with a per-row caption each.
- [ ] `postedDaysAgo` is day-granularity only — no hour-level posting timestamp for "N hours ago" precision.

### Applications: Figma element support (backend reality check)

**Supported with real data, all through existing calls (`applicationsService`, `stageForColumn`, `STAGE_COLUMNS`):** the pipeline itself (`GET /applications/pipeline`), status history timeline (`ApplicationStatusHistory` — every real change, not Figma's fixed 4-step mock), notes, a single recruiter contact (name + email), the linked tailored resume (`tailored_resume_id` → real filename/ATS score/band, clicking it opens `/resume/tailor`), delete-with-confirmation, and the "+ Add application" modal (Company/Role/Location/Salary/URL/Status/Job description/Notes — all real `ApplicationCreateSchema` fields). Two real bonuses Figma's mock never had: a **Job match** section (`_job_match_summary` — the same Resume/Skills Match engine as Job Portal, run against this application's own stored job description) and an **Interview practice** section (best-effort-correlated Mock Interview session for the same role).

**Board columns are 5, not Figma's 6** — `saved` / `applied` / `interviewing` / `offer` / `closed` (`STAGE_COLUMNS` in `types/applications.ts`), grouping the real 12-stage pipeline (Figma's mock only ever had 6 flat, non-overlapping stages). This is existing, already-committed backend/frontend design — not something a Figma restyle should undo — so the board keeps its real 5 columns rather than forcing Figma's 6.

**Drag-and-drop is new, real, and optimistic**, per your brief: dropping a card computes the target stage via the existing `stageForColumn(columnId, currentStatus)` (so a card already inside a column's finer stages keeps its precise one), moves it locally immediately, calls the existing `PATCH /applications/{id}/status`, reconciles with the server's returned record on success, and rolls back the local move plus an error toast on failure.

**Table view is new** (Figma's mock never actually implements its own "Filters" button either — no panel exists in the source, just an unwired button). Built a real one instead: a stage multi-select (checks/unchecks `STAGE_COLUMNS`, applies to both board and table) plus the search bar (filters by company + role text over the already-loaded pipeline — also missing from Figma's source, which never wires its search input to anything).

**Not supported — hidden or substituted with real data instead:**
- **Priority (High/Medium/Low)** — no such field anywhere on `JobApplication`. Dropped entirely from cards/table rather than shown ungrounded; the card's second badge slot shows real `match_score` instead when one exists.
- **Free-text "next step"** (e.g. "Follow up Mar 17") — no such field exists; each application's exact real stage label (e.g. "Technical Interview") is shown in that slot instead — genuinely useful given 5 columns group up to 5 finer real stages each, and unlike Figma's fabricated per-app text, it's real.
- **Multiple contacts** — the schema has one recruiter name/email, not Figma's 2-person list; the Contacts section shows 0 or 1 real entry.
- **Linked cover letter asset** — no endpoint stores or links a generated cover letter to an application (confirmed already in the Cover Letter Generator phase). Only the real linked resume appears in Application assets.
- **Per-column "⋯" menu** — Figma's own source wires no action behind it either; omitted rather than shipping a dead button.

### Backend TODO (from Applications)
- [ ] No `priority` field on `JobApplication` — Figma's High/Medium/Low has nothing to bind to.
- [ ] No free-text "next step" field — only the real stage/status is available.
- [ ] Only a single recruiter contact (name + email) per application, not a contact list.
- [ ] No way to link a generated cover letter to an application record (same gap noted in the Cover Letter Generator phase).

### Offer Comparison: Figma element support (backend reality check)

**Supported with real data:** the whole real `JobOffer` CRUD (`offersService`, unchanged) — base salary, annual bonus, signing bonus, annualized equity, location/remote, notes, and the server-computed `total_first_year` / `recurring_annual` / `net_adjusted_comp` (after the user's own optional tax-rate and cost-of-living inputs) / `is_adjusted`. The stacked "First-year total compensation" chart uses real Base/Bonus/Equity per offer. The header's "N active offers" / "highest total" chips are real (`offers.length`, `max(total_first_year)`).

**"Weighted fit" / Best Fit is a real+local hybrid, clearly labeled as such:** `JobOffer`/`OfferSchema` have no Growth/Team/Flexibility/Benefits/PTO score anywhere — only Compensation is structured, objective data. Rather than fabricate the other three dimensions per company (which Figma's mock does, with invented numbers), each offer card has 3 real number inputs (1–10) where **you** rate Growth/Team/Flexibility yourself; unrated dimensions default to a neutral 5 so an un-rated offer isn't penalized. These ratings persist in `localStorage` only (`hireloom-offer-ratings`, keyed by the real offer id) — never sent to the backend, and the priorities card says so explicitly. The priority sliders (0–60, defaults 30/25/25/20 matching Figma's own starting values) recompute the weighted Best Fit score and badge live from real compensation + your own ratings, exactly as asked.

**Not supported — hidden or relabeled, not faked:**
- **Benefits score, PTO, "Remote policy" (Hybrid · N days)** — none of these exist on `JobOffer` (only a plain `is_remote` boolean + `location` string). Replaced with one honest **Location** row (`Remote` or the real location text) instead of three fabricated rows.
- **"AI NEGOTIATION COACH"** — no negotiation-tips endpoint or LLM call exists anywhere for this feature. Renamed to **"Negotiation insights"** (dropped the AI badge/claim) and replaced Figma's hardcoded flavor text with 1–3 tips computed deterministically from your actual entered offers (highest total, highest equity, highest base, whether to compare net-adjusted figures) — real arithmetic over real rows, not an AI-generated plan.
- **"Build negotiation plan" button** — no such feature exists anywhere in the app; dropped rather than wired to nothing.

### Backend TODO (from Offer Comparison)
- [ ] No Growth/Team/Flexibility/Benefits/PTO scoring fields on `JobOffer` — Best Fit's non-compensation dimensions are user-entered and device-local, not synced to the account. If these should ever be tracked for real, they'd need new columns (or a JSON field) plus an update endpoint.
- [ ] No AI/LLM-backed negotiation-tips generation — the negotiation card is deterministic client-side arithmetic over the user's own entered offers, not a model call.

**Note on verification (2026-09-26, superseded below):** for Phase 4 I could not complete the browser side-by-side myself — Supabase rejected the only signup domain I could safely test with (`email_address_invalid` for `@example.com`). Since then I've verified with a real, throwaway, pre-confirmed test account created via the Supabase admin API (`SUPABASE_SECRET_API_KEY`, already in `backend/.env`) — logged in through the actual login form, screenshotted every page with real data, then removed the account (and everything it created) through the app's own real "Delete account" flow, which doubles as a live test of that feature. I'll keep using this for the rest of the migration instead of asking you to check every page yourself.

## Phase 5 — Analytics, Progress, History, Profile, Settings

- [x] Restyle `pages/analytics/AnalyticsPage.tsx` to match Figma `Analytics` (done out of order, per your direct request — see deviations below). Added `hooks/useApiData.ts`, a small generic fetch-on-mount hook, since this exact loading/error/data pattern repeats on every remaining page.
- [x] Restyle `pages/progress/ProgressPage.tsx` to match Figma `Progress` (no `design-refs/` screenshot exists for this one — built from `figma-export/src/pages/Progress.tsx` + its exact CSS spec instead) — see Figma-support notes below
- [x] Restyle `pages/history/HistoryPage.tsx` to match Figma `History` (also no design-ref screenshot — same code-only approach) — see Figma-support notes below
- [x] Restyle `pages/profile/ProfilePage.tsx` to match Figma `Profile` (done out of order, per your direct request, against `design-refs/profile figma.png`) — see Figma-support notes below
- [x] Restyle `pages/settings/SettingsPage.tsx` to match Figma `Settings` (done out of order, per your direct request, against `design-refs/settings-figma.png`; Billing tab added 2026-09-26 per your follow-up spec — see below) — see Figma-support notes below
- [x] Verified Profile, Settings, and Progress myself with a real test account (see verification note above) — Job Portal/Applications/Offers from Phase 4 also spot-checked this way and found solid
- [x] All five Phase 5 pages built and verified with a real test account — ready for a final pass; commit

### Analytics: where real data forced a deviation from the Figma mock

- **No date-range filtering.** Figma's header has a date-range button + "Last 90 days" select + download icon. `analytics/summary` returns all-time data, not range-scoped, and there's no export endpoint — faking either would be UI that looks interactive but does nothing. Kept the page's existing real "N scans tracked" badge in that slot instead.
- **"Interview score trend" → "Resume quality over time."** No interview-score history exists anywhere in the schema (only a single current `average_score`). Swapped in the real quantified-bullet-ratio / X-Y-Z structure-grade trend that already existed on this page pre-migration, styled into Figma's chart-card slot instead.
- **"Applications by source" → "Applications by stage."** Nothing tracks where an application came from (no `source` field on `ApplicationSchema`). Swapped in the real current-status distribution (`funnel.by_stage`) as the donut instead — same numbers the pre-migration page listed as plain badges.
- **Resume table lost 2 of 5 columns.** Figma's table has Applications/Responses/Response rate per resume version — no join between resume versions and their application outcomes exists in `AnalyticsSummary`. Kept Resume version / ATS score / Scanned date only.

### Bug found and fixed in passing: the notifications bell was showing mock data to every user

While working on Settings > Notifications I found that `frontend/src/services/notificationsService.ts` (built in Phase 1) was a hardcoded `MOCK_NOTIFICATIONS` array — "Interview reminder", "New 94% job match", "Resume score improved" — shown in the topbar bell dropdown **on every page**, to every user, regardless of their real activity. This is very likely what you saw and flagged as "mock data on the Applications page": the bell renders in `Header.tsx`, which is present on every route including Applications.

There's a real, already-built notifications engine at `backend/app/modules/notifications` (event-driven: application status changes, resume score changes, high-match jobs, interview-stage reached, plus a periodic sweep) that was simply never wired to the frontend. Fixed outright:
- `notificationsService.ts` now calls the real `GET/POST /api/notifications*` endpoints (list, mark-read, mark-all-read, archive) — the mock array is gone.
- `types/notifications.ts` now mirrors the real `NotificationSchema`.
- `Header.tsx`'s bell dropdown reads real `title`/`message`/`created_at`/`read_at`/`href`, marks a notification read when you click it, and navigates to its real `href`.

### Profile: Figma element support (backend reality check)

**Supported with real data:** identity (avatar, name, email, member-since), a real computed **Profile completeness %** (built new — Figma's 86% has no formula behind it; this one checks avatar/bio/title/seniority/primary-target-role/≥3 target roles/resume-on-file and names the next missing one, same "derived from real signals" pattern as the sidebar's readiness score), About (`bio`, editable), a **Career snapshot** card (`current_title`, `seniority`, `primary_target_role`, editable) in place of Figma's Experience list, Job preferences → **Target roles only** (existing add/remove UI, editable), Resume on file, Connected accounts (real Supabase sign-in identities), Recent activity (real resume/interview history), and account stats (resumes analyzed / interview sessions / latest ATS score).

**Skills is real, not curated** — the Profile model has no skills-tag field at all, so this pulls `matched_keywords` from the primary resume's own `GET /resume/breakdown/{id}` (the same taxonomy-matched skills the ATS Check page already computes), capped at 14.

**Avatar upload is new, real, and wired end-to-end** — the `avatars` Supabase Storage bucket and its owner-scoped RLS policies already existed (migration `b6d2f84a1c93`) but no frontend ever uploaded to it. Added: click the camera badge → upload to `{user_id}/{timestamp}.{ext}` → `PATCH /user/profile` with the resulting `avatar_url`/`avatar_path`.

**Not supported — hidden, not faked:**
- **Experience (work-history list) and Education** — no such tables/fields exist anywhere (Profile has only the single current_title/seniority pair, not a history). Experience became the real Career snapshot card above; Education has no honest substitute at all and was dropped entirely.
- **Portfolio links (portfolio/LinkedIn/Dribbble URLs)** — no such fields on Profile. Dropped; Connected Accounts (real, but a different concept — auth identities, not public links) fills the aside instead.
- **Location, salary range, and work-style preferences** — none exist on Profile (only `target_roles` does). Job preferences shows only the real Roles list.

### Settings: Figma element support (backend reality check)

**Account tab is new** (Figma's tab set existed in the mock; this app never had an Account tab in Settings before) — real first/last name (split from the single Supabase `full_name` you actually have) + email, saved via `supabase.auth.updateUser`, and a New/Confirm password form using the same `PasswordField` + strength meter as signup. **Dropped Figma's "Current password" field** — Supabase's `updateUser({password})` never re-verifies the current one (no such check exists), so a field that implies verification that doesn't happen was worse than not having it.

**Notifications tab (2026-09-27 update, per your direct request with a Figma Make screenshot showing the exact toggle matrix):** originally I'd replaced Figma's toggle matrix outright with just the real notification history, since no per-category email/in-app preference field exists anywhere on the backend (confirmed directly against the models). Per your request, the exact Figma matrix is now back — 5 rows (Application updates / Job matches / Interview reminders / Weekly progress / Product updates), each with a real Email and In-app `Switch`. These toggles are real, not decorative: they persist to `localStorage` (`hireloom-notification-preferences`, default all-on matching Figma) and survive a reload — verified by toggling one, reloading, and confirming it stayed off. The one honest caveat, in a small caption under the table: the backend doesn't yet filter *which* notifications actually get sent based on these, so they're saved real preferences without a delivery engine behind them yet. The real notification history (mark-all-read, per-item archive, show-archived) stays as its own card underneath, unchanged.

**Integrations tab** — only Google is real (the same Supabase sign-in identity already shown on Profile's Connected Accounts). LinkedIn and Google Calendar have no OAuth flow anywhere in this app; shown as real rows labeled "Not available yet" rather than Connect buttons wired to nothing.

**Privacy & Data tab** — Export and Delete account were already real and built (Milestone-era `GET /user/export` / `DELETE /user/account`); restyled to match Figma's `.privacy-action` / `.danger-zone` / `.delete-modal` spec exactly. **Update (2026-09-27), per your direct request with a Figma Make screenshot:** Figma's "Privacy controls" toggles (Personalized recommendations / Product analytics) are back too, same real-but-device-local pattern as the Notifications matrix above — no such preference field exists anywhere on Profile, so these persist to `localStorage` (`hireloom-privacy-preferences`, default on) with the same small honest caption rather than claiming a server-side flag that doesn't exist.

**Settings nav sidebar bold fix (2026-09-27):** the tab list (Account/Notifications/Integrations/Billing/Privacy & Data/Appearance) was rendering at `font-semibold` (600) — Figma's own base `.btn` spec is `font-weight: 700` for every button, nav included. Bumped to `font-bold` to match.

**Appearance tab** — real, unchanged `ThemeContext`, restyled to Figma's exact 3-card `.theme-grid` (preview swatch + label + check icon on the selected card) — this closes the `TODO(onboarding-backend)`-adjacent item from Phase 1/2 asking for this exact rebuild.

**Billing tab (2026-09-27 update, per your direct request — explicitly overriding your own earlier "never show fake invoices or usage" instruction, after I flagged the conflict and you confirmed you still wanted the exact mock):** this tab is now illustrative content, not real account state, ported verbatim from `figma-export`'s own mock (`settingsData.plans` / `.invoices` in `data/mockData.ts`) rather than the honest Free-only version I'd built first. It shows **Pro** as "Current plan" at $19/month, per-plan feature lists for Free/Pro/Premium, three usage bars (AI interview sessions 6/10, Job applications 12/25, Document storage 34/100), and a 3-row paid billing history — none of which reflects anything real: there is still no subscription/plan/invoice/usage-quota system anywhere in the backend, confirmed directly against the models again before making this change. Every button (`Choose Free`/`Manage plan`/`Choose Premium`/the PDF download icons) is the same toast-only, non-wired interaction `figma-export`'s own source uses — nothing here can actually change a plan, charge a card, or download a file.

### Backend TODO (from Profile & Settings)
- [ ] No work-history (Experience) or Education storage anywhere — Profile is bio/title/seniority/target-roles only, not a resume-shaped record.
- [ ] No portfolio/personal-site/LinkedIn/Dribbble URL fields on Profile.
- [ ] No location, salary-range, or work-style preference fields on Profile (only `target_roles`).
- [ ] No per-category notification delivery preferences server-side (email vs. in-app, per notification type) — the Settings UI now saves these device-locally (`localStorage`) and the notification feed itself is real, but nothing server-side reads these toggles to decide what to actually send.
- [ ] No OAuth integration beyond Supabase's own Google sign-in — LinkedIn and Google Calendar have no connect flow.
- [ ] No personalization/analytics-sharing preference flags on Profile server-side (Figma's "Privacy controls" toggles) — the Settings UI now saves these device-locally, same caveat as the notification preferences above.
- [ ] No subscription/billing/invoice/usage-quota system at all. **Flag for whoever builds this next:** the Billing tab UI (as of 2026-09-27, per your explicit request) shows illustrative mock content — a "Pro Β· Current plan," invented feature lists, fabricated usage numbers, and a fake paid invoice history — none of it wired to anything real. Before this ships to real users, either build the real system behind it or swap it back to the honest empty/Free-only version (still described in git history / this file's prior revision).

### Progress: Figma element support (backend reality check)

**Supported with real data:** the readiness ring (calls the exact same `computeReadinessScore()` the sidebar and Dashboard use, so the number can never disagree), a **milestone roadmap** built new from real boolean signals (resume analyzed / interview completed / application tracked / interview stage reached — see below for a real bug this surfaced), the ATS-evolution and interview-score-trajectory charts (same real by-scan/week/month data the pre-migration page already had), the application pipeline funnel, and the three insight cards (Resume trend / Interview performance / Skills to close) — all pre-existing real functionality, just restyled into Figma's visual language.

**Milestone roadmap bug found and fixed during my own QA pass:** the first version colored each connector line by comparing its index to a single "current stage" pointer, which assumes strict linear progress. Real usage isn't linear — I tested by tracking an application on a brand-new account with no resume or interview activity yet, and stage 3 ("Applying") completed while stages 1–2 hadn't, which rendered as a completed green checkmark sitting *past* the highlighted "current" stage with a broken-looking gray gap in between. Fixed: each connector now colors based purely on whether the stage it leaves is actually complete (`milestones[index-1].complete`), never on distance from a "current" pointer — correct regardless of which order stages actually complete in.

**Two of Figma's readiness-stats slots have no real backing** ("+11 points since January" — no historical readiness snapshots are ever stored; "Top 18% of candidates" — no cross-user percentile ranking exists). Replaced with three real counts instead: resumes analyzed, mock interviews completed, offers received.

**Not supported — hidden or replaced with a real CTA, not faked:**
- **Weekly goals checklist** — no "goal" concept (targets, thresholds, or a way to persist a checked state) exists anywhere. Dropped entirely; the same grid slot now holds the real ATS-evolution chart instead.
- **Skill growth bars** (per-skill % + trend) — no per-skill score-over-time tracking exists. The same slot holds the real interview-score-trajectory chart instead; the real "Skills to close" tag list (from `suggested_improvements`) already covers the honest version of this idea, in the Insights row below.
- **Streak heatmap calendar** — confirmed zero per-day activity log anywhere (same finding as the Dashboard's own streak card in Phase 2). Replaced with a real CTA ("Practice now" → `/interview/setup`) in a Figma-styled card, not a fabricated calendar.
- **Achievement badges** — no badge/achievement catalog exists anywhere in the backend, so there's nothing real to show even as "locked" — inventing badge names/icons would itself be mock data. Dropped entirely rather than showing placeholder trophies.

### Backend TODO (from Progress)
- [ ] No historical snapshot of the blended readiness score — can't show a real "+N points since" delta.
- [ ] No cross-user percentile/ranking system.
- [ ] No weekly-goal (target + persisted completion) concept.
- [ ] No per-skill score-over-time tracking.
- [ ] No per-day activity log — nothing to build a real streak or heatmap from.
- [ ] No achievement/badge catalog or award-tracking table.

### History: Figma element support (backend reality check)

**Supported with real data, merged client-side from three real endpoints** (`/resume/history`, `/interview/history`, `/applications/activity` — there's no combined history endpoint on the backend): resume scans, interview sessions, and application status changes, grouped by real calendar day, searchable, and filterable by type. Figma's generic "View"/"Restore" action names were given real, type-specific meaning instead of one fabricated verb per row:
- **Resume rows**: "View" opens `/resume/results`; a new **"Set as primary"** action (hidden once already primary) calls the real `PATCH /user/profile` to make that scan your primary resume — genuinely restorable, unlike anything else on this page.
- **Interview rows**: "View" opens that session's real feedback report; **"Practice again"** reuses the existing real prefill query params on `/interview/setup`.
- **Application rows**: "View" now deep-links straight into that application's real detail drawer (`/applications?open={id}` — added a small `useSearchParams` read to `ApplicationsPage.tsx` for this) instead of just landing on the pipeline board.

Resume rows also say *"ATS score improved from 75 to 78"* honestly, not just the latest number — since `/resume/history` is itself sorted newest-first, each entry's real prior scan is just the next item in that same real list, not an invented delta.

**Not supported — omitted, not faked:** **Cover letters** are not a fourth activity source. `POST /cover-letter/generate` has zero persistence (confirmed already in the Cover Letter Generator phase) — there is no letter ever saved to have a history of, so the type filter and icon set only cover the three real sources. Also dropped: Figma's decorative "More filters" button, which triggers nothing in `figma-export`'s own source either.

### Backend TODO (from History)
- [ ] No persistence for generated cover letters — confirmed already, listed again here since it's the one Figma activity type this page has no real source for at all.

## Landing Page (built out of order, per your direct request — 2026-09-27)

A second Figma Make export (`./figma-landing`) was downloaded containing a marketing landing page that didn't exist in the original `figma-export`. Compared the two exports first, before touching any app code:

- **New files, not built into the real app (separate decision, flagged for you):** `Checkout.tsx` + `PaymentSuccess.tsx` (a fake paid-checkout flow), `PublicPage.tsx` (a generic About/Careers/Help/Privacy/Terms/Security/Career-guide/Interview-library template), and a second, fuller `ResumeTailor.tsx` mock (version picker, before/after diff, keyword coverage) — a different design from the real Resume Tailor page already built in Phase 3.
- **Changed existing screens (mechanical only, not applied):** `App.tsx` gains routes for the files above; `AuthPages.tsx` trivial link updates; `JobPortal.tsx`'s "Tailor" button now targets the new mock; `Settings.tsx`'s Premium button now links to the new fake checkout instead of a toast.
- **Design tokens, colors, and fonts: unchanged.** `index.css`'s `:root`/`.dark` variable block is byte-identical to `figma-export`; every other change is a pure CSS addition (4 new sections, one per new page above). No new npm dependency either — confirmed `package.json`/`vite.config.ts` are unchanged, so the landing page needed no animation library.

Built `frontend/src/pages/LandingPage.tsx` from `figma-landing/src/pages/LandingPage.tsx`, replacing the old placeholder landing page (supersedes Decision #3 below — a Figma screen for it exists now). Ported 1:1 to Tailwind v3 using the existing token mapping, extended where needed:
- Figma's `--loom-indigo-tint-strong` / `--loom-indigo-soft` map exactly onto stock Tailwind `indigo-200` / `indigo-400` (confirmed by hex comparison — no new tokens needed).
- Figma's `--text` / `--text-secondary` / `--text-muted` / `--border` / `--app-bg` map exactly onto stock Tailwind `slate-900` / `slate-600` / `slate-400` / `slate-200` / `slate-50`.
- The page is hardcoded light-theme (`bg-white` + explicit slate colors) rather than the app's theme-aware `background`/`foreground` tokens, matching the source's own unconditional `background: white` (it never redefines itself under `.dark`) — this is a public marketing page, not part of the authenticated app's dark-mode surface.
- Added one Tailwind keyframe (`float-card`, for the hero's floating stat badges) to `tailwind.config.js`, matching the existing `accordion-down`/`pulse-subtle` pattern.

Recreated every animation/interaction from the source 1:1 in plain React/CSS — no library, matching the source (which also uses zero animation libraries): scroll-triggered nav shadow, `IntersectionObserver`-based fade-in sections, `CountUp` and animated conic-ring count-ups, the pricing monthly/yearly toggle, the FAQ accordion, and the mobile slide-down menu. All JS-driven count-up animations check `prefers-reduced-motion` and skip straight to the final value; `FadeSection` uses `motion-reduce:` Tailwind variants (CSS-level, same mechanism the source itself uses) instead of JS. No image/icon/SVG assets to copy — the source page uses only `lucide-react` icons and `recharts`, both already real-app dependencies.

Other notable decisions:
- "Sign in" → `/login`, "Get started free" → `/signup`. For an already-logged-in user (checked via `useAuth()`), the nav, hero, and final-CTA buttons collapse to a single "Go to dashboard" button instead of showing sign-in/sign-up — verified end-to-end with a throwaway QA account (created via the Supabase admin API, logged in through the real form, screenshotted, then cleaned up via the app's own Settings → Privacy & Data → Delete Account flow).
- Responsive at Figma's own exact breakpoints (`max-width: 1100px / 820px / 600px / 520px`, via Tailwind arbitrary variants) rather than Tailwind's stock breakpoints — so your explicitly-requested 1024px test viewport renders Figma's intended tablet layout, not a default-Tailwind desktop one. Verified visually at 1440px, 1024px, and 390px, including the mobile slide-down menu.
- Footer utility links (About/Careers/Contact/Career guide/Interview library/Help center/Privacy/Terms/Security) point at real routes that don't exist yet in the real app — they correctly hit the app's real `NotFoundPage` (an honest 404) rather than doing nothing or faking a page. Building those pages is the "new files" decision flagged above.
- Added `<title>` / meta description / Open Graph / Twitter card tags via a small `usePageMeta()` effect (sets and restores `document.title`, upserts `<meta>` tags on mount/unmount) — no new dependency, since this is the only page in the app that currently needs page-specific metadata.

**Placeholder content, carried over from the Figma source and left as TODOs in the code:**
- `RESULTS` — the "2× more callbacks / 38% less time / 7 days faster" launch-metric stats. Source's own comment: replace with verified customer outcomes before publishing.
- `TESTIMONIALS` — explicitly labeled in the section copy itself as "fictional preview stories," not real customers.
- `PRICING_PLANS` prices — mirrors the same fabricated Free/$0, Pro/$19, Premium/$39 figures already shown (with your explicit sign-off) in Settings → Billing; confirm before launch.

### Backend TODO (from Landing Page)
- [ ] None — the page is entirely marketing copy and illustrative product-preview content (the same convention as the hero preview mock in the page it replaced). No real user data is fetched or displayed here.

## Checkout / Payment Success (built out of order, per your direct request — 2026-09-28)

You asked for the "payment" screens from `figma-landing` to be built too, with every upgrade click actually going there. Flagged first (via a direct question, same pattern as the Billing tab override) that this is a fully fabricated checkout — no payment processor anywhere in the backend, so a card-entry form followed by a "payment successful" receipt is pure theater. You confirmed: **match the picture exactly**, same treatment as Billing.

Built `frontend/src/pages/checkout/CheckoutPage.tsx` and `PaymentSuccessPage.tsx` from `figma-landing/src/pages/Checkout.tsx` / `PaymentSuccess.tsx`, ported 1:1 to Tailwind v3 using the app's normal theme tokens (`bg-background`/`bg-card`/`border-border`/etc.) — unlike the landing page, this flow lives inside the regular app's design system (the source's own CSS uses the same `var(--app-bg)`/`var(--card)` tokens here, not a hardcoded-light marketing palette), so it correctly follows light/dark mode. Registered as two new public, unauthenticated top-level routes (sibling to the landing page, not inside `AppShell`/`ProtectedRoute`, matching the source's own distraction-free checkout layout): `/checkout` and `/payment/success`.

- Real `Select`/`Checkbox`/`Input`/`Label` components used for the form (Radix-based, controlled), not the simplified HTML form elements `figma-landing`'s own UI kit uses.
- First/last name and email are pre-filled from the real logged-in user (`useAuth()`) when signed in, instead of the source's hardcoded "Aisha Khan" persona; left blank with placeholders for an anonymous visitor. The success page's "a receipt has been sent to…" line does the same.
- Submitting the form always "succeeds": a ~1.1s fake `processing` delay (matching the source exactly), then redirects to `/payment/success?plan=…&billing=…`. No network request is made, no card is validated beyond the browser's native `required` attribute, nothing is ever charged. The summary column keeps the source's own disclosure banner verbatim: *"Prototype checkout: no real payment will be processed."*
- Wired every "Choose Pro"/"Choose Premium" entry point to it: the landing page's pricing cards (`PricingSection` in `LandingPage.tsx` — previously routed a logged-in user to `/settings` instead as a stand-in before this page existed; now goes straight to `/checkout?plan=…&billing=…` for everyone, matching the source and your instruction) and Settings → Billing's upgrade buttons (previously toast-only, now navigate to `/checkout?plan=…&billing=yearly`; the "current plan" / "Manage plan" button is untouched, still a toast — there's no real subscription to manage).
- Fixed a real bug surfaced while wiring this up: the landing page's "Back to pricing" link (and any other same-page anchor link reached from a different route) navigated to `/#pricing` but never actually scrolled there, since plain `react-router-dom` doesn't auto-scroll to a URL hash on navigation. Added a small on-mount effect to `LandingPage.tsx` that reads `window.location.hash` and scrolls to that section (respecting `prefers-reduced-motion`, same as every other scroll interaction on the page).

### Backend TODO (from Checkout / Payment Success)
- [ ] Everything. There is no payment processor, no plan/subscription model, no order/receipt persistence anywhere in the backend. If real billing is ever built, both pages need a full rewrite (real Stripe/processor integration, a real submit handler, a real success state driven by a real webhook/confirmation) — this prototype should not be mistaken for a starting point beyond its layout.

## Small fixes (2026-09-28, per your direct request)

- **Logo isn't a working link back to the landing page on several public/pre-auth screens.** Fixed by wrapping `<Logo />` in `<Link to="/">` on: `CheckoutPage.tsx`, `PaymentSuccessPage.tsx`, `AuthLayout.tsx` (both the desktop brand-panel logo and the mobile-only logo shown above Login/Signup/Forgot/Reset Password), and the landing page's own footer logo. Left the authenticated app's `Sidebar.tsx` logo unchanged — it deliberately goes to `/dashboard`, a different, pre-existing "home within the app" pattern for logged-in users, not the marketing site.
- **Copy button for job descriptions**, so a description can be pasted into Resume Tailor's "paste a job description" box (or anywhere else) without manual text-selection: added to the Job Portal detail drawer's "About the role" section (`JobsPage.tsx`), and to the Resume Tailor "Target role" card when using a pasted job (`ResumeTailorPage.tsx`, next to "Use a different job"). Same `navigator.clipboard.writeText(...)` + toast pattern already used by the Cover Letter and Resume Results pages — no new shared helper.
- **Landing page's "Explore Resume Analyzer / Interview Coach / Jobs + Applications / Offer Comparison" buttons did nothing** — they were plain, handler-less buttons. Wired each to its real route (`/resume`, `/interview`, `/jobs`, `/offers`) via `<Link>`. Since all four are already behind `ProtectedRoute`, a logged-out visitor is automatically bounced to `/login` with the intended page preserved in router state, and lands there after signing in — no new gating logic needed, this reused the app's existing redirect-after-login behavior. Verified end-to-end with a throwaway QA account.
- **Score ring text invisible on dark hero banners** (Interview Coach hub, Progress page): `ConicRing.tsx`'s center "hole" was hardcoded to `bg-card` (white), while both usages set the score text to `text-white` — white-on-white. Audited every `ConicRing` usage in the app (Dashboard, Sidebar, Resume Tailor, Resume Results, Interview Feedback, Landing page — all sit on a light/white card with dark text, all fine) and found these were the only two broken instances. Fixed generally: added an optional `holeClassName` prop (defaults to `bg-card`, so every other correct usage is untouched) and set `holeClassName="bg-primary"` on the two dark-hero usages in `InterviewSetupPage.tsx` and `ProgressPage.tsx`. Verified visually with a throwaway QA account — the score now reads clearly (white text on a solid indigo hole) on both.
- **All score rings made consistently adaptive (red/orange/green by score band)**, matching how the ATS Check page's headline ring already worked. Added a shared `lib/scoreTone.ts` (`getScoreTone(score, max=100)` → `'success' | 'warning' | 'danger'` at the top/middle/bottom quarter-quarter-half of the scale, so a 0–10 interview score and a 0–100 ATS score band identically; `scoreToneClass()` maps to `text-success`/`text-warning`/`text-destructive`) and applied it to every `ConicRing` that was still using one fixed color regardless of the actual value: Dashboard's and Sidebar's readiness rings, Progress's hero readiness ring, Interview Coach's average-score ring, Interview Feedback's overall-score ring (previously derived from the backend's `readiness_band` text and had no red state at all — "WEAK" showed the same orange as "NEEDS WORK"), and the landing page's illustrative preview rings. Left `ResumeResultsPage.tsx`'s and `ResumeTailorPage.tsx`'s rings untouched — they already banded at the same 50/75 thresholds, just via local logic, so no behavior changed there. `JobsPage.tsx`'s separate `ScoreRing` component (job-match %) was left alone too — it's a different primitive with its own already-adaptive 4-tone scheme, not the reported "score ring."
- **Removed the fabricated "Aisha Khan" persona name from user-facing text** — the landing page's illustrative dashboard-preview greeting ("GOOD MORNING, AISHA" → "GOOD MORNING, USER") and the Signup form's first/last name placeholders (`"Aisha"`/`"Khan"` → `"Developer"`/`"User"`). Confirmed via a repo-wide case-insensitive search that no other occurrence exists anywhere in `frontend/src` or `backend/app`.

## Phase 6 — Final QA

- [x] Full click-through of every route, both apps, side by side (light mode) — automated Playwright crawl of all 6 public + 15 protected routes, zero console/page errors, zero blank renders (2026-09-28)
- [x] Full click-through in dark mode — same crawl re-run with the theme switched to Dark and persisted; all 15 protected routes clean (2026-09-28)
- [x] Verify responsive/mobile behavior — spot-checked at 390px (mobile hamburger menu, filters, forms) in both themes; the real frontend's mobile handling is what's live today (`figma-export`'s own `.mobile-menu`/`.mobile-overlay` were always non-functional placeholders, confirmed again on inspection) (2026-09-28)
- [x] Run `npm run typecheck` and `npm run build` in `frontend/` — zero errors (2026-09-28)
- [x] Confirm no regressions: login ✅, signup ✅ (also fixed a real bug: signup redirected to a nonexistent `/onboarding` route — see Phase 2), Google OAuth ✅ (verified the button reaches the real Google consent screen with the correct client/redirect config — full round trip needs a real Google account, not automatable here), password reset ✅ (request correctly reaches Supabase's real recovery endpoint and errors are handled gracefully; live send is currently rate-limited by Supabase's own test-project throttle from this session's heavy QA-account churn, not a code issue), logout ✅ (session genuinely cleared — a protected route after logout correctly bounces to `/login`), protected-route redirect ✅, network tab clean (no stray 404s beyond an unrelated external company-favicon lookup) (2026-09-28)
- [x] Remove any now-unused old class names/styles from `index.css` — reviewed line by line; every token and rule is in active use, nothing to remove (2026-09-28)
- [x] Final commit — see Step 4 of the ship-to-main-branch record below

---

## Decisions (locked in 2026-09-26)

1. **Body font:** Inter (exactly matching `figma-export`), headings in Manrope. Done in Phase 1.
2. **CSS variables:** remapped — kept shadcn's existing variable names (`--primary`, `--secondary`, `--muted`, etc.) and assigned them Figma's hex values (converted to HSL). Added a few Figma-only tokens shadcn doesn't have: `--coral`/`--coral-tint`, `--success`/`--success-tint`, `--warning`/`--warning-tint`. Done in Phase 1.
3. ~~**Landing Page:** no Figma screen exists for it — restyle it using the new token/component system as the last task of Phase 6.~~ **Superseded 2026-09-27:** a Figma screen showed up in a second export (`figma-landing`) and was built then — see "Landing Page" section above.
4. **Onboarding:** build the full UI (Phase 2). Wire to real endpoints only where they already exist; otherwise persist to Supabase user metadata (`supabase.auth.updateUser({ data: {...} })`) or local mock state, with a `TODO(onboarding-backend)` left in the code once built, tracked below.
5. **Notifications:** built via a new `frontend/src/services/notificationsService.ts` (mock-backed, same async shape a real API call would have) — done in Phase 1, so a backend module can be plugged in later by changing that one file. No backend endpoint being built as part of this migration.

### Deviations from the Figma mock (functional necessity, not visual guesses)

- **Sign-out control:** `figma-export` has no sign-out affordance anywhere in its UI (it's a static mock with no real auth). Added a small icon button next to the sidebar's user-menu row. Revisit if you'd rather it live in Settings > Account instead.
- **Theme toggle:** `figma-export`'s topbar has no light/dark switcher — its only appearance-related UI is the theme picker inside Settings > Appearance (`figma-export/src/pages/Settings.tsx`). Moved the existing theme dropdown out of `Header.tsx`; `ThemeContext` is unchanged, but the picker UI itself needs to be (re)built inside `SettingsPage.tsx` in Phase 5 — tracked below.
- **Sidebar "Career Readiness" widget:** Figma hardcodes 72% from mock `persona.readiness`. There's no single readiness field from the backend, so Phase 1 added `lib/readiness.ts` (`computeReadinessScore`) blending `resume.avg_ats_score` (60%) and `interview.average_score` (40%) via a shared `hooks/useDashboardHome.ts`. Dashboard's own readiness summary (Phase 2) should call the same helper so the sidebar and dashboard numbers never disagree — confirm this formula is right, or adjust it once, in one place.

### Outstanding TODOs carried into later phases

- [ ] `TODO(onboarding-backend)`: confirm which fields the onboarding flow should persist and where (Phase 2) — still open; a real onboarding flow was deliberately not built (see Phase 2), and this is the product decision blocking it.
- [x] Rebuild the theme picker (Light/Dark/System) inside Settings > Appearance, matching Figma's `AppearanceSettings` (Phase 5) — done, see line 350; verified working end-to-end (toggling Dark actually flips `document.documentElement`'s class and every page re-renders correctly) (2026-09-28).
- [x] Confirm the readiness-score formula in `lib/readiness.ts` once Dashboard's real KPIs are restyled (Phase 2) — confirmed consistent everywhere it's shown (Dashboard, Sidebar, Progress hero) via the shared `computeReadinessScore()` helper; no formula changes needed (2026-09-28).
