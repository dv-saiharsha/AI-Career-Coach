# Zenith (AI Career Coach)

AI-powered resume analysis and interview coaching: upload a resume + job description, get a real ATS match score with a skills gap breakdown, then practice interview questions with AI feedback.

## Problem Statement
Job seekers need an integrated tool to beat ATS systems and prepare for interviews. Combining resume analysis and interactive interview coaching provides a cohesive platform to secure their target roles.

## Architecture
```mermaid
graph LR
    UI[Frontend: Next.js] --> API[Backend: FastAPI]
    UI --> AUTH[Supabase Auth]
    API --> AUTH
    API --> DB[(Supabase Postgres)]
    API --> LLM[Anthropic Claude API]
    API --> ML[Trained ATS scoring model]
```

- **Auth**: Supabase Auth (email/password + verification, password reset). The frontend talks to Supabase directly for sign-up/login (httpOnly session cookies via `@supabase/ssr`); the backend verifies the same Supabase-issued JWT on every API request (JWKS-based, no shared secret needed on modern Supabase projects).
- **Database**: Supabase Postgres. Schema is managed with Alembic migrations (`backend/alembic/`) — never edited by hand against the live DB.
- **LLM**: Anthropic Claude (Messages API, tool-use-forced JSON) for resume scoring, interview question generation, and answer evaluation. If `ANTHROPIC_API_KEY` is unset or a call fails, the resume analyzer falls back to a rule-based keyword scorer and the interview coach falls back to a seed question dataset, so the app still works without a key.
- **Trained ATS model** (`backend/app/ml/`): a small, fast regression model trained on LLM-labeled `(resume, job description, score)` pairs — see "ATS scoring model" below. Optional; the LLM/rule-based path above is what the live app uses today.

## Prerequisites
- **Python 3.12+** — not 3.11. `numpy` 2.5.1 declares `requires_python >= 3.12`, so 3.11 fails at install with a misleading "no matching distribution" error.
- **Node.js 24** (ships npm 11) — 24 is what CI pins and what generated `package-lock.json`. Node 20 is too old for `@supabase/supabase-js` (needs >= 22), and Node 22 ships npm 10, which resolves optional wasm bindings into a different tree and makes `npm ci` fail. Use 24 and `npm ci` works everywhere.
- **Git**
- A **Supabase** project (ask a teammate for shared dev credentials, or create your own at [supabase.com](https://supabase.com))
- An **Anthropic API key** (optional but recommended — [console.anthropic.com](https://console.anthropic.com)); the app works in a degraded mode without one

## Setup Instructions

**Short version** — clone, then:

```
git config core.hooksPath .githooks
npm run setup
npm run dev
```

`npm run setup` creates env files from the templates, builds the Python
virtualenv, and installs both dependency sets. Fill in the two env files it
reports, run `npm run migrate`, then `npm run dev`. The long version below
explains each step.

---

1. **Clone the repo:**
   ```
   git clone https://github.com/dv-saiharsha/AI-Career-Coach.git
   cd AI-Career-Coach
   ```

2. **One-time: enable the team git hooks** (see "Working as a team" below for what this does):
   ```
   git config core.hooksPath .githooks
   ```

3. **Create your env files from the templates:**
   ```
   scripts\setup-env.bat          REM Windows
   bash scripts/setup-env.sh      # macOS / Linux / Git Bash
   ```
   This copies `frontend/.env.local.example` -> `frontend/.env.local` and
   `backend/.env.example` -> `backend/.env`. It never overwrites a file that
   already exists, so it is safe to re-run after a pull that adds a new
   variable. Then fill in the real values — ask a teammate for shared dev
   credentials rather than creating your own Supabase project, since the
   database is shared and a fresh project will not have the schema.

4. **Backend:**
   ```
   cd backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   Fill in `backend/.env` (created in step 3) — `DB_URL` (Supabase Postgres connection string), `SUPABASE_URL`, `ANTHROPIC_API_KEY`. See the comments in `.env.example` for exactly where to find each value in the Supabase/Anthropic dashboards.

   Apply the database schema:
   ```
   python -m alembic upgrade head
   ```

5. **Frontend:**
   ```
   cd frontend
   npm ci
   ```
   `npm ci` rather than `npm install`: it installs exactly what `package-lock.json`
   pins, so everyone gets an identical tree. Use `npm install` only when you are
   deliberately adding or upgrading a dependency.

   Fill in `frontend/.env.local` (created in step 3) — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (same Supabase project as the backend).

6. **Run both servers with one command** from the repo root:
   ```
   npm run dev
   ```
   Starts the backend (:8000) and frontend (:3000) together with prefixed
   output. Ctrl+C stops both, and if either crashes the other is stopped too,
   so you never end up with an orphaned server holding a port. Windows users
   can still double-click `start.bat`, which now just calls this.

   To run them separately instead:
   ```
   npm run backend -- -m uvicorn app.main:app --reload --port 8000
   npm --prefix frontend run dev
   ```

7. Open `http://localhost:3000`, register an account (check your email to verify), then use the Resume Analyzer and Interview Coach.

## Root commands

Run these from the repo root; they work the same on Windows, macOS and Linux.

| Command | What it does |
|---------|--------------|
| `npm run setup` | Env files, Python virtualenv, both dependency sets. Idempotent. |
| `npm run dev` | Backend + frontend together, prefixed output, Ctrl+C stops both |
| `npm start` | Same, production mode (`npm run build` first) |
| `npm run build` | Production build of the frontend |
| `npm test` | Backend test suite |
| `npm run check` | Everything CI runs — do this before pushing |
| `npm run migrate` | `alembic upgrade head` (review first — the database is shared) |
| `npm run backend -- <args>` | Any command against the venv Python |

## ATS scoring model (optional, in progress)
`backend/app/ml/` holds a trained regression model that scores resumes numerically instead of via an LLM call — faster, free to run, and deterministic. It's trained on data produced by scripts in `backend/scripts/`:

- `generate_seed_resumes.py` / `generate_job_descriptions.py` — generate synthetic training resumes/JDs via Claude (each has a `--confirm` gate and prints a cost estimate first — never run `--confirm` without knowing the cost).
- `generate_training_data.py` — labels `(resume, JD)` pairs using the same LLM analyzer the live app uses, caching every label so reruns cost nothing.
- `train_ats_model.py` — trains the model with 5-fold cross-validation and reports honest MAE/R² (also free — no API calls, pure local scikit-learn).

The trained model file (`app/ml/models/*.joblib`) is gitignored — regenerate it locally by running `train_ats_model.py` against `backend/data/training_data.csv` (also gitignored/local; regenerate via the scripts above). `app/ml/models/ats_model_metadata.json` (accuracy, dataset size, training date) *is* tracked, so everyone can see what the last trained run achieved without retraining.

## Continuous integration

Every push and pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml),
which is what makes `main` safe to pull:

| Job | Steps |
|-----|-------|
| **Backend: lint and test** | `ruff check .` then `pytest -q` on Python 3.12 |
| **Frontend: lint, typecheck and build** | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` on Node 24 |

The frontend **build** is the check that matters most — it catches broken
imports, server/client boundary mistakes, and prerender failures that lint and
typecheck cannot see.

The build step supplies placeholder Supabase values when repository secrets are
not configured, so the pipeline is deterministic on forks and for contributors
without credentials. It never needs real secrets to prove the app compiles.

**Reproduce CI locally before pushing** — these are the exact commands it runs:

```
cd backend  && ruff check . && pytest -q
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
```

Two gotchas worth knowing, both of which have already bitten this repo:

- Run `pytest`, not only `python -m pytest`. The latter puts the working
  directory on `sys.path` and can pass when CI's invocation would fail.
  `backend/pytest.ini` sets `pythonpath` so both now behave the same.
- `package-lock.json` is platform-sensitive for optional native/wasm packages.
  If you regenerate it, do so on Linux (or expect CI to disagree with your
  machine). Prefer `npm ci` for everyday installs so you never regenerate it by
  accident.

## Working as a team

**Dependencies auto-install after `git pull`.** After the one-time `git config core.hooksPath .githooks` step above, every `git pull` that brings in a changed `backend/requirements.txt` or `frontend/package.json`/`package-lock.json` automatically reinstalls the right dependencies — nobody has to remember to run `pip install` or `npm install` after pulling someone else's changes. This is a per-machine git setting (a git limitation, not a shortcut skipped here), which is why it's a one-time command rather than something that "just works" on clone.

**Database migrations are never auto-applied**, even by the hook above — the Supabase database is shared across the team, so a schema change from someone else's pull only prints a reminder to review and run `alembic upgrade head` yourself, rather than silently altering the shared database the moment you pull.

**Before pushing:** run the backend test suite (above) and make sure both `npm run build` (frontend) and a quick manual click-through still work. If you add a new environment variable, add it (with a placeholder, never a real value) to `backend/.env.example` or `frontend/.env.local.example` so teammates' setups keep working after they pull.
