# Migration runbook: Supabase to Google Cloud (data move + first launch)

**Status: draft.** Written while the migration is in progress. Sections marked
**TODO(7g)** are filled in when the Cloud Run, Cloud Run Job and Scheduler setup is
verified; nothing in them has been run. Everything else records what was actually
rehearsed.

## 0. Situation

* The app is **not live anywhere.** There is no production server, no public address
  and no real users; the team uses it locally. So there is no maintenance window, no
  user logout notice and no signup freeze to coordinate.
* Supabase currently holds the only copy of the data (4 users, ~287 MB, 31,049 job
  listings). It stays untouched until the new stack is verified, and is deleted by the
  owner personally, never by tooling.
* Target: Cloud SQL Postgres 17 (`career-coach-pg`, `us-east1`), Firebase
  Authentication, Cloud Storage for avatars, Cloud Run for the API, a Cloud Run Job for
  the crawl.

## 1. Decisions in force

| Topic | Decision |
|---|---|
| Rollout | Web first. Mobile is a separate release after launch. |
| Auth | Firebase Authentication. Same uid as the old Supabase UUID. No dual verifier. |
| Unverified email | Imported as unverified. The API answers 403 `email_not_verified`; the web app shows "verify your email" with a resend button. |
| Admin | `ADMIN_EMAILS=dandaharshith64@gmail.com` (Google sign-in; a fresh account, not one of the 4 imported users). Only ever matches a verified email. |
| Redis | None. One API instance (`--max-instances=1`, `UVICORN_WORKERS=1`). Crawl lock via `pg_try_advisory_lock`. |
| Scaling rule | **Add Redis or LISTEN/NOTIFY before raising max-instances above 1.** Until then the in-process erasure block (`core/security.block_user`) is exact; beyond one instance it only narrows the window and Firebase's own deletion is the shared truth. |
| Connections | `max_connections` is 50 (3 reserved). API pool 6+3, crawl Job pool 4+3 plus 1 for the advisory lock; steady 22, worst case during a deploy 31. |
| Cloud Run IAM | A custom role with exactly `firebaseauth.users.get` and `firebaseauth.users.delete` for the service account. |
| User id type | `user_id` is **text**, not uuid. Firebase gives new accounts a 28-character id; only the 4 imported users have UUID-shaped ids, and a uuid column rejects the rest (`invalid input syntax for type uuid`). Migration `c7e4a19d5b36`. |
| Sign-in | Google via popup (not redirect). Reset and verify links use Firebase's hosted action pages for now. |
| API hostname | The API gets its **own hostname**, not a Firebase Hosting rewrite: Hosting caps requests proxied to Cloud Run at 60 seconds (a 504 after that), and `/events/stream` is long-lived. |

## 2. Data move and first launch

Run in order. Each step is a separate go-ahead.

### 2.1 Team freeze
Nobody runs the app, the crawler, or any script against Supabase after the final copy
begins. Tell the team before starting. (There is no writer-pause table because there is
no production server. The writers that exist are the API, the crawl worker, the
in-process board sweep, admin-triggered crawls, and the manual scripts, all run locally.)

### 2.2 Final backup of Supabase (before anything else changes)
A full `pg_dump` with the **v17** client (`/opt/homebrew/opt/postgresql@17/bin`; the
default v14 refuses a v17 server), **including the `auth` schema**, plus every storage
object, into a **private** GCS bucket in `us-east1`.
**TODO(7g):** the bucket name, its access settings, and the exact upload commands. The
avatars bucket is empty today (0 objects), but the step stays.
Verify the dump restores into a scratch database before relying on it.

### 2.3 Final data copy into `career_coach`
All of this was rehearsed against `career_coach_test`; the real database is still empty.
Never run it against Supabase.

1. Rebuild from scratch: `backend/scripts/supabase_compat_shim.sql` on the empty
   database, then `alembic upgrade 388e523dda7a`, then `alembic upgrade head`. `head` is
   currently `b4e1c2d3f501` (adds `crawl_runs.stats`), after `a9d3c5e7f102` (adds
   `jd_analyses`, the JD analyzer's table), passing through
   `d2f6a8c1b937` (the Supabase cleanup), then `c7e4a19d5b36` (converting the 11 `user_id`
   columns from `uuid` to `text`).
   The cleanup migration **refuses to run against a real Supabase database** (marker
   comment, GoTrue tables and `auth.users` rows are all checked).
2. Dump (v17 client): `pg_dump -Fc --data-only --schema=public -T public.alembic_version -T public.profiles --no-owner --no-privileges`.
3. Restore with `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`.
4. **`profiles` separately, with an explicit column list read from the target.**
   `profiles.accent_color` exists in Supabase only (added by hand, never in a migration or
   in code, all `NULL`) and is **deliberately not carried**. A data-only dump names every
   source column in its `COPY`, so loading `profiles` from the main dump would fail. The CSV
   holds personal data: write it outside the repo and delete it straight after.
5. Set every sequence to the source's `last_value`/`is_called` (18 sequences).
6. Verify, all must pass: exact row counts for all 19 data tables; every sequence at or above
   `max(id)`; schema parity (see 2.3a); `alembic_version` is `b4e1c2d3f501`; all 11 `user_id` columns are `text` and no `uuid` column remains; 0 auth/storage
   schemas, 0 FKs into auth, 0 RLS tables, 0 anon/authenticated grants.

Rehearsal timings (data steps only): dump 35 s, restore 157-169 s, profiles 2 s,
sequences 4 s.
**TODO:** the rehearsal and verification scripts currently live in a scratch directory;
move them into `backend/scripts/` before the real run.

**2.3a Schema parity.** Compare `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-comments`
of both sides. The only expected differences are `profiles.accent_color`, Supabase's
RLS flag on `user_devices`, and the type of the 11 `user_id` columns (`uuid` in Supabase,
`text` here, by design). Anything else is a stop.

### 2.3b Two users are intentionally left out
The owner deleted two imported users from Firebase on purpose: Google user **D** (uuid
starts `9e41089a`; 9 applications, 41 resume scans, 6 interview sessions in the copy) and
the unverified email/password user (uuid starts `c007ac55`; an empty profile). Decision:
**do not import them and do not load their data into `career_coach`.** Their data stays in
Supabase and in the final backup; nothing is deleted from Supabase.
* **Import:** the final `import_users_to_firebase.py` must skip both uids (an
  `--exclude-uid` option is added before the final run; the dry run must then show 2 users
  fewer, and `--verify` must apply the same exclusion), otherwise it would recreate them.
* **Data:** after the data load, erase both uids from `career_coach` with the application's
  own `privacy.delete_user_data` (it covers all 15 tables), then re-run the row-count
  check, expecting those users' rows to be the only differences from Supabase. The full
  uuids are read from Supabase at that time, not written here.

### 2.4 Firebase user import
`SOURCE_DB_URL=... python backend/scripts/import_users_to_firebase.py` is a **dry run** by
default (counts only, never prints personal data). Then `--apply --project <id>` and
`--verify --project <id>`. Needs Application Default Credentials
(`gcloud auth application-default login`).
Expected: 4 users, 3 with a Google identity, 1 with a bcrypt password, 3 verified and
1 not. After the import, sign in as one Google user and the password user and confirm each
Firebase UID equals the old Supabase UUID. The password user is the real test that
Firebase accepts the bcrypt hash.

### 2.5 Point everyone at the new stack
Each developer, in `backend/.env`: `DB_URL` to Cloud SQL (through the Cloud SQL Auth
Proxy locally), `FIREBASE_PROJECT_ID`, and delete the `SUPABASE_*` entries. In
`frontend/.env.local`: the `VITE_FIREBASE_*` values. `ADMIN_EMAILS` as above.

### 2.6 Supabase read-only guard (after the copy is verified)
So a stray script fails loudly instead of writing to the old database. Reversible.
**TODO:** the exact statement is shown to the owner and approved when this step is reached;
it is not written here.

### 2.7 Smoke tests
Backend test suite; the read and write smoke tests against Cloud SQL; sign-in as the admin
(Google), a verified password user, and a brand-new email signup including the verify and
resend flow; erase a test account and confirm the old token is refused and zero rows remain.

### 2.8 Retirement of Supabase
Keep Supabase (read-only) for an agreed period. Before deleting: confirm the 2.2 backup
exists and restores, and that nobody's `.env` still points at Supabase. **The owner deletes
the project; nothing here does it.**

## 3. Launch checklist (before real users)

- [ ] Domain connected. Until it is bought, the web app is served from the free Firebase
      Hosting address, or runs on localhost.
- [ ] **Add the production domain to: the Firebase web API key's referrer restriction,
      Firebase authorized domains, `ALLOWED_ORIGINS`, and the OAuth client's origins.**
      (Today all four are localhost-only.)
- [ ] API reachable on its own hostname, with CORS allowing exactly the web origin.
- [ ] **Add the production domain and the `.web.app` address to the Firebase web API key's
      HTTP-referrer list.** Apply referrer changes with `--append` so the key's existing API
      restrictions are kept (`api-keys update` otherwise *replaces* restrictions). The list must
      also keep the auth domain (`https://<project>.firebaseapp.com/*`) and localhost.
- [ ] Google consent screen **published to "In production"** (in Testing only 100 listed
      test users can sign in and authorizations expire after 7 days).
- [ ] Email/Password and Google providers enabled; "link accounts that use the same email" set.
- [ ] Admin sign-in works (Google, `dandaharshith64@gmail.com`).
- [ ] The crawl **Cloud Run Job runs successfully once** and `crawl_runs` shows it.
- [ ] Smoke tests pass against the deployed stack.
- [ ] `ADMIN_EMAILS` set in the Cloud Run environment.
- [ ] Secrets are in Secret Manager, not in the image or the repo.

## 4. Rollback (until Supabase is deleted)

Point `.env` files back at Supabase and undo the read-only guard. Anything written to Cloud
SQL after the final copy would not be in Supabase; with no real users that is acceptable,
but it is a decision to make explicitly, not a surprise. The Firebase users can stay.

## 5. Mobile

Out of this launch. **Tell testers their current builds stop signing in once the backend
verifies Firebase tokens, until they install the new development build.** The mobile app
still uses Supabase and is untouched. No dual Supabase verifier is provided.

## 6. Known follow-ups (not part of the move)

* **Six migrations are deferred** (`f3b8a2c41d90` through `f8a2c61d9e03`, from the
  unmerged feature work). To be re-parented after the current head, `b4e1c2d3f501`, in a later
  release (earlier notes said after `c7e4a19d5b36`, then `a9d3c5e7f102`; `b4e1c2d3f501` now sits
  on those, so they go after it, not beside it, or there would be two heads).
* **5,645 duplicate `(source, external_id)` pairs** in `job_listings` block
  `b4d8e1f27a63`; which duplicate to keep is a data decision.
* `GET /api/user/activity` returns 500 (`router.py:125`, `created_at` is a string).
  Present identically on Supabase.
* The job feed is empty because the newest posting is older than `JOB_MAX_AGE_DAYS` (7).
  The crawl has not run since 2026-09-30. Not an incident; it must run once on Cloud Run
  Jobs before launch.
* Push-token registration reassigns an existing token to whoever registers it (the fix is
  only in the unmerged branch).
* The frontend's `typecheck` and `lint` scripts run `tsc --noEmit` against a root config
  with no files, so they check nothing. `tsc -p tsconfig.app.json --noEmit` is the real check.
* Leftover Supabase wording in `backend/.env.example` comments, `docs/oauth-setup.md`,
  the frontend `Dockerfile`, compose files, and CI workflows (7g).

## 7. Job platform decisions (Part B; the owner's addendum overrides the earlier job-feed plan)

**Sources.** No keyed, paid or sign-up API services (no JSearch, RapidAPI, Adzuna or similar);
any remaining JSearch code is removed. Kept: the public, keyless Greenhouse and Lever board
readers. Ashby, SmartRecruiters, Workable and similar boards only after their official pages
confirm they are public and permitted. **Primary collector: company career pages**, reading
schema.org `JobPosting` (JSON-LD, microdata if present) and using `sitemap.xml` / `lastmod`
to find new or changed postings cheaply. robots.txt respected, per-domain rate limits, an
identifying User-Agent, no bypassing logins or CAPTCHAs. Playwright only for pages that
genuinely need JavaScript, and only after the owner has seen which ones and why. Company
discovery extends `seed_companies.py` and `discover_boards.py`, with counts reported per method.

**Legitimacy (every posting).** From the employer's own domain or official careers platform;
the apply URL points to the employer or that platform; `validThrough` not in the past; the
page still live at last check; title, company, location-or-remote and apply URL present; no spam
patterns. A failing posting is not shown and the reason is logged. The rules are documented in
`SOURCES.md`.

**Retention.** The feed shows jobs posted in the last `FEED_WINDOW_DAYS` (default 3), using the
source's own posted date when reliable (`datePosted`, platform publish date) and `first_seen`
otherwise; which one each source uses is stated per source. A daily cleanup (Cloud Scheduler +
Cloud Run Job, advisory lock) deletes `job_listings` older than `RETENTION_DAYS` (default 3) by the
same rule. Before deleting, a lightweight "seen" record (source/company, external id or canonical
URL, first_seen) is kept so a still-open old posting is never re-added as fresh; seen records
are cleared after `SEEN_RETENTION_DAYS` (default 90). User data is protected: every table and code
path referencing job listings is listed first, and jobs a user saved, applied to or used must not
break (keep them, or snapshot the needed fields into the user's record); the design needs the
owner's approval. The first cleanup on existing data is a **dry run** showing how many rows
would be deleted and how many protected. Database size is measured before and after, with a
steady-state projection.

**Done when:** crawls run on GCP at least hourly per active company with no API services; the
feed shows only legitimate postings from the last 3 days, newest first; older jobs are deleted
daily, old postings never reappear as new, and applications and saved jobs are unaffected; every
source and legitimacy rule is in `SOURCES.md`; alerts fire if crawling or cleanup stops; and all
tests pass with evidence (recorded real pages, JSON-LD parsing, sitemap detection, legitimacy,
dedupe, the seen-list, retention and protection).

**Future, not built now: a "Post a job" flow for employers.** A simple form for an employer to
submit a posting directly. It would need employer identity and email verification, the same
legitimacy checks as crawled postings, moderation, an expiry date, and abuse limits. Left for
after launch.

