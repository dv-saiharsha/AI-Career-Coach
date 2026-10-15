# HireLoom on Google Cloud

Everything the backend needs in GCP project `project-aeb81a89-8d57-46ee-ab2`,
as scripts you can read, dry-run and then apply. Nothing in here has been
applied unless the status table says so.

## Architecture

```
                    Firebase Auth (sign-in, ID tokens)
                               │
  Web app ──HTTPS──► hireloom-api (Cloud Run, us-east1, max 1 instance)
                       │   │                     │
                       │   │ Unix socket          │ identity token
                       │   ▼                     ▼
                       │  Cloud SQL career-coach-pg   hireloom-ollama (Cloud Run + L4 GPU,
                       │  db career_coach             us-east4, private, scales to zero)
                       │   ▲                     ▲
  Cloud Scheduler ─────┼───┤ every 20 min         │ hourly
   (hireloom-scheduler)│   │                     │
                       │  hireloom-crawler (Cloud Run Job, CPU only, enrichment off)
                       │  hireloom-enricher (Cloud Run Job: the only scheduled GPU use)
                       ▼
                  GCS hireloom-avatars-… (signed URLs), hireloom-models-… (ATS model)
```

* **One image** (`backend/Dockerfile`) runs the API and both jobs; only the
  command differs. **One identity per workload**, each with only what it
  uses: `hireloom-api`, `hireloom-jobs`, `hireloom-scheduler` (may only
  start the two jobs), `hireloom-ollama` (no grants at all).
* **Secrets** stay in Secret Manager. `DB_URL` is composed from the existing
  password secret without ever being printed.
* **No Redis, one API instance** (MIGRATION_RUNBOOK §1). Crawls never overlap:
  a Postgres advisory lock makes an overlapping execution skip and exit 0.
* **GPU cost control:** the crawler never calls the model; enrichment runs
  hourly; the GPU service scales to zero.

## Status (2026-10-15)

| Piece | State |
|---|---|
| Cloud SQL `career_coach` | ✅ Fresh schema at head, 31,309 jobs + 315 companies loaded and verified, no user data |
| Backups | ✅ Daily automated + on-demand `1792067726414` before the load |
| Local dev on Cloud SQL | ✅ Proxy LaunchAgent on 127.0.0.1:5433, `backend/.env` points at it |
| Crawler every 20 min | 🟡 Runs on the owner's Mac (LaunchAgent) against Cloud SQL until `40_jobs.sh` |
| `10`–`40` | ⬜ Written and dry-run checked; not applied |
| `50_api.sh` | ⛔ Owner: no deploy/publish yet. Needs `DEPLOY_APPROVED=yes` |
| `60_monitoring.sh` | ⬜ Written and dry-run checked; not applied |
| ATS model | ⬜ `ats_model.joblib` is not on this Mac or in any bucket. Scores show "Unavailable" until it is uploaded to `gs://hireloom-models-452189867278/` |
| Frontend hosting | ⬜ Not scripted yet (Firebase Hosting); "don't publish" |

## Order

Every script is a dry run unless `APPLY=1`. Run `./00_preflight.sh` (read-only)
before and after each step.

| Step | What | Cost | Needs |
|---|---|---|---|
| `00_preflight.sh` | Checks everything below | none | — |
| `10_foundation.sh` | Registries, service accounts, grants, `hireloom-db-url` secret, models bucket | pennies (storage) | — |
| `20_build.sh api` | API/worker image via Cloud Build | cents per build | committed `backend/` |
| `20_build.sh ollama` | GPU image with llama3.1, qwen2.5:14b, nomic-embed-text (~15 GB) | build minutes + image storage | — |
| `30_ollama.sh` | Private GPU service | **per second while up, GPU included** | owner's OK on GPU price + L4 quota in `GPU_REGION` |
| `40_jobs.sh` | Crawler (every 20 min) + enricher (hourly) + schedules | CPU seconds per run; enricher wakes the GPU hourly | `ALLOWED_ORIGINS`, step 30 |
| `50_api.sh` | Public API | per request (scales to zero) | **owner's deploy approval**, `ALLOWED_ORIGINS` |
| `60_monitoring.sh` | Email alerts: failed crawl, no successful crawl for 2 h, API uptime, monthly budget (50/90/100%) | free; a budget only notifies | `BUDGET_USD` (owner's number); gcloud `alpha` + `beta` components |

```sh
cd infra/gcp
./00_preflight.sh
APPLY=1 ./10_foundation.sh
APPLY=1 ./20_build.sh api
APPLY=1 ./20_build.sh ollama
APPLY=1 ./30_ollama.sh                                   # after the cost OK
ALLOWED_ORIGINS=https://<web origin> APPLY=1 ./40_jobs.sh
ALLOWED_ORIGINS=https://<web origin> APPLY=1 DEPLOY_APPROVED=yes ./50_api.sh
BUDGET_USD=<owner's monthly limit> APPLY=1 ./60_monitoring.sh   # re-run after 50 for the uptime check
```

When `40_jobs.sh` is live, remove the Mac crawler so the cloud is the only one:

```sh
launchctl bootout gui/$(id -u)/com.hireloom.crawl-worker
rm ~/Library/LaunchAgents/com.hireloom.crawl-worker.plist
```

## Rolling back

* **Jobs:** `gcloud scheduler jobs pause hireloom-crawler-every-20m --location us-east1`
  stops new runs; `gcloud run jobs delete hireloom-crawler --region us-east1` removes it.
* **GPU service:** `gcloud run services delete hireloom-ollama --region us-east4`
  (the image stays in the registry).
* **Data:** restore `career_coach` from the on-demand backup with
  `gcloud sql backups restore 1792067726414 --restore-instance career-coach-pg`.
  This restores the **whole instance**, `career_coach_test` included; read the
  prompt.

## Local development against Cloud SQL

`scripts/com.hireloom.cloud-sql-proxy.plist` keeps the Cloud SQL Auth Proxy
running on `127.0.0.1:5433` (login service; uses your `gcloud` login).
`backend/.env`: `DB_URL=postgresql://app_user:<password>@127.0.0.1:5433/career_coach`.
The test suite never uses it (`backend/tests/conftest.py` forces SQLite).
