#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASKS_ROOT="${1:-$ROOT/templates/coordination/tasks/task_folders}"
ARCHIVE_ROOT="${2:-$ROOT/templates/coordination/tasks/archive}"
RECORDER="$ROOT/agent-orchestrator/scripts/record_completed_task_context.sh"

if [[ ! -x "$RECORDER" ]]; then
  echo "record script not executable: $RECORDER"
  exit 1
fi

scanned=0
recorded=0
failed=0
scan_root() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  while IFS= read -r -d '' meta; do
    task_dir="${meta%/meta.json}"
    state="$(jq -r '.state // ""' "$meta" 2>/dev/null || true)"
    if [[ "$state" != "CLOSED" ]]; then
      continue
    fi
    scanned=$((scanned + 1))
    if "$RECORDER" "$task_dir" >/dev/null 2>&1; then
      recorded=$((recorded + 1))
    else
      failed=$((failed + 1))
    fi
  done < <(find "$root" -mindepth 2 -maxdepth 2 -name meta.json -print0)
}

scan_root "$TASKS_ROOT"
scan_root "$ARCHIVE_ROOT"

jq -cn \
  --arg status "ok" \
  --argjson scanned "$scanned" \
  --argjson recorded "$recorded" \
  --argjson failed "$failed" \
  '{status:$status,scanned:$scanned,recorded:$recorded,failed:$failed}'
