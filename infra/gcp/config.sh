# HireLoom on Google Cloud: every name and setting the infra scripts share.
# Sourced by the numbered scripts; nothing here creates anything.
# Secrets are never written here: they live in Secret Manager.

PROJECT_ID="project-aeb81a89-8d57-46ee-ab2"
REGION="us-east1"                         # API, jobs, Cloud SQL, scheduler
# Cloud Run GPUs are offered in a subset of regions. Check with
# 00_preflight.sh; a region next to us-east1 costs ~20 ms per request,
# nothing next to a model call.
GPU_REGION="${GPU_REGION:-us-east4}"

SQL_INSTANCE="career-coach-pg"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
DB_NAME="career_coach"
DB_USER="app_user"
DB_PASSWORD_SECRET="career-coach-db-password"   # exists; owned outside these scripts
DB_URL_SECRET="hireloom-db-url"                 # composed by 10_foundation.sh

REPO="hireloom"                                  # Artifact Registry (docker)
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
API_IMAGE="${REGISTRY}/api"
OLLAMA_IMAGE="${GPU_REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/ollama"

# Service accounts: one per workload, each with only what it uses.
SA_API="hireloom-api@${PROJECT_ID}.iam.gserviceaccount.com"            # exists
SA_JOBS="hireloom-jobs@${PROJECT_ID}.iam.gserviceaccount.com"          # crawler + enricher
SA_SCHEDULER="hireloom-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" # starts the jobs
SA_OLLAMA="hireloom-ollama@${PROJECT_ID}.iam.gserviceaccount.com"      # runs the model, no grants
SA_BUILD="hireloom-build@${PROJECT_ID}.iam.gserviceaccount.com"        # Cloud Build: read source, push images
BUILD_SOURCE_BUCKET="${PROJECT_ID}_cloudbuild"                         # where gcloud builds submit uploads
FIREBASE_ROLE="projects/${PROJECT_ID}/roles/hireloomFirebaseUserAdmin"  # exists
AVATAR_BUCKET="hireloom-avatars-452189867278"                          # exists
# Private; holds the trained ATS model (gitignored, so not in any build).
MODELS_BUCKET="hireloom-models-452189867278"

API_SERVICE="hireloom-api"
OLLAMA_SERVICE="hireloom-ollama"
CRAWLER_JOB="hireloom-crawler"
ENRICHER_JOB="hireloom-enricher"
CRAWL_SCHEDULE="*/20 * * * *"       # owner's cadence (2026-10-15)
ENRICH_SCHEDULE="5 * * * *"         # hourly: wakes the GPU once, not every crawl
SCHEDULE_TZ="America/Phoenix"

# App settings (not secret).
FIREBASE_PROJECT_ID="${PROJECT_ID}"
ADMIN_EMAILS="dandaharshith64@gmail.com"
# The web app's origin(s), comma-separated. Set when the frontend has a
# home (Firebase Hosting or a domain); production refuses to start without.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
OLLAMA_MODEL="llama3.1"
OLLAMA_TAILOR_MODEL="qwen2.5:14b"
OLLAMA_EMBED_MODEL="nomic-embed-text"
# Models baked into the GPU image (20_build.sh). Keep in step with the three above.
OLLAMA_MODELS="llama3.1 qwen2.5:14b nomic-embed-text"
OLLAMA_VERSION="0.24.0"             # the version this Mac runs and was tested with

# Connection budget (MIGRATION_RUNBOOK §1: max_connections 50).
API_DB_POOL="6"; API_DB_OVERFLOW="3"
JOB_DB_POOL="4"; JOB_DB_OVERFLOW="3"
