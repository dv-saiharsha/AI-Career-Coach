#!/usr/bin/env bash
# The models (tailoring, ATS feedback, JD analysis, enrichment) as a private
# Cloud Run service on one NVIDIA L4 GPU.
#
# COST: billed per second while an instance is up, GPU included; with
# --min-instances 0 it scales to zero when idle, so an idle app costs nothing
# here. The first request after idle waits for a cold start (container plus
# loading a model into GPU memory). Get the owner's OK on the current Cloud
# Run GPU price and the region's GPU quota before APPLY=1.
#
# Private: --no-allow-unauthenticated. Only the API and the jobs may call it
# (run.invoker below), with a Google identity token (OLLAMA_AUTH=google_id_token
# in the app, see backend/app/core/llm.py GoogleIdTokenAuth).
source "$(dirname "$0")/lib.sh"
banner

say "Service ${OLLAMA_SERVICE} in ${GPU_REGION}"
run gc run deploy "${OLLAMA_SERVICE}" \
  --image "${OLLAMA_IMAGE}:${OLLAMA_VERSION}" \
  --region "${GPU_REGION}" \
  --service-account "${SA_OLLAMA}" \
  --no-allow-unauthenticated \
  --port 8080 \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy \
  --cpu 8 --memory 32Gi --no-cpu-throttling \
  --min-instances 0 --max-instances 1 \
  --concurrency 4 \
  --timeout 600

say "Who may call it"
for sa in "${SA_API}" "${SA_JOBS}"; do
  run gc run services add-iam-policy-binding "${OLLAMA_SERVICE}" --region "${GPU_REGION}" \
    --member "serviceAccount:${sa}" --role roles/run.invoker --format=none
done

if [[ "${APPLY}" == "1" ]]; then
  url="$(gc run services describe "${OLLAMA_SERVICE}" --region "${GPU_REGION}" --format='value(status.url)')"
  say "OLLAMA_BASE_URL=${url}   (40_jobs.sh and 50_api.sh read it from the service)"
fi
