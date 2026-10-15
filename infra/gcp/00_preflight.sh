#!/usr/bin/env bash
# Read-only: checks that everything the other scripts assume is in place.
# Changes nothing, costs nothing. Run it first, and again after each step.
source "$(dirname "$0")/lib.sh"

ok() { printf '  ok    %s\n' "$*"; }
todo() { printf '  TODO  %s\n' "$*"; }

say "Account and project"
acct="$(gcloud config get-value account 2>/dev/null)"
[[ -n "${acct}" ]] && ok "signed in as ${acct}" || todo "gcloud auth login"
exists gc projects describe "${PROJECT_ID}" && ok "project ${PROJECT_ID}" || todo "no access to ${PROJECT_ID}"

say "APIs"
enabled="$(gc services list --enabled --format='value(config.name)')"
for api in run.googleapis.com sqladmin.googleapis.com cloudscheduler.googleapis.com \
           artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
           identitytoolkit.googleapis.com; do
  grep -qx "${api}" <<<"${enabled}" && ok "${api}" || todo "enable ${api}"
done

say "Database"
state="$(gc sql instances describe "${SQL_INSTANCE}" --format='value(state)' 2>/dev/null || true)"
[[ "${state}" == "RUNNABLE" ]] && ok "${SQL_INSTANCE} RUNNABLE" || todo "${SQL_INSTANCE} state: ${state:-missing}"
gc sql databases list --instance "${SQL_INSTANCE}" --format='value(name)' | grep -qx "${DB_NAME}" \
  && ok "database ${DB_NAME}" || todo "database ${DB_NAME} missing"

say "Secrets"
for s in "${DB_PASSWORD_SECRET}" "${DB_URL_SECRET}"; do
  exists gc secrets describe "${s}" && ok "secret ${s}" || todo "secret ${s} (10_foundation.sh creates ${DB_URL_SECRET})"
done

say "Registry and identities"
exists gc artifacts repositories describe "${REPO}" --location "${REGION}" && ok "registry ${REPO} (${REGION})" || todo "registry ${REPO} in ${REGION} (10_foundation.sh)"
exists gc artifacts repositories describe "${REPO}" --location "${GPU_REGION}" && ok "registry ${REPO} (${GPU_REGION})" || todo "registry ${REPO} in ${GPU_REGION} (10_foundation.sh)"
for sa in "${SA_API}" "${SA_JOBS}" "${SA_SCHEDULER}" "${SA_OLLAMA}"; do
  exists gc iam service-accounts describe "${sa}" && ok "${sa%%@*}" || todo "service account ${sa%%@*} (10_foundation.sh)"
done

say "Images"
for img in "${API_IMAGE}" "${OLLAMA_IMAGE}"; do
  exists gc artifacts docker images describe "${img}:latest" && ok "${img}:latest" || todo "${img}:latest (20_build.sh)"
done

say "ATS scoring model"
# The trained model is gitignored, so a build from the repo has none. The API
# image picks it up from this bucket path if present (cloudbuild.api.yaml).
if gcloud storage ls "gs://${MODELS_BUCKET}/ats_model.joblib" >/dev/null 2>&1; then
  ok "ats_model.joblib in the models bucket"
else
  todo "ats_model.joblib: not uploaded. Scores show 'Unavailable' until it is (see README)."
fi

say "GPU for Ollama (${GPU_REGION})"
echo "  Cloud Run L4 GPUs are available in a subset of regions and need quota"
echo "  ('Total Nvidia L4 GPU allocation without zonal redundancy, per project per region')."
echo "  Check: https://console.cloud.google.com/iam-admin/quotas?project=${PROJECT_ID}"
echo "  and the Cloud Run GPU region list before 30_ollama.sh."

say "Running services (read-only)"
gc run services list --format='table(metadata.name,region,status.url)' 2>/dev/null || true
gc run jobs list --format='table(metadata.name,region)' 2>/dev/null || true
gc scheduler jobs list --location "${REGION}" --format='table(name,schedule,state)' 2>/dev/null || true
