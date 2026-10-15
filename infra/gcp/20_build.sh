#!/usr/bin/env bash
# Builds the container images in Cloud Build (no local Docker needed) and
# pushes them to Artifact Registry. Building is not deploying: nothing runs
# until 30/40/50 use the images.
#
#   ./20_build.sh                 # dry run
#   APPLY=1 ./20_build.sh api     # the API/worker image (~5 min, cents)
#   APPLY=1 ./20_build.sh ollama  # the GPU model image (~30 min, ~15 GB stored)
source "$(dirname "$0")/lib.sh"
banner

ROOT="$(cd "${HERE}/../.." && pwd)"
what="${1:-api}"
tag="$(git -C "${ROOT}" rev-parse --short HEAD)"
if [[ -n "$(git -C "${ROOT}" status --porcelain -- backend)" ]]; then
  # An image tag must name exactly the code inside it.
  echo "backend/ has uncommitted changes; commit first so the tag ${tag} is true." >&2
  [[ "${APPLY}" == "1" ]] && exit 1
fi

case "${what}" in
  api)
    say "API/worker image ${API_IMAGE}:${tag}"
    run gc builds submit "${ROOT}/backend" --region "${REGION}" \
      --config "${HERE}/cloudbuild.api.yaml" \
      --substitutions "_IMAGE=${API_IMAGE},_TAG=${tag},_MODELS_BUCKET=${MODELS_BUCKET}"
    ;;
  ollama)
    say "Ollama image ${OLLAMA_IMAGE}:${OLLAMA_VERSION} with: ${OLLAMA_MODELS}"
    run gc builds submit "${HERE}/ollama" --region "${GPU_REGION}" \
      --config "${HERE}/ollama/cloudbuild.yaml" \
      --substitutions "_IMAGE=${OLLAMA_IMAGE},_OLLAMA_VERSION=${OLLAMA_VERSION},_MODEL_LIST=${OLLAMA_MODELS}"
    ;;
  *) echo "usage: $0 [api|ollama]" >&2; exit 2 ;;
esac
