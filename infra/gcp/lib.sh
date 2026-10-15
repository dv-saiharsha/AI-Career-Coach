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

# need_components alpha beta: stop with an instruction rather than let
# --quiet silently install gcloud components on someone's machine.
need_components() {
  local missing=()
  for c in "$@"; do
    gcloud components list --only-local-state --filter="id=${c}" --format='value(id)' 2>/dev/null | grep -qx "${c}" || missing+=("${c}")
  done
  if (( ${#missing[@]} )); then
    echo "This script needs gcloud components: ${missing[*]}. Install with: gcloud components install ${missing[*]}" >&2
    exit 1
  fi
}

# names CMD...: only the lines that are resource names (projects/...), so
# progress or installer text can never be mistaken for a match.
names() { "$@" 2>/dev/null | grep '^projects/' || true; }
