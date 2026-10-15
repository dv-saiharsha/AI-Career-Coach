#!/usr/bin/env bash
# Foundation: image registry, service accounts, least-privilege grants, the
# composed DB_URL secret and the private models bucket. Idempotent: anything
# that already exists is left alone. Costs: storage pennies; nothing runs.
#
#   ./10_foundation.sh            # dry run: prints what it would do
#   APPLY=1 ./10_foundation.sh    # does it
source "$(dirname "$0")/lib.sh"
banner

say "Artifact Registry (${REGION} for the API, ${GPU_REGION} for the GPU image)"
for loc in "${REGION}" "${GPU_REGION}"; do
  if exists gc artifacts repositories describe "${REPO}" --location "${loc}"; then
    echo "  exists: ${REPO} (${loc})"
  else
    run gc artifacts repositories create "${REPO}" --location "${loc}" \
      --repository-format docker --description "HireLoom container images"
  fi
done

say "Service accounts"
create_sa() {  # email, display name
  if exists gc iam service-accounts describe "$1"; then
    echo "  exists: ${1%%@*}"
  else
    run gc iam service-accounts create "${1%%@*}" --display-name "$2"
  fi
}
create_sa "${SA_API}" "HireLoom API (Cloud Run)"
create_sa "${SA_JOBS}" "HireLoom crawler and enricher (Cloud Run Jobs)"
create_sa "${SA_SCHEDULER}" "HireLoom Cloud Scheduler: starts the jobs"
create_sa "${SA_OLLAMA}" "HireLoom Ollama GPU service (no grants)"

say "Project-level grants"
# Cloud SQL connections for both workloads that use the database.
for sa in "${SA_API}" "${SA_JOBS}"; do
  run gc projects add-iam-policy-binding "${PROJECT_ID}" --condition=None \
    --member "serviceAccount:${sa}" --role roles/cloudsql.client --format=none
done
# Account erasure (privacy.delete_user_data) and token checks: exactly
# firebaseauth.users.get + .delete, nothing broader (MIGRATION_RUNBOOK §1).
run gc projects add-iam-policy-binding "${PROJECT_ID}" --condition=None \
  --member "serviceAccount:${SA_API}" --role "${FIREBASE_ROLE}" --format=none

say "Avatars: signed upload URLs are signed by the API's own identity"
run gcloud storage buckets add-iam-policy-binding "gs://${AVATAR_BUCKET}" \
  --member "serviceAccount:${SA_API}" --role roles/storage.objectUser
run gc iam service-accounts add-iam-policy-binding "${SA_API}" \
  --member "serviceAccount:${SA_API}" --role roles/iam.serviceAccountTokenCreator --format=none

say "Models bucket (private) for the trained ATS model"
if exists gcloud storage buckets describe "gs://${MODELS_BUCKET}"; then
  echo "  exists: gs://${MODELS_BUCKET}"
else
  run gcloud storage buckets create "gs://${MODELS_BUCKET}" --project "${PROJECT_ID}" \
    --location "${REGION}" --uniform-bucket-level-access --public-access-prevention
fi
# Cloud Build's identity reads the model when it builds the API image.
PROJECT_NUMBER="$(gc projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
run gcloud storage buckets add-iam-policy-binding "gs://${MODELS_BUCKET}" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/storage.objectViewer

say "DB_URL secret (${DB_URL_SECRET}), composed from ${DB_PASSWORD_SECRET}"
# Cloud Run connects through the Unix socket the Cloud SQL connector mounts
# at /cloudsql/<connection name>. The password never touches the terminal or
# a file: it goes from one secret straight into the other.
if exists gc secrets describe "${DB_URL_SECRET}"; then
  echo "  exists: ${DB_URL_SECRET} (rotate by deleting its versions and re-running)"
else
  run gc secrets create "${DB_URL_SECRET}" --replication-policy automatic
  if [[ "${APPLY}" == "1" ]]; then
    gc secrets versions access latest --secret "${DB_PASSWORD_SECRET}" \
      | python3 -c 'import sys, urllib.parse; print("postgresql://%s:%s@/%s?host=/cloudsql/%s" % (sys.argv[1], urllib.parse.quote(sys.stdin.read().rstrip("\n"), safe=""), sys.argv[2], sys.argv[3]), end="")' \
          "${DB_USER}" "${DB_NAME}" "${SQL_CONNECTION}" \
      | gc secrets versions add "${DB_URL_SECRET}" --data-file=-
  else
    echo "DRY RUN: add a version to ${DB_URL_SECRET}: postgresql://${DB_USER}:***@/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION}"
  fi
fi
for sa in "${SA_API}" "${SA_JOBS}"; do
  run gc secrets add-iam-policy-binding "${DB_URL_SECRET}" \
    --member "serviceAccount:${sa}" --role roles/secretmanager.secretAccessor --format=none
done

say "Done. Next: ./00_preflight.sh to check, then ./20_build.sh"
