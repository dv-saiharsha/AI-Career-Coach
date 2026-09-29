# Automated Job-Ingestion System — Plan

Status: **APPROVED.** Decisions locked in §11. Building per the rollout in §9.

## 0. Read this first: a lot of this already exists

Before scoping new work, I audited `backend/app/modules/job_market/` in depth. This
is not a greenfield project — a real ingestion pipeline already runs in production
today. Building the requested system from scratch would throw away working,
tested code and re-introduce bugs it already fixed. So this plan is framed as
**"extend the existing pipeline to close specific gaps,"** not "build a crawler."

### What already exists and works

| Requirement | Status | Where |
|---|---|---|
| Greenhouse adapter | ✅ Done | `ats_boards.py` (`normalise_greenhouse`) |
| Lever adapter | ✅ Done | `ats_boards.py` (`normalise_lever`) |
| Ashby adapter | ✅ Done | `ats_boards.py` (`normalise_ashby`), incl. structured salary |
| Curated employer registry | ✅ Done (static, ~140 boards) | `boards_registry.py` |
| Hourly scheduler | ✅ Done, but **in-process** (gap — see §4) | `scheduler.py`, wired in `main.py` lifespan |
| Fetch failures don't stop a run | ✅ Done | `ats_boards.fetch_board` swallows per-board |
| Upsert with stable identity | ✅ Done | `ingestion._upsert`, `content_hash = md5(company\|title\|location)` |
| Skill extraction | ✅ Done | Claude batch enrichment (`enrichment.py`) + regex fallback |
| H-1B / seniority / employment-type classification | ✅ Done | `enrichment.py`, batched, cost-tracked |
| Non-US filtering | ✅ Done | `geo.py` |
| Job Portal / detail drawer / Dashboard "top matches" / match % wired to real data | ✅ Done | `services.py:top_matches`, `matching.py`; frontend has no job mock data left (verified) |
| Cost ceilings | ✅ Done | `MAX_SWEEP_COST_USD`, `jsearch.RESERVE_REQUESTS` |
| Licensed aggregator fallback (breadth beyond curated boards) | ✅ Done, but it's **JSearch**, not Adzuna | `jsearch.py`, `JOB_SOURCE` config |
| Discovery of new boards | ✅ Partial — reads a third-party AI-jobs directory for tokens, not each company's own careers page | `board_discovery.py` |
| Unit tests for adapters/upsert/dedup | ✅ Done | `test_ats_boards.py`, `test_ingestion.py`, `test_boards_registry.py`, `test_board_discovery.py` |

### The real gaps (this is what this plan actually builds)

1. Only 3 of 6 requested ATS adapters exist (no Workable, SmartRecruiters, Recruitee).
2. No schema.org JSON-LD careers-page fallback for companies on no known ATS.
3. No `companies` table — the registry is a hardcoded Python tuple list, not a
   DB-backed, CSV-seeded, team-editable registry with industry/size/logo/etc.
4. No `crawl_runs` table, no admin API, no alerting.
5. Closing logic is "hard-delete anything not re-seen in 72h" — not "mark closed
   after 2 consecutive misses, then retain 90 days." This also currently applies
   uniformly, with no distinction from the JSearch on-demand cache's own TTL
   semantics (which are a different, correct thing and must not be touched).
6. The scheduler runs an asyncio task **inside the API process** (per Uvicorn
   worker), not a separate worker process, and has no distributed lock — it
   relies on idempotency + jitter instead. `README.md` already flags this as a
   known correctness gap for `job_market/services.py`'s in-process locks under
   multiple workers.
7. No per-domain rate limiting, no concurrency control, no retry/backoff, no
   conditional requests (ETag/If-Modified-Since). Boards are fetched one at a
   time, no retries, swallow-on-404 only.
8. No admin auth concept exists anywhere in the backend (`deps.py` has only
   `get_current_user`, nothing admin-gated).
9. No manual "run one full crawl and print a summary" CLI entry point.

Everything below addresses gaps 1–9. It does **not** re-architect or duplicate
anything already working.

---

## 1. Target architecture

```
                    ┌─────────────────────────────┐
                    │   companies table (DB)      │◄──── data/companies_seed.csv
                    │  ats_type / ats_slug /       │        (seed + team edits)
                    │  crawl_status / health       │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │   Crawl orchestrator          │  (extends ingestion.py)
                    │   - concurrency-limited pool   │
                    │   - per-domain rate limit       │
                    │   - retry w/ backoff             │
                    │   - conditional GET (ETag)         │
                    └───┬─────────┬─────────┬─────────┬──┘
                        │         │         │         │
              ┌─────────▼──┐ ┌────▼────┐ ┌──▼──────┐ ┌▼─────────────┐
              │ Greenhouse │ │  Lever  │ │  Ashby  │ │ Workable /    │
              │  (exists)  │ │(exists) │ │(exists) │ │ SmartRecruiters│
              └────────────┘ └─────────┘ └─────────┘ │ / Recruitee   │
                                                       │   (new)       │
                                                       └───────────────┘
                        │
              ┌─────────▼──────────┐        ┌───────────────────────┐
              │ JSON-LD careers-   │        │ JSearch (existing) —  │
              │ page fallback (new)│        │ aggregator breadth for│
              │ robots.txt-aware   │        │ non-ATS employers     │
              └────────────────────┘        └───────────────────────┘
                        │
                        ▼
              ┌────────────────────┐
              │  Upsert (extends    │───► job_listings (extended columns)
              │  ingestion._upsert) │───► crawl_runs (new)
              └────────────────────┘
                        │
              ┌─────────▼──────────┐
              │  Close-after-2-miss │
              │  + 90-day retention │
              └────────────────────┘
```

Runs on an **hourly timer, in a separate worker process** (§4), guarded by a
Redis lock, writing to the same Supabase Postgres the API reads from.

---

## 2. Source adapters

### 2.1 New ATS adapters (Workable, SmartRecruiters, Recruitee)

Each is a `normalise_<provider>()` function added to `ats_boards.py`, following
the exact pattern already used for Greenhouse/Lever/Ashby: one public read-only
JSON endpoint per provider, no auth, swallow-on-404, output the same row shape.

| Provider | Public endpoint (no key) |
|---|---|
| Workable | `https://apply.workable.com/api/v1/widget/accounts/{slug}` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{slug}/postings` |
| Recruitee | `https://{slug}.recruitee.com/api/offers/` |

All three publish public, keyless JSON exactly like the existing three, so this
is additive, low-risk work with a clear precedent to copy.

### 2.2 JSON-LD schema.org fallback (new module: `jobmarket/jsonld_crawler.py`)

For companies in the `companies` table with `ats_type = "jsonld"`:
- Fetch `careers_url` (HTML), respecting `robots.txt` (`urllib.robotparser`,
  cached per domain).
- Parse every `<script type="application/ld+json">` block; keep objects (or
  `@graph` entries) whose `@type` is `JobPosting` or includes it in a list.
- Map schema.org fields → the existing row shape (`title`, `hiringOrganization.name`
  → company, `jobLocation`, `datePosted`, `description`, `employmentType`,
  `baseSalary` → salary_min/max/currency, `directApply`/`url` → apply_url).
- Same swallow-and-log-per-company failure handling as `ats_boards.fetch_board`.
- Identifying `User-Agent` built from an env var (`CRAWLER_CONTACT_EMAIL`), per
  your instruction — e.g. `HireLoomBot/1.0 (+mailto:{email})`.
- **Explicitly out of scope, per your instructions:** LinkedIn, Indeed,
  Glassdoor, or any site whose ToS forbids automated access. No login bypass,
  no CAPTCHA solving.

### 2.3 Licensed aggregator (Adzuna) — needs your decision

Your spec calls for Adzuna behind a flag. **JSearch already fills the
"licensed aggregator for breadth" role today** (`jsearch.py`, wired into
`JOB_SOURCE`), with its own quota tracking. Adding Adzuna as well means a
second aggregator, a second API key, and a second quota-budget code path for
overlapping coverage. See **Open Decision A** below — I'd rather confirm than
build a redundant integration.

---

## 3. Database changes

All via Alembic (matches existing convention — every prior job_market change
is its own migration file under `backend/alembic/versions/`).

### 3.1 New table: `companies`

```
id                 PK
name               text, not null
logo_url           text, nullable
website            text, nullable
careers_url        text, nullable
ats_type           text — greenhouse | lever | ashby | workable |
                     smartrecruiters | recruitee | jsonld | manual_review
ats_slug           text, nullable — the board token/company slug
industry           text, nullable
size                text, nullable          (e.g. "1000-5000")
active             bool, default true
last_crawled_at    timestamptz, nullable
crawl_status       text — ok | failing | never_run
consecutive_failures int, default 0
last_error         text, nullable
etag               text, nullable          — conditional-request cache
last_modified      text, nullable          — conditional-request cache
created_at / updated_at
```

Unique on `(ats_type, ats_slug)` where both are non-null.

### 3.2 `job_listings` — extend, don't replace

Adding: `company_id` (FK → companies, **nullable** — JSearch rows and legacy
rows won't all resolve to a company row, and that's fine), `department`,
`salary_min`, `salary_max`, `salary_currency` (structured, alongside the
existing `salary_range` display string, which stays for what has no structured
number), `first_seen_at`, `last_seen_at`, `status` (`open` | `closed`),
`closed_at`.

`experience_level` (seniority), skills, and description sanitization already
exist and are correct — kept as-is. Full-text search + filter indexes (role,
location, remote, salary, posted date) added as a follow-up migration once
the column set is final.

**Identity key — corrected per review.** `content_hash =
md5(company|title|location)` is content-based, not identity-based: two
distinct open reqs with the same title at the same location collapse into
one row, and editing a posting's title (a rename, not a new job) gets read as
a brand-new job replacing the old one. For every ATS/crawler-sourced row
(`source` in `greenhouse|lever|ashby|workable|smartrecruiters|recruitee|
jsonld`), identity becomes **`(source, company, external_id)`** — all six
adapters already synthesize a provider-scoped `external_id` (e.g.
`"greenhouse:stripe:12345"`) at collection time, so this requires no new
scraping, only a different upsert lookup key. `content_hash` is kept on
these rows, but demoted from identity to **change detection**: an upsert
finds the row by `(source, company, external_id)` and only touches
`updated_at`/re-triggers enrichment if `content_hash` changed. JSearch rows
(`source` is null) are **unchanged** — they keep today's content_hash-based
upsert lookup exactly as-is, since that's a separate, already-correct
mechanism for aggregator data with no stable provider id to key on.

This requires relaxing `content_hash`'s column-level `unique=True` (it can no
longer be globally unique once two distinct same-title/location ATS postings
are allowed to coexist) and adding a new partial unique index on
`(source, company, external_id)` where `source` is not null. See §9 for the
migration and dedup handling.

### 3.3 New table: `crawl_runs`

```
id, trigger (scheduled | manual), triggered_by (user id, nullable),
started_at, ended_at,
companies_attempted, companies_succeeded, companies_failed,
jobs_new, jobs_updated, jobs_closed,
errors (jsonb list),
cost_usd
```

Per-company health lives as columns directly on `companies`
(`last_crawled_at`, `crawl_status`, `consecutive_failures`, `last_error`) —
not a separate per-run-per-company table. That answers "per-company health"
with one indexed lookup instead of a join, matching how lean the rest of this
schema already is. Say if you want full per-run-per-company history instead
(see Open Decision D).

### 3.4 Closing logic (replaces `ingestion._archive`'s hard 72h delete)

Scoped **only** to standing board/crawler-sourced rows (`source` in
`greenhouse|lever|ashby|workable|smartrecruiters|recruitee|jsonld`) — the
JSearch on-demand cache keeps its existing TTL/replace-on-refresh behavior
unchanged, since that's a different, already-correct mechanism for a
different kind of data (query cache vs. standing crawl).

- Each crawl marks every row it re-saw this run (`last_seen_at = now`).
- A previously-open row not seen in **2 consecutive successful crawls of its
  company** → `status = "closed"`, `closed_at = now`.
- A company crawl that itself *failed* does not count as a "miss" for its
  jobs — that would close postings just because we couldn't reach the board,
  which is wrong.
- Closed rows are retained `JOB_CLOSED_RETENTION_DAYS` (default 90, env-driven)
  then hard-deleted by the same cleanup pass. No separate archive store is
  built unless you want one (Open Decision D).

---

## 4. Scheduler — where it runs

**Recommendation: a new `worker` service in `docker-compose.yml` /
`docker-compose.prod.yml`, built from the same backend image, running the
crawl loop as its own process — guarded by a Redis distributed lock
(`SET NX PX`).**

Why this over the alternatives:
- The app already runs on Docker Compose (confirmed — no Render/Fly/Railway
  config in the repo) with Redis already deployed and already used for
  cross-worker coordination. Reusing it for a crawl lock is zero new
  infrastructure.
- Celery beat would add a message broker and a worker pool for one hourly
  job — real operational weight for no benefit here.
- Supabase `pg_cron` + `pg_net` calling an admin HTTP endpoint decouples nicely
  but adds a Supabase-side moving part that's harder to test locally, and
  still needs the API process listening — it doesn't actually get the crawl
  off "a process serving requests" the way a dedicated worker container does.
- APScheduler-in-its-own-process is roughly what's proposed here, minus the
  distributed lock; a plain asyncio loop already exists and works, so the
  change is "run the existing loop in its own container + add a lock," not
  "adopt a new library."

**Confirmed:** this repo's only production path is
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
(README §"Production Deployment") — there is no managed PaaS, no automated
deploy; pulling new images and restarting is already a manual step the
deployer owns. Adding a `worker` service is additive to that same manual
flow: after this ships, a deploy becomes
`docker compose -f docker-compose.yml -f docker-compose.prod.yml pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
— identical command, one more container comes up. Restarting only the worker
(e.g. after an env change) is
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --force-recreate worker`.
This gets documented verbatim in README's Production Deployment section.

Concretely: `scheduler.py`'s loop becomes runnable standalone (thin
`python -m app.modules.job_market.worker_main` entrypoint), the Redis lock is
acquired *inside* the sweep function itself (not just at the process level),
and `JOB_SWEEP_ENABLED` is set `false` on the `backend` (API) service in
production and `true` only on the new `worker` service. Local dev is
unaffected — a single process with `JOB_SWEEP_ENABLED=true` still works
exactly as it does today, since the lock is a no-op when nothing else is
holding it. If the run exceeds the lock TTL, the next tick simply finds the
lock held and skips, per your "next run waits or skips" instruction — skip is
simpler and matches the existing "a missed sweep just means a slightly
staler feed" philosophy already in this codebase.

Concurrency, rate limits, retries (§ new in `ingestion.py`'s orchestrator):
- `CRAWLER_CONCURRENCY` (default 10) — bounded thread pool, same
  `asyncio.to_thread` style already used in `scheduler.py`, since every fetch
  here is blocking I/O.
- Per-domain minimum interval (`CRAWLER_PER_DOMAIN_MIN_INTERVAL_MS`, default
  250ms) — a simple last-hit-time tracker keyed by host, not a heavyweight
  token-bucket library.
- Retries: 3 attempts, exponential backoff (1s/2s/4s), only on timeouts,
  connection errors, and 5xx — a 404 still means "not on this ATS" and is
  never retried, unchanged from today.
- Conditional requests: `etag`/`last_modified` stored per company, sent as
  `If-None-Match`/`If-Modified-Since`; a 304 updates `last_crawled_at` only
  and skips parsing. Best-effort — some of these six providers may not honor
  conditional headers, in which case it degrades to a full fetch silently.
- One failing company never stops a run — already true today
  (`fetch_board` swallows), extended to every new adapter and to the JSON-LD
  path, with failures now recorded onto `companies.consecutive_failures`
  instead of only logged.

---

## 5. Monitoring, admin API, alerting

**Admin auth — there is currently no admin concept anywhere in this backend**
(`deps.py` only has `get_current_user`). Proposed: an `ADMIN_EMAILS`
comma-separated env var (same pattern as `ALLOWED_ORIGINS`), checked in a new
`get_current_admin` dependency. Simple, no schema change, consistent with how
this codebase already does config-driven allowlists. Confirm in Open
Decision C — a real `is_admin` column is the alternative if you'd rather that
live in the DB.

Endpoints (all admin-gated, under `/api/admin/crawl`):
- `GET /runs` — recent `crawl_runs`, paginated.
- `GET /runs/{id}` — one run's detail.
- `GET /companies` — every company's health (crawl_status, last_crawled_at,
  consecutive_failures, last_error).
- `POST /run` — trigger a full manual sweep (still respects the Redis lock).
- `POST /companies/{id}/run` — crawl one company on demand.

Alerting: always logged. Optional `ALERT_WEBHOOK_URL` (Slack-compatible
incoming webhook — one POST, no new dependency) fires when a full run raises
unhandled, or when any company crosses `consecutive_failures >= 3`, deduped to
one alert per condition per run. **Email alerting would need a new
transactional-email provider** — nothing in this codebase sends email today
(`docs/email-templates/` is Supabase Auth template copy, not an app mailer).
I'd hold off unless you want that added now (Open Decision C covers this).

---

## 6. Company registry

- `data/companies_seed.csv`: `name, logo, website, careers_url, ats_type,
  ats_slug, industry, size, active`.
- Seeded from two sources: (1) the ~140 already-probed-live tokens currently
  hardcoded in `boards_registry.py` (migrated in, not re-probed — they're
  already known good), (2) additional well-known employers padded to 300+,
  each run through detection below before being marked `active` rather than
  `manual_review`.
- Detection script (`backend/scripts/detect_ats.py`): for each CSV row without
  a known `ats_type`, fetch its `careers_url` HTML and look for an iframe/link
  pointing at one of the six providers' domains (extends the exact regex
  technique `board_discovery.py` already uses against a third-party directory,
  now pointed at the company's own site). A hit is written back as
  `ats_type`/`ats_slug`; a miss falls back to `jsonld` if the page has
  `JobPosting` JSON-LD, else `manual_review`.
- Re-runnable: `python scripts/detect_ats.py data/companies_seed.csv` lets
  your team add rows and re-run detection, per your instruction.
- Caveat to flag honestly: detecting against 300 real careers pages is
  inherently probabilistic and network-bound (unlike `board_discovery.py`'s
  current single-directory-API approach) — expect some fraction to land in
  `manual_review` on the first pass, the same way the existing registry's own
  docstring reports "78 candidates probed, 33 live."

---

## 7. Testing

- New adapter tests (`test_workable.py`, `test_smartrecruiters.py`,
  `test_recruitee.py`) using saved sample JSON, mirroring `test_ats_boards.py`.
- `test_jsonld_crawler.py` using saved sample HTML fixtures (including a
  robots.txt-disallowed case).
- Extend `test_ingestion.py` for the close-after-2-misses + retention logic,
  **plus** two identity-key regression tests specifically: (1) two postings
  with the same title and location but different `external_id` both persist
  as separate rows (proves same-title/same-location no longer collapses),
  and (2) re-upserting the same `(source, company, external_id)` with a
  changed title updates the existing row in place rather than inserting a
  second one (proves a rename is read as an edit, not a new job).
- `test_worker_lock.py` using `fakeredis` (already a pinned dependency) to
  prove two concurrent sweep attempts never overlap.
- `test_admin_crawl.py` — auth gating (non-admin gets 403) and the trigger
  endpoints.
- `test_detect_ats.py` for the detection script's parsing logic.
- Local manual-run command: `python -m app.modules.job_market.cli crawl`,
  printing a `SweepReport`-style summary (companies attempted/succeeded/failed,
  jobs new/updated/closed, cost).

---

## 8. Cost/limits summary

| Source | Cost | Limit |
|---|---|---|
| Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Recruitee | Free | Per-domain rate limit + timeout |
| JSON-LD careers pages | Free | robots.txt-gated, per-domain rate limit |
| JSearch (existing aggregator) | Quota, not $ | 200 req/month, reserve already enforced |
| Claude enrichment | ~$0.50/$2.50 per MTok (Batch, Haiku) | `MAX_SWEEP_COST_USD` ceiling, already enforced; unchanged |
| Adzuna | TBD | Only if approved — Open Decision A |

No new per-request billing is introduced by this plan unless Adzuna is added.

---

## 9. Rollout (phased commits on `job-crawler`)

1. Migrations: `companies`, `crawl_runs`, `job_listings` new columns; drop
   `content_hash`'s unique constraint and add the partial unique index on
   `(source, company, external_id)` (with a pre-index dedup pass that keeps
   the most-recently-fetched row of any accidental collision — none are
   expected, since every existing ATS row already carries the `external_id`
   its adapter always wrote, but the migration checks rather than assumes);
   backfill script linking existing rows to `companies` where the board
   token/company name matches.
2. New ATS adapters (Workable/SmartRecruiters/Recruitee) + tests.
3. JSON-LD fallback crawler + tests.
4. `companies_seed.csv` + detection script; seed 300+, run detection.
5. Crawl orchestrator: concurrency, per-domain limits, retries, conditional
   requests, Redis lock, `crawl_runs` recording, close-after-2-misses,
   retention cleanup.
6. Worker process wiring: `worker` service in both compose files, config
   split between API and worker.
7. Admin endpoints + `ADMIN_EMAILS` gate + webhook alerting.
8. Manual crawl CLI, `.env.example`/README updates, `README.md`'s Backend
   TODO index updated to drop the now-closed "no company-size field" line.
9. Full lint/typecheck/test/build pass, a real test crawl summary, then
   commit + push + PR description.

---

## 10. Explicit non-goals

- **No frontend changes.** Job Portal, detail drawer, Dashboard are already
  wired to real `job_listings` data with no mock data left — confirmed by
  reading `JobsPage.tsx` and the dashboard/services wiring.
- Not touching JSearch, enrichment, or the matching engine's existing logic —
  only extending rows they read/write with new columns.
- Not replacing `content_hash` as the row-identity key — it already does the
  job the spec's `(source, company_id, external_id)` unique key would, and
  changing it would touch every existing row.

---

## 11. Decisions (locked)

**A. Adzuna** — skipped. JSearch remains the only licensed aggregator.

**B. Scheduler mechanism** — Docker Compose `worker` service + Redis lock,
confirmed against the actual production path (§4).

**C. Admin auth + alerting** — `ADMIN_EMAILS` env allowlist. Alerting is log
+ Slack-compatible webhook only; no email provider is introduced.

**D. Retention + health tracking** — closed jobs hard-delete after
`JOB_CLOSED_RETENTION_DAYS` (default 90, env-configurable). Per-company
health lives as columns on `companies` (no per-run-per-company history
table).

**Identity-key correction (from review)** — `(source, company, external_id)`
replaces `content_hash` as the upsert identity for ATS/crawler-sourced rows;
`content_hash` is kept for change detection only on those rows. JSearch rows
are unchanged. See §3.2 and §9.

---

## 12. JSearch/RapidAPI removed — the crawler is now the sole job source

Everywhere above that describes JSearch as "the licensed aggregator," "the
existing aggregator," or an unchanged on-demand fallback (§0, §2.3, §3.2,
§3.4, §8, §10) is now **historical** — it describes the architecture at the
time this plan was written and approved, not the current one. Once the six
ATS adapters plus the JSON-LD fallback were live and the companies registry
was seeded (§6, §9), JSearch/RapidAPI stopped being needed for breadth and
was removed outright, along with Active Jobs (the other RapidAPI product
`JOB_SOURCE` could select):

- `job_market/jsearch.py`, `job_market/active_jobs.py`, and their tests
  deleted entirely.
- The `JOB_SOURCE` switch, `_fetch()`, `source_configured()`,
  `should_queue_refresh()`/`refresh_in_background()`/`_scrape()` (the
  background-thread on-demand scrape), `_fresh_rows()`/`_any_rows()`/
  `_replace_cache()` (the per-query cache), and `_enrich_rows()` (on-demand
  Claude enrichment) all removed from `job_market/services.py`.
- `RAPIDAPI_KEY`, `RAPIDAPI_HOST`, `JOB_SOURCE`, `JOB_LOCATIONS`,
  `JOB_CACHE_TTL_HOURS`, `JOB_RESULTS_PER_QUERY`, `JOB_MAX_RESULTS_PER_RUN`,
  `JOB_MAX_SPEND_PER_RUN_USD` all removed from `Settings`/`.env.example`.
- `job_market/ingestion.py`'s `_collect()` (the JSearch half of the older
  board sweep) removed; `_collect_boards()` (Greenhouse/Lever/Ashby) is
  untouched and still runs locally exactly as §0/§9 describe.
- The Job Portal's search (`services.search_jobs()`, new) is a full-text
  query straight against `job_listings` — Postgres `to_tsvector`/
  `plainto_tsquery` backed by a new `ix_job_listings_fts` GIN index, SQLite
  falls back to a substring match. No external call happens at request
  time; a term the crawler hasn't found anything for returns an honest
  empty result rather than queuing a scrape.
- `domain_for()` and the default-grid's target-role personalisation, both
  previously keyed on `query_key` (meaningful only when query_key WAS the
  search term an aggregator was asked for), now match against each row's
  own `title` text instead — every row is crawler-sourced now, and
  query_key is a board identifier, not a role.

**Not done in this pass, deliberately:** `job_market/crawler.py` still does
not run Claude enrichment on the rows it collects (see its own module
docstring) — that gap predates and is independent of the JSearch removal.
`job_market/ingestion.py`'s older board sweep is untouched and keeps running
locally; retiring it (or migrating it to read from `companies`) remains the
separate, later decision §9's own text already called out.
