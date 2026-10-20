#!/usr/bin/env bash
# The API on Cloud Run. THIS PUBLISHES THE BACKEND: the service gets a public
# HTTPS URL (the app authenticates every request itself with Firebase ID
# tokens, so the service must accept unauthenticated traffic at the edge).
#
# Owner's rule (2026-10-15): do not deploy or publish until they say so. So
# beyond APPLY=1 this needs DEPLOY_APPROVED=yes, and a dry run is the default.
#
# One instance (--max-instances 1): no Redis, the in-process erasure block and
# realtime fan-out are exact only on one instance (MIGRATION_RUNBOOK §1). Raise
# it only after adding Redis or LISTEN/NOTIFY.
source "$(dirname "$0")/lib.sh"
banner

if [[ "${APPLY}" == "1" && "${DEPLOY_APPROVED:-}" != "yes" ]]; then
  echo "Refusing: deploying the API publishes the backend. The owner must approve;" >&2
  echo "then run with APPLY=1 DEPLOY_APPROVED=yes." >&2
  exit 1
fi

ollama_url="$(gc run services describe "${OLLAMA_SERVICE}" --region "${GPU_REGION}" --format='value(status.url)' 2>/dev/null || true)"
[[ -n "${ollama_url}" ]] || { [[ "${APPLY}" == "1" ]] && { echo "Run 30_ollama.sh first." >&2; exit 1; }; ollama_url="https://<${OLLAMA_SERVICE} url>"; }
[[ -n "${ALLOWED_ORIGINS}" ]] || { [[ "${APPLY}" == "1" ]] && { echo "Set ALLOWED_ORIGINS first." >&2; exit 1; }; ALLOWED_ORIGINS="https://<frontend origin>"; }

pairs=(
  "ENVIRONMENT=production"
  "LLM_PROVIDER=ollama"
  "ANTHROPIC_API_KEY="
  "OLLAMA_BASE_URL=${ollama_url}"
  "OLLAMA_AUTH=google_id_token"
  "OLLAMA_MODEL=${OLLAMA_MODEL}"
  "OLLAMA_TAILOR_MODEL=${OLLAMA_TAILOR_MODEL}"
  "OLLAMA_FALLBACK_MODEL="
  "OLLAMA_EMBED_MODEL=${OLLAMA_EMBED_MODEL}"
  # A GPU cold start (container + model load) can take minutes on the first
  # request after idle; interactive calls get room for it.
  "OLLAMA_TIMEOUT_INTERACTIVE_SECONDS=300"
  "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}"
  "ADMIN_EMAILS=${ADMIN_EMAILS}"
  "ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
  "AVATAR_BUCKET=${AVATAR_BUCKET}"
  "AVATAR_SIGNER_SERVICE_ACCOUNT=${SA_API}"
  "AVATAR_IMPERSONATE_SIGNER=false"
  # The crawl is the Cloud Run Job's, never the API's.
  "JOB_SWEEP_ENABLED=false"
  "UVICORN_WORKERS=1"
  "DB_POOL_SIZE=${API_DB_POOL}"
  "DB_MAX_OVERFLOW=${API_DB_OVERFLOW}"
)
env_flag="$(IFS='|'; printf '^|^%s' "${pairs[*]}")"

say "Service ${API_SERVICE} in ${REGION}"
run gc run deploy "${API_SERVICE}" \
  --image "${API_IMAGE}:latest" \
  --region "${REGION}" \
  --service-account "${SA_API}" \
  --add-cloudsql-instances "${SQL_CONNECTION}" \
  --set-secrets "DB_URL=${DB_URL_SECRET}:latest" \
  --set-env-vars "${env_flag}" \
  --allow-unauthenticated \
  --port 8000 \
  --cpu 2 --memory 2Gi \
  --min-instances 0 --max-instances 1 \
  --concurrency 80 \
  --timeout 3600
# --timeout 3600: /events/stream is a long-lived server-sent-events stream.
