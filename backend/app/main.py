from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.modules.analytics.router import router as analytics_router
from app.modules.applications.router import router as applications_router
from app.modules.events.router import router as events_router
from app.modules.auth.router import router as auth_router
from app.modules.career.router import router as career_router
from app.modules.interview_coach.router import router as interview_router
from app.modules.job_market.router import router as jobs_router
from app.modules.offers.router import router as offers_router
from app.modules.resume_analyzer.router import router as resume_router
from app.modules.resume_builder.router import router as resume_builder_router
from app.modules.user_profile.router import router as user_router

app = FastAPI(title="Zenith API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(interview_router, prefix="/api/interview", tags=["Interview Coach"])
app.include_router(jobs_router, prefix="/api/jobs", tags=["Job Market"])
app.include_router(applications_router, prefix="/api/applications", tags=["Application Pipeline"])
app.include_router(offers_router, prefix="/api/offers", tags=["Offer Comparison"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(events_router, prefix="/api/events", tags=["Real-Time Stream"])
app.include_router(user_router, prefix="/api/user", tags=["User Profile"])
app.include_router(career_router, prefix="/api/career", tags=["Career"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
