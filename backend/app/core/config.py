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
    # Free — board reads only, never Claude — so leaving it on costs nothing
    # but requests. Turn it off for a process that should not sweep: a
    # one-off script, or a second replica where one worker already covers it,
    # or (the production default, set in docker-compose.prod.yml) the API
    # service once the `worker` service covers the same ground and more.
    # Upserts are idempotent on content_hash, so two workers sweeping is
    # wasteful rather than wrong.
    JOB_SWEEP_ENABLED: bool = True

    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    DB_POOL_RECYCLE_SECONDS: int = 300

    # Seconds the default job feed is served from process memory before
    # re-querying. The feed is identical for every user sharing a target-role
    # set, so this turns N concurrent readers into one query.
    JOB_FEED_CACHE_SECONDS: int = 60
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"

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

    # Comma-separated allowlist gating the admin crawl API
    # (job_market/admin_router.py) — checked against the authenticated
    # user's email, same pattern as ALLOWED_ORIGINS. Empty means nobody can
    # reach it, which is the correct default until an operator sets one.
    ADMIN_EMAILS: str = ""

    # Slack-compatible incoming webhook URL for crawl failure alerts. Optional
    # — unset means alerts are logged only, which is also the correct default
    # for local dev and CI.
    ALERT_WEBHOOK_URL: str = ""

    # Supabase Auth — the FastAPI backend verifies tokens Supabase issues,
    # it no longer signs its own. SUPABASE_JWT_SECRET is under
    # Project Settings -> API -> JWT Settings in the Supabase dashboard.
    SUPABASE_URL: str = ""
    SUPABASE_JWT_SECRET: str = ""
    # Elevated-privilege key for calling Supabase's own APIs directly (admin
    # user management, etc). Not used by the token-verification path above.
    SUPABASE_SECRET_API_KEY: str = ""

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
    if not settings.SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not settings.SUPABASE_JWT_SECRET:
        missing.append("SUPABASE_JWT_SECRET")
    if not settings.ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if not settings.allowed_origins_list or settings.ALLOWED_ORIGINS.strip() == "*":
        missing.append("ALLOWED_ORIGINS (must be a real, non-wildcard origin list in production)")

    if missing:
        raise RuntimeError(
            "Refusing to start with ENVIRONMENT=production while required configuration is "
            "missing or still at its development default: " + "; ".join(missing) + ". "
            "Set these in the environment before starting the app — see .env.example."
        )


validate_startup()
