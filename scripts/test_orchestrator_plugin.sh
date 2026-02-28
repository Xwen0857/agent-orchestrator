#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/extensions/orchestrator-dashboard"

cd "$PLUGIN_DIR"

pnpm install
pnpm run typecheck
pnpm run test

cat <<EOF
plugin-local validation complete.

host compatibility check remains:
  cd /path/to/openclaw
  pnpm exec tsc -p tsconfig.json --noEmit
EOF
