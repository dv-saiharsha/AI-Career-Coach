# Shared helpers for the infra scripts. Sourced, not run.
#
# Every script is a DRY RUN unless APPLY=1: it prints each command that would
# change something and runs only read-only checks. So a script can be read,
# then dry-run, then applied, and the dry run is the review.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
source "${HERE}/config.sh"

APPLY="${APPLY:-0}"

say() { printf '\n== %s\n' "$*"; }

# run CMD...: execute when APPLY=1, otherwise print it.
run() {
  if [[ "${APPLY}" == "1" ]]; then
    "$@"
  else
    local cmd=("$@")
    # Print the real command, not this file's gc shorthand.
    [[ "${cmd[0]}" == "gc" ]] && cmd=(gcloud --project "${PROJECT_ID}" "${cmd[@]:1}")
    printf 'DRY RUN:'; printf ' %q' "${cmd[@]}"; printf '\n'
  fi
}

# exists CMD...: a read-only describe; true if it succeeds.
exists() { "$@" >/dev/null 2>&1; }

banner() {
  if [[ "${APPLY}" == "1" ]]; then
    say "APPLYING to ${PROJECT_ID}"
  else
    say "DRY RUN for ${PROJECT_ID} (nothing changes; APPLY=1 to apply)"
  fi
}

gc() { gcloud --project "${PROJECT_ID}" --quiet "$@"; }
