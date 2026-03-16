#!/usr/bin/env bash
set -euo pipefail

# Repeats `orchestrate_once.sh` on a fixed interval for daemon-like local scheduling.
# Inputs: optional tasks root, interval in seconds, and iteration count (0 means infinite).
# Side effects: repeatedly invokes the single-cycle orchestrator against the same task root.
# Failure model: exits non-zero if the child script is missing or the loop parameters are invalid.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
ONCE_SCRIPT="$ROOT/agent-orchestrator/scripts/orchestrate_once.sh"
TASKS_ROOT="${1:-$ROOT/templates/coordination/tasks/task_folders}"
INTERVAL_SEC="${2:-10}"
ITERATIONS="${3:-0}"

if [[ ! -x "$ONCE_SCRIPT" ]]; then
  echo "orchestrate_once.sh not executable: $ONCE_SCRIPT"
  exit 1
fi

if ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]] || ! [[ "$ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 [tasks_root] [interval_seconds] [iterations:0=infinite]"
  exit 2
fi

count=0
while true; do
  # Delegate each tick to the single-cycle orchestrator so one code path owns
  # task selection and state transitions.
  "$ONCE_SCRIPT" "$TASKS_ROOT"
  count=$((count + 1))

  if [[ "$ITERATIONS" -gt 0 && "$count" -ge "$ITERATIONS" ]]; then
    break
  fi
  sleep "$INTERVAL_SEC"
done

echo "orchestrate loop finished iterations=$count"
