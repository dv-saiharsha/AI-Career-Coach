import logging

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # "development" (default — permissive, no .env required to boot, matches
    # local dev/CI) or "production", which turns on validate_startup()'s
    # fail-fast checks below. Never inferred from DB_URL/other settings: an
    # explicit flag can't be silently defeated by one forgotten variable.
    ENVIRONMENT: str = "development"

    # Comma-separated request origins the API accepts. Never "*" in
    # production — see validate_startup(). The dev default covers the two
    # ports this project's frontend actually runs on locally.
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Root logger level. INFO in dev/prod alike by default; turned down for
    # noisy dependencies rather than the whole app, so a real WARNING from
    # this codebase's own modules is never lost in the same silence.
    LOG_LEVEL: str = "INFO"

    DB_URL: str = "sqlite:///./career_coach.db"

    # Concurrency ceiling for the whole process: pool_size + max_overflow is
    # the maximum number of simultaneous database operations.
    #
    # Sized for Supabase's SESSION pooler (port 5432), which holds a connection
    # for the life of the session and caps at 15 clients per project, failing
    # with EMAXCONNSESSION rather than queuing. 5 + 5 leaves headroom under
    # that cap for Alembic, a psql session, and a second worker.
    #
    # These two numbers and the port in DB_URL are one decision, not two. The
    # transaction pooler (6543) lifts the client cap and would carry 20 + 10
    # comfortably — but it supports neither prepared statements nor the session
    # state DDL and advisory locks need, so migrations against it fail
    # intermittently. This codebase chooses correctness at 5432 and pays for it
    # with a lower ceiling. If you raise these, move the port first and read
    # warn_if_transaction_pooler below; raising them alone converts a working
    # deployment into EMAXCONNSESSION under load.
    #
    # pool_recycle is short (300s) because pgbouncer drops idle server-side
    # connections; recycling before it does avoids handing out a dead socket.
    # Redis for cross-worker SSE fan-out. Unset means in-process fan-out,
    # which is correct for a single worker and silently wrong for more than
    # one — an event published on worker A never reaches a client on worker B.
    # Left optional so local dev and CI need no Redis to boot.
    REDIS_URL: str = ""

    # Whether this process runs the hourly ATS board sweep
    # (job_market/ingestion.py + scheduler.py — the older Greenhouse/Lever/
    # Ashby sweep, not job_market/crawler.py's companies-table crawl, which
    # the separate `worker` service runs unconditionally).
    #
    # Defaults OFF as of the companies-table crawler's go-live: the `worker`
    # service (job_market/crawler.py) is now the one and only writer of
    # job_listings, with company_id linkage, the close-after-2-misses
    # lifecycle, and enrichment — the older sweep has none of those. Opt back
    # in per-process (e.g. local dev without `worker` running) by setting
    # JOB_SWEEP_ENABLED=true; it is still free (board reads only, never
    # Claude) and its upserts are idempotent on content_hash, so turning it
    # on alongside `worker` is wasteful rather than wrong — it just no longer
    # happens by default.
    JOB_SWEEP_ENABLED: bool = False
    # The crawl worker's cadence (app/worker.py): one run every this many
    # seconds, measured from the start of the previous run.
    CRAWL_INTERVAL_SECONDS: int = 3600

    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    DB_POOL_RECYCLE_SECONDS: int = 300

    # Seconds the default job feed is served from process memory before
    # re-querying. The feed is identical for every user sharing a target-role
    # set, so this turns N concurrent readers into one query.
    JOB_FEED_CACHE_SECONDS: int = 60
    # Which model serves every AI feature (analysis, tailoring, cover letters,
    # interview coach): "ollama" (a local model, free) or "anthropic" (Claude,
    # billed, needs ANTHROPIC_API_KEY). See core/llm.py. Defaults to ollama
    # while no Anthropic credits are available; switching back is this one
    # setting. Job enrichment uses Anthropic's Batch API under
    # LLM_PROVIDER=anthropic and one capped request at a time under ollama
    # (OLLAMA_ENRICH_MAX_PER_RUN).
    LLM_PROVIDER: str = "ollama"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"

    # Ollama (LLM_PROVIDER=ollama). The timeout is per request and generous
    # because an 8B model on a laptop can take a minute on a long resume.
    # NUM_CTX must cover the largest prompt we send (JD up to ~6k chars plus
    # resume up to ~8k chars, roughly 4-5k tokens); Ollama's own default
    # context is much smaller and silently truncates the prompt.
    #
    # Ollama runs natively on the host, not in Docker. From a container, point
    # OLLAMA_BASE_URL at http://host.docker.internal:11434.
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.1"
    # The JD analyzer's model, when it should differ from OLLAMA_MODEL (an
    # experiment with a larger model). Empty: OLLAMA_MODEL. Nothing else uses it.
    OLLAMA_ANALYZER_MODEL: str = ""
    # The Tailor Resume rewrite's model, when it should differ from OLLAMA_MODEL
    # (the rewrite benefits most from a larger model). Empty: OLLAMA_MODEL.
    OLLAMA_TAILOR_MODEL: str = ""
    # Used only when OLLAMA_MODEL isn't pulled. Empty disables the fallback.
    OLLAMA_FALLBACK_MODEL: str = "llama3.2"
    # Embeddings (/api/embed). No fallback: vectors from two different
    # embedding models are not comparable.
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    # How long one Ollama request may take. Interactive requests (a user is
    # waiting: scan, tailor, JD analysis, chat) give up sooner and fall back;
    # background work (the crawl worker's enrichment, scripts, evaluation)
    # can wait for a long reply. Code marks itself background with
    # app.core.llm.background().
    OLLAMA_TIMEOUT_INTERACTIVE_SECONDS: float = 150.0
    OLLAMA_TIMEOUT_BACKGROUND_SECONDS: float = 300.0
    # JD analyzer: after the first call, ask again on the recognised
    # requirements section(s) only, instead of the "what did you miss" call.
    # Off by default (an experiment: better recall, lower precision, slower).
    JD_FOCUSED_CALL: bool = False
    # Sent as "keep_alive" on every /api/chat and /api/embed request, so the
    # model stays loaded this long after its last use (Ollama's own default is
    # 5 minutes, after which the next request pays a ~20 s reload). Setting it
    # per request means no change to how `ollama serve` is started. A duration
    # like "30m", or a number of seconds; "-1" keeps it loaded indefinitely and
    # "0" unloads it right after each request.
    OLLAMA_KEEP_ALIVE: str = "30m"
    # Retries per call, both for transport errors / 5xx and for a reply that
    # is not valid, schema-conforming JSON. 1 try + this many retries.
    OLLAMA_MAX_RETRIES: int = 2
    OLLAMA_NUM_CTX: int = 8192
    # Structured calls (extraction, scoring, tailoring) must be repeatable, so
    # 0. Streaming chat (Career Coach) gets a little variety.
    OLLAMA_TEMPERATURE: float = 0.0
    OLLAMA_CHAT_TEMPERATURE: float = 0.3
    # Under Ollama, job enrichment is one request per posting, sequentially, so
    # a crawl run must not be held for hours by a large backlog. At most this
    # many postings per run; the rest keep enriched_at NULL and are picked up
    # by the next run.
    OLLAMA_ENRICH_MAX_PER_RUN: int = 25

    # Voice Interview's speech-to-text provider. Unset means the feature
    # degrades to "unavailable" (a clear error, not a crash) — same shape as
    # ANTHROPIC_API_KEY being unset, so local dev and CI need no Deepgram
    # account to boot.
    DEEPGRAM_API_KEY: str = ""
    DEEPGRAM_TIMEOUT_SECONDS: float = 30.0

    # Enrichment runs on Haiku via the Batch API. Overridable so a sweep can
    # be re-run on a stronger model without a code change; cost reporting goes
    # silent for anything but the default rather than quoting a stale rate.
    JOB_ENRICHMENT_MODEL: str = ""

    # Hard age boundary for anything shown to a user, on every read path
    # (job_market/services.py). A listing past this is suppressed outright —
    # an expired posting wastes an application. Seven days: four kept the
    # grid very fresh but thin, and a five-day-old posting is still open far
    # more often than not. The cost of the trade is asymmetric in the other
    # direction too — a candidate who never sees a role loses more than one
    # who applies to a filled one.
    JOB_MAX_AGE_DAYS: int = 7

    # Crawler contact — every request the crawler makes (ATS boards and
    # JSON-LD careers pages alike) identifies itself with a User-Agent that
    # names a real contact, so an operator who wants to block or reach us
    # can. Falls back to a placeholder rather than failing to boot: a blank
    # value in dev/CI shouldn't stop the app, but production should set a
    # real one.
    CRAWLER_CONTACT_EMAIL: str = ""

    # job_market/crawler.py: how many companies are crawled at once. Bounded
    # thread pool, not a process/connection ceiling — this and DB_POOL_SIZE
    # are independent knobs.
    CRAWLER_CONCURRENCY: int = 10
    # Minimum gap between two requests to the same host, regardless of which
    # company or thread issues them — several companies on the same ATS
    # (e.g. every Greenhouse board) share boards-api.greenhouse.io, and
    # concurrency above is what's bounded per company, not per host.
    CRAWLER_PER_DOMAIN_MIN_INTERVAL_MS: int = 250

    # How long a closed job_listings row is kept before the crawler
    # hard-deletes it (status transitions through job_market/crawler.py).
    JOB_CLOSED_RETENTION_DAYS: int = 90

    # Real, enforced ceiling on Claude enrichment spend per crawl run — unlike
    # ingestion.py's MAX_SWEEP_COST_USD, which that module's own sweep never
    # actually checks anywhere in code (it only appears in a dry-run message).
    # Real cost isn't known until the Batch API responds, so this is enforced
    # by bounding *request count* before submitting the batch, from a
    # deliberately pessimistic per-request cost (see
    # crawler._enrichment_request_cap for the arithmetic). A backlog larger
    # than one run's cap is not lost — enriched_at stays null on the
    # untouched rows, so the next hourly run picks up where this one left off.
    JOB_ENRICH_MAX_COST_PER_RUN_USD: float = 3.00

    # Comma-separated allowlist gating the admin crawl API
    # (job_market/admin_router.py) — checked against the authenticated
    # user's email, same pattern as ALLOWED_ORIGINS. Empty means nobody can
    # reach it, which is the correct default until an operator sets one.
    ADMIN_EMAILS: str = ""

    # Slack-compatible incoming webhook URL for crawl failure alerts. Optional
    # — unset means alerts are logged only, which is also the correct default
    # for local dev and CI.
    ALERT_WEBHOOK_URL: str = ""

    # Firebase Authentication — the backend verifies the ID tokens Firebase
    # issues and never signs its own. The project id is all the verifier needs;
    # there is no shared secret to configure. Credentials for the calls that DO
    # need privilege (checking a user still exists, deleting a user) come from
    # Application Default Credentials: the Cloud Run service account in
    # production, `gcloud auth application-default login` locally.
    FIREBASE_PROJECT_ID: str = ""

    # Profile photos live in a private Cloud Storage bucket. Unset AVATAR_BUCKET
    # turns custom photos off (the sign-in provider's picture is shown instead).
    AVATAR_BUCKET: str = ""
    # The service account that signs upload and read URLs through the IAM
    # Credentials signBlob API. On Cloud Run the service already runs as this
    # account; it needs roles/iam.serviceAccountTokenCreator on itself.
    AVATAR_SIGNER_SERVICE_ACCOUNT: str = ""
    # LOCAL DEVELOPMENT ONLY. A developer's own login cannot sign, so the backend
    # impersonates AVATAR_SIGNER_SERVICE_ACCOUNT instead (the developer needs
    # roles/iam.serviceAccountTokenCreator on it). Leave false anywhere the
    # service already runs as that account.
    AVATAR_IMPERSONATE_SIGNER: bool = False
    AVATAR_MAX_BYTES: int = 5 * 1024 * 1024

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def admin_emails_list(self) -> list[str]:
        return [email.strip().lower() for email in self.ADMIN_EMAILS.split(",") if email.strip()]


settings = Settings()


def warn_if_transaction_pooler() -> None:
    """Warn when DB_URL points at Supabase's transaction pooler.

    Deliberately NOT gated on ENVIRONMENT, and called from alembic/env.py as
    well as from validate_startup. The failure it catches surfaces during
    `alembic upgrade head` — which never calls validate_startup — so a check
    that only ran on a production boot would stay silent in exactly the
    situation it exists for.
    """
    # ── Connection pooler ────────────────────────────────────────────────
    #
    # Supabase publishes two pooler ports and they are not interchangeable:
    #
    #   6543  transaction pooler — a connection per statement. Does NOT
    #         support prepared statements, which SQLAlchemy uses by default
    #         and psycopg emits for nearly every query. It also cannot hold
    #         the session state that Alembic's DDL and advisory locks need,
    #         so `alembic upgrade head` against it fails intermittently and
    #         confusingly rather than cleanly.
    #
    #   5432  session pooler — a connection for the life of the session.
    #         What SQLAlchemy and Alembic actually want.
    #
    # Pointing DB_URL at 6543 mostly works, which is the dangerous part: it
    # fails under concurrency and during migrations, not on the first request.
    # So it is a warning rather than a hard stop — a deployment that has
    # genuinely disabled prepared statements is valid, and this should not
    # refuse to boot for it.
    if ":6543/" in settings.DB_URL and "prepare_threshold" not in settings.DB_URL:
        logging.getLogger(__name__).warning(
            "DB_URL points at the Supabase transaction pooler (:6543). That port "
            "does not support prepared statements, which SQLAlchemy emits by "
            "default, and Alembic migrations against it fail intermittently. "
            "Use the session pooler (:5432) for the app and for migrations, or "
            "append ?prepare_threshold=0 if you know this pool is configured "
            "for it."
        )


def validate_startup() -> None:
    """Fail loudly at import time rather than deep inside a request.

    Only enforced when ENVIRONMENT=production — every other required-looking
    setting below has a permissive default specifically so local dev and CI
    need no .env to boot (DEEPGRAM_API_KEY degrades that feature gracefully
    when unset, by design; the ones checked here don't have a degraded mode,
    so silently booting without them just moves the failure from "won't
    start" to "500s on the first real request").
    """
    if not settings.is_production:
        return

    warn_if_transaction_pooler()

    missing: list[str] = []
    if settings.DB_URL.startswith("sqlite"):
        missing.append("DB_URL (still the local SQLite default — set it to the production Postgres URL)")
    if not settings.FIREBASE_PROJECT_ID:
        missing.append("FIREBASE_PROJECT_ID")
    provider = settings.LLM_PROVIDER.strip().lower()
    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            missing.append("ANTHROPIC_API_KEY (LLM_PROVIDER=anthropic)")
    elif provider != "ollama":
        # Ollama needs nothing here: whether the server is reachable and the
        # models are pulled is checked when the app starts (main.log_startup_state),
        # as a warning, because validate_startup runs at import time and must
        # not make network calls.
        missing.append(f"LLM_PROVIDER (must be 'ollama' or 'anthropic', got {provider!r})")
    if not settings.allowed_origins_list or settings.ALLOWED_ORIGINS.strip() == "*":
        missing.append("ALLOWED_ORIGINS (must be a real, non-wildcard origin list in production)")

    if missing:
        raise RuntimeError(
            "Refusing to start with ENVIRONMENT=production while required configuration is "
            "missing or still at its development default: " + "; ".join(missing) + ". "
            "Set these in the environment before starting the app — see .env.example."
        )


validate_startup()
