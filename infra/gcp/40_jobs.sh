#!/usr/bin/env bash
# The crawler and the enricher as Cloud Run Jobs, started by Cloud Scheduler.
#
#   hireloom-crawler   every 20 min   python -m app.worker --once
#                      CPU only: enrichment off, so the GPU is never woken.
#   hireloom-enricher  hourly         python scripts/enrich_jobs.py --confirm
#                      the only scheduled GPU use: one wake-up an hour.
#
# A crawl can outlast 20 minutes (a full sweep took 39). The next execution
# then finds the Postgres advisory lock held, logs "skipped" and exits 0, so
# runs never overlap and the cadence is "as fresh as possible, every 20 min".
#
# When these go live, remove the Mac LaunchAgent (README) so the cloud is the
# only crawler; the lock already prevents double runs in the meantime.
source "$(dirname "$0")/lib.sh"
banner

ollama_url="$(gc run services describe "${OLLAMA_SERVICE}" --region "${GPU_REGION}" --format='value(status.url)' 2>/dev/null || true)"
if [[ -z "${ollama_url}" ]]; then
  [[ "${APPLY}" == "1" ]] && { echo "Run 30_ollama.sh first: the jobs need its URL." >&2; exit 1; }
  ollama_url="https://<${OLLAMA_SERVICE} url, from 30_ollama.sh>"
fi
if [[ -z "${ALLOWED_ORIGINS}" ]]; then
  # The app's production check requires it even in a job. Set it in the
  # environment when running this script (the frontend's origin).
  [[ "${APPLY}" == "1" ]] && { echo "Set ALLOWED_ORIGINS (the web app's origin) first." >&2; exit 1; }
  ALLOWED_ORIGINS="https://<frontend origin>"
fi

# "^|^" makes | the separator, so values may contain commas.
job_env() {  # extra KEY=VALUE pairs appended
  local pairs=(
    "ENVIRONMENT=production"
    "LLM_PROVIDER=ollama"
    "ANTHROPIC_API_KEY="
    "OLLAMA_BASE_URL=${ollama_url}"
    "OLLAMA_AUTH=google_id_token"
    "OLLAMA_MODEL=${OLLAMA_MODEL}"
    "OLLAMA_FALLBACK_MODEL="
    "OLLAMA_EMBED_MODEL=${OLLAMA_EMBED_MODEL}"
    "FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}"
    "ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
    "JOB_SWEEP_ENABLED=false"
    "DB_POOL_SIZE=${JOB_DB_POOL}"
    "DB_MAX_OVERFLOW=${JOB_DB_OVERFLOW}"
    "$@"
  )
  local IFS='|'
  printf '^|^%s' "${pairs[*]}"
}

deploy_job() {  # name, args (comma-separated), extra env...
  local name="$1" args="$2"; shift 2
  say "Job ${name}"
  run gc run jobs deploy "${name}" \
    --image "${API_IMAGE}:latest" \
    --region "${REGION}" \
    --service-account "${SA_JOBS}" \
    --set-cloudsql-instances "${SQL_CONNECTION}" \
    --set-secrets "DB_URL=${DB_URL_SECRET}:latest" \
    --set-env-vars "$(job_env "$@")" \
    --command python --args="${args}" \
    --tasks 1 --max-retries 1 --task-timeout 3600s \
    --cpu 1 --memory 2Gi
  run gc run jobs add-iam-policy-binding "${name}" --region "${REGION}" \
    --member "serviceAccount:${SA_SCHEDULER}" --role roles/run.invoker --format=none
}

schedule() {  # scheduler job name, cron, run job name
  local sched="$1" cron="$2" job="$3"
  local uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${job}:run"
  local verb=create
  exists gc scheduler jobs describe "${sched}" --location "${REGION}" && verb=update
  say "Schedule ${sched}: '${cron}' (${SCHEDULE_TZ}) -> ${job}"
  run gc scheduler jobs "${verb}" http "${sched}" --location "${REGION}" \
    --schedule "${cron}" --time-zone "${SCHEDULE_TZ}" \
    --uri "${uri}" --http-method POST \
    --oauth-service-account-email "${SA_SCHEDULER}" \
    --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform"
}

deploy_job "${CRAWLER_JOB}" "-m,app.worker,--once" "OLLAMA_ENRICH_MAX_PER_RUN=0"
deploy_job "${ENRICHER_JOB}" "scripts/enrich_jobs.py,--confirm,--limit,150" "OLLAMA_ENRICH_MAX_PER_RUN=150"

schedule "${CRAWLER_JOB}-every-20m" "${CRAWL_SCHEDULE}" "${CRAWLER_JOB}"
schedule "${ENRICHER_JOB}-hourly" "${ENRICH_SCHEDULE}" "${ENRICHER_JOB}"

say "Run one now (optional): gcloud run jobs execute ${CRAWLER_JOB} --region ${REGION} --wait"
