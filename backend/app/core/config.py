from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DB_URL: str = "sqlite:///./career_coach.db"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"

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
