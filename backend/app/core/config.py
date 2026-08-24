from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DB_URL: str = "sqlite:///./career_coach.db"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"

    # RapidAPI JSearch — the live job source. Unlike Apify (billed per result),
    # this is quota-limited per month, so the scarce resource is *requests*,
    # not dollars: one search burns one unit whether it returns 1 job or 50.
    # That makes the TTL cache in job_market/services.py the load-bearing
    # quota protection, not a performance nicety.
    RAPIDAPI_KEY: str = ""
    RAPIDAPI_HOST: str = "jsearch.p.rapidapi.com"

    # Apify — legacy job source, kept behind JOB_SOURCE. The actor is billed
    # per result ($0.003 each on khadinakbar/google-jobs-scraper), so every
    # knob below is a cost lever, not just a tuning one:
    #   RESULTS_PER_QUERY x (warm roles + distinct on-demand searches)
    # is the per-refresh spend. Raising either multiplies the bill.
    # With no token set the job feed degrades to cache-only rather than
    # erroring, so local dev and CI work without an Apify account.
    APIFY_API_TOKEN: str = ""
    APIFY_ACTOR_ID: str = "khadinakbar/google-jobs-scraper"
    # Which backend the job feed reads from: "jsearch" (RapidAPI, quota-limited)
    # or "apify" (per-result billing). Both implement the same contract in
    # app/modules/job_market/.
    JOB_SOURCE: str = "jsearch"

    # How long a cached query stays fresh, and therefore the hard floor on
    # quota burn: a query costs at most one request per window.
    #
    # 72h is set by arithmetic, not taste. JSearch's free tier allows 200
    # requests/month and the warm set is 8 roles:
    #     daily   -> 8 x 30 = 240/month  (over quota before a single user search)
    #     3-daily -> 8 x 10 =  80/month  (leaves ~120 for on-demand searches)
    # Lowering this raises quota burn superlinearly once user searches are in
    # the mix. Check the arithmetic before shortening it.
    JOB_CACHE_TTL_HOURS: int = 72
    # JSearch returns ~10 results per request regardless of this value; it
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


settings = Settings()
