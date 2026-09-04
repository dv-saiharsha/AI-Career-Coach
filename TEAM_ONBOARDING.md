# Team onboarding & task assignment

You're joining ApplyCenter (repo name: AI Career Coach), which has so far been
built solo. This file is the handoff: what state the project is actually in,
what to do to get running, and what's assigned to whom. It is deliberately
separate from [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[ROADMAP.md](ROADMAP.md) and [PROJECT_STATUS.md](PROJECT_STATUS.md) — those
already cover setup and architecture in depth and are not repeated here.
Read this file first; it tells you which of those to read next and in what
order.

---

## 0. Before anyone can pull anything — do this first

**The active branch is not on GitHub yet.** All current work is on
`redesign/violet-neumorphic`, which is **87 commits ahead of `origin/main`**
and has never been pushed. `main` on GitHub is several weeks stale relative
to what's actually running locally. Nobody can clone or pull the real state
of the project until this is fixed.

**Team lead — do this before assigning anything below:**

```
git push -u origin redesign/violet-neumorphic
```

Then decide, and tell the team which:

- **Everyone branches off `redesign/violet-neumorphic`** until it's judged
  stable enough to merge into `main` (recommended — it's where all recent
  work lives, and branching off a stale `main` means redoing weeks of
  redesign work in every new branch).
- Or merge `redesign/violet-neumorphic` into `main` now via a reviewed PR,
  and have the team branch off `main` as usual.

Whichever you pick, **say it explicitly to the team** — don't leave people to
guess which branch is "current."

### A second thing to resolve before anyone pulls

There is an **uncommitted, uncertain change** sitting in the working tree
right now: `frontend/src/app/page.tsx` differs from what's committed, and the
difference reverts the landing page back to an older, pre-redesign version
(the components it imports — `HeroSection`, `FeaturesGrid`, `TeamSection`,
etc. — were already superseded and removed earlier in this branch's history).
This was not made deliberately in this session and its origin isn't known —
possibly a stray editor autosave, a merge artifact, or something else. It has
**not** been committed or discarded.

**Resolve this yourself before pushing:** either `git checkout --
frontend/src/app/page.tsx` if it's unwanted, or commit it deliberately if
it's something you actually meant to change. Don't hand this off — it's a
one-person decision about intent, not a task to assign.

---

## 1. What this project is, in one paragraph

ApplyCenter is a job-search platform: resume ATS scoring (a trained
scikit-learn model, not just an LLM call), AI-tailored resume generation
(LaTeX → PDF, one or two pages, zero-hallucination — it reorganizes and
selects from the candidate's own content, never invents), an interview coach
with voice answers, a job board fed by free employer ATS APIs (Greenhouse,
Lever, Ashby) rather than a paid aggregator, and account privacy tooling
(GDPR-style export and deletion). Next.js 16 frontend, FastAPI backend,
Supabase (Postgres + Auth), Expo mobile client. Read
[README.md § Architecture](README.md#architecture) for the real diagram.

---

## 2. Environment setup

Don't duplicate steps here — follow
[README.md § Setup Instructions](README.md#setup-instructions) exactly, then
[CONTRIBUTING.md](CONTRIBUTING.md) for coding standards and branch naming.
Two things people skip and then lose an afternoon to, called out because
they're easy to miss on a first read:

1. `git config core.hooksPath .githooks` — without this, dependencies don't
   auto-install after a pull that changes `requirements.txt` or
   `package.json`.
2. `scripts/setup-env.sh` (or `.bat` on Windows) — creates your local `.env`
   files from the tracked `.env.example` templates. It never overwrites an
   existing `.env`, so if a teammate adds a new variable, you re-run this
   script and then fill in the new line yourself — it won't appear by magic.

**Credentials to request from the team lead directly** (never commit these,
never put them in a message to a shared channel): the Supabase project URL,
anon/publishable key, service-role key, JWT secret, and an `ANTHROPIC_API_KEY`
if you're touching anything LLM-backed. See §4 below for why the Anthropic
key currently returns errors for everyone.

---

## 3. Current state — what's live, what's broken, what's proven

- **Backend test suite: 846 tests passing.** `cd backend && ruff check . &&
  pytest -q` before every push, per CONTRIBUTING.md.
- **Frontend: lint, typecheck and build all clean**, ~50 Vitest tests
  passing. Bundle budget gate passes (1 route marginally over, 2 allowed).
- **Auth, privacy export/deletion, real-time SSE scan progress, and the
  employer-board job pipeline are built, tested, and working.**
- **The Anthropic account is out of API credits.** Every LLM-backed feature
  (resume scoring's LLM path, interview coach, career coach, cover letters)
  is currently degrading to a fallback or returning a "temporarily
  unavailable" message rather than erroring with a bare 500 — that failure
  mode was itself a bug that got fixed, but the underlying cause (no credits)
  is still open and is **the team lead's call**, not something to assign.
- **11,000+ job listings are unclassified for H-1B sponsorship** because
  that classification is normally done by paid Claude enrichment. A free,
  rule-based fallback now covers the postings whose language is completely
  unambiguous (see `backend/app/modules/job_market/sponsorship_rules.py`
  and `backend/scripts/backfill_sponsorship_rules.py`) — real Claude
  enrichment should still run on the rest once there's budget for it; the
  rule-based pass is a stopgap, not a replacement.

---

## 4. Assigned tasks

Ranked by what's ready to pick up with no dependency on anything else.
Claim a task by opening a branch named per CONTRIBUTING.md
(`feature/<name>` or `bugfix/<name>`) and a draft PR early so two people
don't collide on the same file.

### Frontend — ready now, no blockers

1. **`/jobs` toolbar alignment.** The search bar, sort control and filter
   dropdowns on the Job Market page need to sit on one consistent horizontal
   grid — currently they don't line up against each other or against the
   shared shell gutter (see `frontend/src/components/DashboardNav.tsx`'s
   `SHELL_GUTTER`/`NAV_ROW_GUTTER` pattern from a recent fix — the same
   "one named constant, applied everywhere, tested" approach applies here).
2. **Company logo hydration.** Logos currently pop in after the rest of a
   job card has already rendered. Pre-resolve them (e.g. Google's favicon
   service, keyed by the company's domain) and load them in the same paint
   as the card's text, not after — the goal is zero visible flicker, the way
   LinkedIn or Jobright render a results list.
3. **Missing "Apply Now" button in the job detail pane.** The panel that
   opens when a job card is clicked currently has no visible primary action
   below the description. Add a prominent button linking to the posting's
   real `apply_url` (already present on every job row — this is a rendering
   gap, not a missing-data one).
4. **Move the one-page/two-page tailor choice up.** Right now the option to
   generate a one-page or two-page tailored resume appears at the bottom of
   the scan-results page, after everything else. It needs to appear as soon
   as a scan completes — a visible choice near the top of the results, not
   something the user has to scroll past everything else to find.

### Backend / data — ready now

5. **Verify the sponsorship backfill.** `backend/scripts/backfill_sponsorship_rules.py`
   was run once already. Confirm the numbers in the `/jobs` sponsorship
   filter reflect real data (they should show non-zero counts for both
   "Sponsors H-1B" and "No sponsorship" now), and re-run the script
   periodically as new postings arrive — it's idempotent and safe to re-run.
6. **Test coverage for the resume autofill parser.** `backend/app/modules/resume_builder/autofill.py`
   was recently rewritten after it was found silently corrupting parsed
   resumes on certain PDF layouts (bullets losing their marker glyph on
   extraction). 24 tests exist; more real, varied resume layouts run
   through it before it's trusted broadly would surface anything the
   current fixture set doesn't cover.

### Needs a human, not a keyboard

7. **Visual QA pass, both themes.** A list of ~10 items exists (light-theme
   card contrast, dark-theme extrusion visibility, marquee seam, focus ring
   against extruded controls, and others) that pass every automated check
   and have never been reviewed by a human eye. Whoever picks this up should
   ask the team lead for the current list before starting — it evolves as
   things get fixed.
8. **Once Anthropic credits are restored (team lead's call, not yours):**
   run real Claude enrichment over the ~10,000 postings the rule-based
   fallback correctly left as "unmentioned" — that's the set genuinely
   worth a paid classification, not the whole table. Also revisit interview
   coach, career coach and cover-letter generation, which are currently
   degrading to fallback responses instead of doing their real job.

### Do not start without asking the team lead first

- Merging `redesign/violet-neumorphic` into `main`.
- Anything that spends Anthropic API budget (batch enrichment, model
  retraining) — get a dollar estimate approved first, every time, even for
  something similar to a previously-approved spend.
- Rotating any credential — coordinate so a rotation doesn't break someone
  else's running local environment mid-session.

---

## 5. Working conventions specific to this codebase

Beyond the branch-naming and style rules in CONTRIBUTING.md:

- **Tests are proven against the real bug before they're trusted.** The
  convention here (visible throughout the commit history) is: reproduce the
  actual defect, write a test, confirm the test fails against the old code,
  fix the code, confirm the test now passes. A test that was never watched
  to fail is not trusted to catch a regression — it might be passing for the
  wrong reason.
- **Commit messages explain *why*, not just *what*.** The diff already shows
  what changed. Look at any recent commit (`git log -20`) for the expected
  depth — they read more like short design notes than commit summaries.
  Match that; a one-line "fix bug" commit message will stand out as
  inconsistent with everything else in the history.
- **No fabricated content, ever, in anything resume- or cover-letter-shaped.**
  The tailoring engine's one hard rule is that it reorganizes and selects
  from what the candidate actually wrote — it never invents a bullet, a
  number, or a skill. Any change to `resume_builder/` must preserve that
  invariant; it's load-bearing for the product's honesty claim to users.
- **Never commit a real credential.** `.env` files are gitignored; only
  `.env.example` templates with placeholder values are tracked. If a real
  key ever lands in a commit or gets pasted into a shared channel, treat it
  as compromised and rotate it immediately — don't wait to see if it
  matters.
