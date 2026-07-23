from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.modules.auth.router import router as auth_router
from app.modules.interview_coach.router import router as interview_router
from app.modules.resume_analyzer.router import router as resume_router

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
app.include_router(interview_router, prefix="/api/interview", tags=["Interview Coach"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
