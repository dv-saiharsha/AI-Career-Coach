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
    # Sized for Supabase's TRANSACTION pooler (port 6543), where a connection
    # is returned to the pool at the end of each transaction rather than held
    # for the life of the session. That is what lifts the ceiling: session mode
    # (port 5432) caps at 15 clients and fails with EMAXCONNSESSION rather than
    # queuing, so these numbers are only safe while the DSN points at 6543.
    #
    # pool_recycle is short (300s) because pgbouncer drops idle server-side
    # connections; recycling before it does avoids handing out a dead socket.
    # Redis for cross-worker SSE fan-out. Unset means in-process fan-out,
    # which is correct for a single worker and silently wrong for more than
    # one — an event published on worker A never reaches a client on worker B.
    # Left optional so local dev and CI need no Redis to boot.
    REDIS_URL: str = ""

    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
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

    # Apify — the live job source (cheap_scraper/linkedin-job-scraper).
    # Billed per event, not per month: $0.005 per GB of memory at actor start
    # (4 GB default = $0.02 a run) plus $0.0007 per result. The actor also
    # enforces a 150-result floor, so the minimum realistic cost of touching
    # one role is about $0.13 — there is no cheap probe.
    #
    # That makes every knob here a spend lever rather than a tuning one, and
    # makes the TTL cache in job_market/services.py load-bearing: a cache hit
    # is the difference between $0 and $0.13.
    #
    # With no token set the job feed degrades to cache-only rather than
    # erroring, so local dev and CI work without an Apify account.
    APIFY_API_TOKEN: str = ""

    # Keyword search returns nothing without a location — the actor exits
    # SUCCEEDED with an empty dataset and still bills the start fee. Comma
    # separated.
    JOB_LOCATIONS: str = "United States"

    # Enrichment runs on Haiku via the Batch API. Overridable so a sweep can
    # be re-run on a stronger model without a code change; cost reporting goes
    # silent for anything but the default rather than quoting a stale rate.
    JOB_ENRICHMENT_MODEL: str = ""

    # Which backend the job feed reads from. One branch today, kept as a seam
    # so adding a provider is an elif in job_market/services._fetch rather
    # than re-plumbing every caller.
    JOB_SOURCE: str = "apify"

    # How long a cached query stays fresh, and therefore the hard floor on
    # spend: a query costs at most one actor run per window.
    #
    # 72h is set by arithmetic, not taste. Each run is ~$0.13 and the warm set
    # is 9 roles:
    #     daily   -> 9 x 30 x $0.13 = ~$35/month
    #     3-daily -> 9 x 10 x $0.13 = ~$12/month
    # Shortening this scales the bill linearly, and superlinearly once
    # on-demand user searches are in the mix. Check the arithmetic first.
    JOB_CACHE_TTL_HOURS: int = 72
    # Hard age boundary for anything shown to a user. Distinct from the cache
    # TTL above, which decides when to re-scrape: a listing can be served from
    # a stale cache and still be recent enough to apply to, but past this it is
    # suppressed outright — an expired posting wastes an application.
    JOB_MAX_AGE_DAYS: int = 4
    # The actor enforces a 150-result floor regardless of this value; it
    # only bounds how many we keep. Apify bills per result, where it matters.
    JOB_RESULTS_PER_QUERY: int = 40
    # Hard ceiling on a single actor run, enforced before the call is made.
    # Guards against a malformed query fanning out into a large paid run.
    JOB_MAX_RESULTS_PER_RUN: int = 100
    # Backstop enforced by Apify itself, independent of our per-result price
    # assumption: the run is aborted server-side if it would bill past this.
    # Belt-and-braces with JOB_MAX_RESULTS_PER_RUN — that one trusts our own
    # arithmetic, this one does not.
    JOB_MAX_SPEND_PER_RUN_USD: float = 0.50

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


settings = Settings()


def validate_startup() -> None:
    """Fail loudly at import time rather than deep inside a request.

    Only enforced when ENVIRONMENT=production — every other required-looking
    setting below has a permissive default specifically so local dev and CI
    need no .env to boot (DEEPGRAM_API_KEY/APIFY_API_TOKEN degrade features
    gracefully when unset, by design; the ones checked here don't have a
    degraded mode, so silently booting without them just moves the failure
    from "won't start" to "500s on the first real request").
    """
    if not settings.is_production:
        return

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
