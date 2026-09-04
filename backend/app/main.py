import anthropic
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.analytics.router import router as analytics_router
from app.modules.applications.router import router as applications_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.events.router import router as events_router
from app.modules.auth.router import router as auth_router
from app.modules.interview_coach.router import router as interview_router
from app.modules.job_market import scheduler
from app.modules.job_market.router import router as jobs_router
from app.modules.notifications.router import router as notifications_router
from app.modules.offers.router import router as offers_router
from app.modules.resume_analyzer.router import router as resume_router
from app.modules.resume_builder.router import router as resume_builder_router
from app.modules.cover_letter.router import router as cover_letter_router
from app.modules.user_profile.router import router as user_router

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_: FastAPI):
    """Start and stop the hourly board sweep alongside the app.

    Only the free half of the sweep runs on this timer — Greenhouse and Lever
    board reads. Apify and Claude are never called here: both bill per use,
    and putting either on a schedule means money leaving the account on a
    clock with nobody watching. The paid pass stays a deliberate human action.

    Gated on a setting so a worker that should not sweep — a one-off script, a
    test process, a second replica — can opt out without a code change.
    """
    scheduler.start(enabled=settings.JOB_SWEEP_ENABLED)
    try:
        yield
    finally:
        await scheduler.stop()


app = FastAPI(title="ApplyCenter API", lifespan=lifespan)

# Origins come from settings, never a literal "*" — see config.py's
# validate_startup(), which refuses to boot in production with a wildcard or
# empty list here. allow_credentials stays on since nothing today rules out
# a future cookie-based auth flow (the frontend already depends on
# @supabase/ssr); a real allowlist is what makes that combination safe,
# where "*" was not.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Schema is now owned by Alembic migrations (see backend/alembic/), not
# create_all — run `alembic upgrade head` against the Supabase Postgres DB
# instead of relying on app startup to create tables.

app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(resume_router, prefix="/api/resume", tags=["Resume Analyzer"])
app.include_router(resume_builder_router, prefix="/api/resume-builder", tags=["Resume Builder"])
app.include_router(cover_letter_router, prefix="/api/cover-letter", tags=["Cover Letter"])
app.include_router(interview_router, prefix="/api/interview", tags=["Interview Coach"])
app.include_router(jobs_router, prefix="/api/jobs", tags=["Job Market"])
app.include_router(applications_router, prefix="/api/applications", tags=["Application Pipeline"])
app.include_router(offers_router, prefix="/api/offers", tags=["Offer Comparison"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(events_router, prefix="/api/events", tags=["Real-Time Stream"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(user_router, prefix="/api/user", tags=["User Profile"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["Notifications"])


@app.exception_handler(anthropic.APIError)
async def llm_unavailable_handler(request: Request, exc: anthropic.APIError):
    """Claude failed, and the user asked for something only Claude can do.

    WHY THIS IS GLOBAL RATHER THAN PER-ROUTE

    Eight modules reach the LLM. Each one that wants to *degrade* — resume
    scoring falling back to its rule-based path — already catches the failure
    locally and never gets here. This exists for the ones with nothing to
    fall back to: a cover letter, an interview evaluation. Their honest
    answer is "not right now", and writing that eight times is eight chances
    to write it differently, plus a ninth module later that forgets entirely.

    THE FAILURE THIS FIXES

    llm_client.available is a config check — `self._client is not None` — so
    a configured key reads as usable no matter what the API then says. When
    the account ran out of credits, every one of these routes raised
    anthropic.BadRequestError, which is not the RuntimeError the cover-letter
    route catches, and the user got a bare 500. A 500 says "we are broken";
    these failures are mostly "not right now", and the difference decides
    whether someone retries or leaves.

    The status codes distinguish what the caller can do about it: 429 means
    wait and it will work, 503 means it is us and retrying now will not help.
    """
    if isinstance(exc, anthropic.RateLimitError):
        status, detail = 429, "We're at capacity right now. Try that again in a minute."
    elif isinstance(exc, anthropic.APIConnectionError):
        status, detail = 503, "Couldn't reach the AI service. Check your connection and try again."
    else:
        # Everything else — auth, billing, a malformed request we built.
        # None of it is the user's doing and none of it is fixable by
        # retrying immediately, so they get the same honest answer.
        status, detail = 503, (
            "AI features are temporarily unavailable. Nothing you did caused this — "
            "please try again shortly."
        )

    # The operator needs the real reason; the user must not get it. An API
    # error body can carry account and billing detail that has no business
    # in a client response.
    logger.error(
        "LLM call failed on %s %s: %s",
        request.method, request.url.path, type(exc).__name__, exc_info=True,
    )
    return JSONResponse(status_code=status, content={"detail": detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Every expected failure mode is already converted to an HTTPException
    at its own router (ValueError -> 400, a lookup miss -> 404, and so on).
    This only catches what's left: a genuinely unexpected exception, which
    without this handler fell through to Starlette's bare default — no
    request context in the log, no consistent response body for the client
    to branch on."""
    logger.error("unhandled exception on %s %s", request.method, request.url.path, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health_check():
    """Checks the one dependency that actually varies request to request.
    A load balancer/orchestrator using this as a readiness probe needs to
    know the database is reachable, not just that the process is alive —
    a static 200 would keep routing traffic to an instance whose only job
    it can no longer do."""
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
    except Exception:
        logger.warning("health check: database unreachable", exc_info=True)
        return JSONResponse(status_code=503, content={"status": "error", "database": "unreachable"})
    return {"status": "ok", "database": "reachable"}
