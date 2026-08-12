# Contributing

New here? Do the [README setup](README.md#setup-instructions) first — especially
`git config core.hooksPath .githooks` and `scripts/setup-env.sh`, which are the
two steps people forget and then spend an afternoon debugging.

## Before you push

Run what CI runs. It is faster to fail here than to wait on a red pipeline:

```
cd backend  && ruff check . && pytest -q
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
```

`main` is expected to stay green. If you push something red, fix it or revert
it rather than leaving it for the next person to discover.

## Standards

- **Python** — snake_case for variables and functions. Type hints required.
  Docstrings on public functions. `ruff` is the arbiter; if it passes, ship it.
- **Frontend** — PascalCase for components. ESLint must be clean.
- **Styling** — use the design tokens, never raw hex or a bare Tailwind palette
  colour. `text-ink-dim`, not `text-slate-500`; `bg-canvas-raise`, not
  `bg-white`. Hardcoded colours do not invert for dark mode, which is how the
  invisible-text bugs in this codebase happened.
- **Components** — no raw `<button>`, `<input>`, `<select>` or `<textarea>` in
  route or feature code. Use the primitives in `src/components/ui/`; they carry
  the focus rings, touch targets and label wiring.
- **Accessibility** — every interactive control needs an accessible name, and
  text must clear WCAG AA (4.5:1) against its own background. Measure rather
  than eyeball it; several tokens in this repo were wrong until they were
  measured.

## Branching

- `feature/<name>` for new work, `bugfix/<name>` for fixes.
- Branch from `main`, keep branches short-lived, delete them after merge.
- Commit messages: a short imperative subject, then a body explaining **why**.
  The diff already shows what changed; the body should explain what a reviewer
  cannot see.

## Environment variables

If you add one, add it to `backend/.env.example` or
`frontend/.env.local.example` **with a placeholder, never a real value**, in the
same commit. Teammates re-run `scripts/setup-env.sh`, which only creates files
that do not exist — so an existing `.env` will not pick up your new variable
automatically, and the template is how they find out it is needed.

Never commit a real key. If one lands in a commit, treat it as compromised:
rotate it in the provider's dashboard first, then clean up the history.

## Database migrations

The Supabase database is **shared across the team**. Migrations are never
applied automatically, even by the post-merge hook — it only prints a reminder.
After pulling a schema change, review it, then run it yourself:

```
cd backend && python -m alembic upgrade head
```

Never edit the live schema by hand; write an Alembic migration so everyone else
gets the same change.
