#!/usr/bin/env bash
#
# Creates local env files from the committed templates.
#
# Never overwrites an existing file. A plain `cp` here would destroy a
# developer's real credentials the second time anyone ran it, so existing
# files are reported and skipped.
#
# Usage:  bash scripts/setup-env.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

created=0
skipped=0
missing=0

link() {
  local template="$1" target="$2"

  if [ ! -f "$template" ]; then
    printf '  !  %-28s template missing (%s)\n' "$target" "$template"
    missing=$((missing + 1))
    return
  fi

  if [ -f "$target" ]; then
    printf '  =  %-28s already exists, left untouched\n' "$target"
    skipped=$((skipped + 1))
    return
  fi

  cp "$template" "$target"
  printf '  +  %-28s created from %s\n' "$target" "$(basename "$template")"
  created=$((created + 1))
}

echo "Setting up local environment files..."
echo

# Next.js reads .env.local, so the frontend template is named to match.
link "frontend/.env.local.example" "frontend/.env.local"
link "backend/.env.example"        "backend/.env"

echo
echo "  created: $created   skipped: $skipped   missing templates: $missing"

if [ "$created" -gt 0 ]; then
  cat <<'EOF'

Next: open each new file and fill in the real values. Both are gitignored.

  backend/.env         DB_URL, ANTHROPIC_API_KEY, SUPABASE_URL,
                       SUPABASE_SECRET_API_KEY
  frontend/.env.local  NEXT_PUBLIC_SUPABASE_URL,
                       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Ask a teammate for shared dev credentials rather than creating a second
Supabase project — the database is shared, and a second project will not have
the schema.
EOF
fi

if [ "$missing" -gt 0 ]; then
  echo
  echo "A template was missing. Run this from a clean checkout of main." >&2
  exit 1
fi
