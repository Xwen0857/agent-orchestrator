#!/usr/bin/env bash
set -euo pipefail

# Runs orchestrator-dashboard validation lanes inside the plugin workspace.
# Inputs: lane selector (`planner-contract-lane`, `full-plugin-regression`, or `all`).
# Side effects: installs dependencies in the plugin package and runs type/tests.
# Failure model: exits non-zero when package install, typecheck, or selected lane fails.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/extensions/orchestrator-dashboard"

cd "$PLUGIN_DIR"

# Keep the local plugin package self-consistent before checking host integration.
pnpm install
pnpm run typecheck

LANE="${1:-all}"
case "$LANE" in
  planner-contract-lane)
    pnpm run test:planner-contract-lane
    ;;
  full-plugin-regression)
    pnpm run test:full-plugin-regression
    ;;
  all)
    pnpm run test:planner-contract-lane
    pnpm run test:full-plugin-regression
    ;;
  *)
    echo "unknown lane: $LANE"
    echo "usage: $0 [planner-contract-lane|full-plugin-regression|all]"
    exit 2
    ;;
esac

cat <<EOF
plugin-local validation complete.

host compatibility check remains:
  cd /path/to/openclaw
  pnpm exec tsc -p tsconfig.json --noEmit
EOF
