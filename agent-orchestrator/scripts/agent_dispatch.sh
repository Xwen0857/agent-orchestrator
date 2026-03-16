#!/usr/bin/env bash
set -euo pipefail

# Dispatches one specific task through the configured execution mode wrapper.
# Inputs: task id plus optional tasks root, mode, role, work-domain, and workspace overrides.
# Side effects: delegates to `orchestrate_once.sh` with one forced task selection.
# Failure model: exits non-zero on invalid args, missing dependencies, or invalid task roots.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
ONCE_SCRIPT="$ROOT/agent-orchestrator/scripts/orchestrate_once.sh"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"

MODE="local_threads"
TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"
TASK_ID=""
ROLE="agent-orchestrator"
WORK_DOMAIN_ID=""
WORKSPACE_ROOT=""

# Keep usage centralized so unsupported dispatch shapes fail consistently.
usage() {
  echo "usage: $0 --task-id <task_id> [--tasks-root <path>] [--mode local_threads|container|distributed] [--role <role>] [--work-domain-id <id>] [--workspace-root <path>]"
  exit 2
}

runtime_get_string() {
  local query="$1"
  local fallback="$2"
  if [[ -f "$RUNTIME_CONFIG" ]]; then
    local v
    v="$(jq -r "$query // empty" "$RUNTIME_CONFIG" 2>/dev/null || true)"
    if [[ -n "$v" && "$v" != "null" ]]; then
      printf '%s\n' "$v"
      return
    fi
  fi
  printf '%s\n' "$fallback"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id)
      [[ $# -ge 2 ]] || usage
      TASK_ID="$2"
      shift 2
      ;;
    --tasks-root)
      [[ $# -ge 2 ]] || usage
      TASKS_ROOT="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || usage
      MODE="$2"
      shift 2
      ;;
    --role)
      [[ $# -ge 2 ]] || usage
      ROLE="$2"
      shift 2
      ;;
    --work-domain-id)
      [[ $# -ge 2 ]] || usage
      WORK_DOMAIN_ID="$2"
      shift 2
      ;;
    --workspace-root)
      [[ $# -ge 2 ]] || usage
      WORKSPACE_ROOT="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_ID" ]] || usage
[[ -x "$ONCE_SCRIPT" ]] || { echo "orchestrate_once missing: $ONCE_SCRIPT"; exit 1; }

if [[ ! -d "$TASKS_ROOT" ]]; then
  echo "tasks root not found: $TASKS_ROOT"
  exit 1
fi
TASKS_ROOT="$(cd "$TASKS_ROOT" && pwd -P)"
TASK_DIR="$TASKS_ROOT/$TASK_ID"
RUNTIME_VIEW="$TASK_DIR/worker_runtime_view.json"

MODE="${MODE:-$(runtime_get_string '.mode' 'local_threads')}"

if [[ ! -f "$RUNTIME_VIEW" ]]; then
  echo "worker runtime view missing: $RUNTIME_VIEW"
  exit 1
fi
if [[ "$(jq -r '.schema_version // empty' "$RUNTIME_VIEW" 2>/dev/null || true)" != "worker-runtime-view-v1" ]]; then
  echo "invalid worker runtime view schema: $RUNTIME_VIEW"
  exit 1
fi

# Local mode delegates to the single-cycle orchestrator so task execution still
# flows through the same guardrails and transition logic.
run_local() {
  local args=("$TASKS_ROOT" "--task-id" "$TASK_ID" "--role" "$ROLE")
  if [[ -n "$WORK_DOMAIN_ID" ]]; then
    args+=("--work-domain-id" "$WORK_DOMAIN_ID")
  fi
  if [[ -n "$WORKSPACE_ROOT" ]]; then
    args+=("--workspace-root" "$WORKSPACE_ROOT")
  fi
  "$ONCE_SCRIPT" "${args[@]}"
}

case "$MODE" in
  local_threads)
    run_local
    ;;
  container|distributed)
    # These modes are reserved but intentionally fall back to local execution for now.
    echo "dispatch mode '$MODE' reserved for next phase; fallback to local_threads for now" >&2
    run_local
    ;;
  *)
    echo "unknown mode: $MODE"
    exit 2
    ;;
esac
