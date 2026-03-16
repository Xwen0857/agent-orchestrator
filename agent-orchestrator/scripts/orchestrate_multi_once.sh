#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Dispatches multiple eligible tasks in one orchestration tick using the configured
# execution mode and concurrency budget.
# Inputs: optional tasks root plus mode, max-parallel, and max-tasks overrides.
# Side effects: reads runtime config and planner properties, dispatches agent work,
# and refreshes dashboard state after the batch completes.
# Failure model: exits non-zero on invalid args, missing dependencies, or dispatch failures.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
DISPATCH_SCRIPT="$ROOT/agent-orchestrator/scripts/agent_dispatch.sh"
DASHBOARD_SCRIPT="$ROOT/agent-orchestrator/scripts/dashboard_summary.sh"
TRANSITION_SCRIPT="$ROOT/agent-orchestrator/scripts/transition_task_state.sh"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
PROPS="$ROOT/templates/coordination/planner/properties.md"

TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"
MODE=""
MAX_PARALLEL=""
MAX_TASKS=""
POLICY_MODE=""

# Keep usage centralized because multiple parsing branches fail closed through this helper.
usage() {
  echo "usage: $0 [tasks_root] [--mode <local_threads|container|distributed>] [--max-parallel <n>] [--max-tasks <n>]"
  exit 2
}

get_prop() {
  local key="$1"
  local fallback="$2"
  if [[ -f "$PROPS" ]]; then
    local line value
    line="$(awk -v k="$key" '$0 ~ "^- " k ":" { print; exit }' "$PROPS" 2>/dev/null || true)"
    if [[ -n "$line" ]]; then
      value="${line#- ${key}:}"
      value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return
      fi
    fi
  fi
  printf '%s\n' "$fallback"
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

as_pos_int() {
  local value="$1"
  local fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -gt 0 ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

as_float() {
  local value="$1"
  local fallback="$2"
  awk -v v="$value" -v fb="$fallback" 'BEGIN { if (v ~ /^-?[0-9]+(\.[0-9]+)?$/) print v; else print fb; }'
}

detect_logical_threads() {
  local detected=""
  if command -v sysctl >/dev/null 2>&1; then
    detected="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
  fi
  if [[ -z "$detected" ]] && command -v getconf >/dev/null 2>&1; then
    detected="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  if [[ -z "$detected" ]] && command -v nproc >/dev/null 2>&1; then
    detected="$(nproc 2>/dev/null || true)"
  fi
  as_pos_int "${detected:-}" 4
}

iso_age_minutes() {
  local ts="$1"
  python3 - "$ts" <<'PY'
import datetime, sys
raw = sys.argv[1].strip()
if not raw:
    print(-1)
    raise SystemExit
try:
    dt = datetime.datetime.fromisoformat(raw.replace('Z', '+00:00'))
except Exception:
    print(-1)
    raise SystemExit
now = datetime.datetime.now(datetime.timezone.utc)
mins = int((now - dt).total_seconds() // 60)
print(max(mins, 0))
PY
}

# Accept an optional positional tasks root before the named flags so old invocation
# patterns remain valid while newer callers can use explicit overrides.
if [[ $# -gt 0 ]]; then
  case "${1:-}" in
    --mode|--max-parallel|--max-tasks)
      ;;
    *)
      TASKS_ROOT="$1"
      shift
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || usage
      MODE="$2"
      shift 2
      ;;
    --max-parallel)
      [[ $# -ge 2 ]] || usage
      MAX_PARALLEL="$2"
      shift 2
      ;;
    --max-tasks)
      [[ $# -ge 2 ]] || usage
      MAX_TASKS="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

# Load runtime defaults only after CLI overrides are parsed so explicit caller intent
# wins over file-backed configuration.
MODE="${MODE:-$(runtime_get_string '.mode' 'local_threads')}"
POLICY_MODE="${POLICY_MODE:-$(runtime_get_string '.security.policy_mode' 'enforce')}"
DENIED_PATH_REL="$(runtime_get_string '.security.denied_events_path' 'templates/coordination/security/acl_denied.ndjson')"
DENIED_PATH="$ROOT/$DENIED_PATH_REL"
THREAD_RESERVE_RATIO="$(as_float "$(get_prop thread_reserve_ratio 0.25)" 0.25)"
SPLIT_OVERSUB_RATIO="$(as_float "$(get_prop split_max_oversubscription_ratio 1.5)" 1.5)"
STALE_IN_PROGRESS_MINUTES="$(as_pos_int "$(get_prop stale_in_progress_minutes 60)" 60)"

LOGICAL_THREADS="$(detect_logical_threads)"
RESERVED_THREADS="$(awk -v l="$LOGICAL_THREADS" -v r="$THREAD_RESERVE_RATIO" 'BEGIN {v=int((l*r)+0.999999); if (v<1) v=1; print v;}')"
EFFECTIVE_THREADS="$(( LOGICAL_THREADS - RESERVED_THREADS ))"
if [[ "$EFFECTIVE_THREADS" -lt 1 ]]; then
  EFFECTIVE_THREADS=1
fi

DEFAULT_MAX_TASKS="$(awk -v e="$EFFECTIVE_THREADS" -v r="$SPLIT_OVERSUB_RATIO" 'BEGIN {v=int((e*r)+0.999999); if (v<1) v=1; print v;}')"
REQUESTED_MAX_PARALLEL="$(as_pos_int "${MAX_PARALLEL:-$(runtime_get_string '.local_threads.max_parallel' "$EFFECTIVE_THREADS")}" "$EFFECTIVE_THREADS")"
REQUESTED_MAX_TASKS="$(as_pos_int "${MAX_TASKS:-$(runtime_get_string '.local_threads.max_tasks_per_tick' "$DEFAULT_MAX_TASKS")}" "$DEFAULT_MAX_TASKS")"

PARALLEL_LIMIT="$REQUESTED_MAX_PARALLEL"
THROTTLED=false
if [[ "$REQUESTED_MAX_PARALLEL" -gt "$EFFECTIVE_THREADS" ]]; then
  THROTTLED=true
  if [[ "$EFFECTIVE_THREADS" -gt 1 ]]; then
    PARALLEL_LIMIT="$(( EFFECTIVE_THREADS - 1 ))"
  else
    PARALLEL_LIMIT=1
  fi
fi
if [[ "$PARALLEL_LIMIT" -lt 1 ]]; then
  PARALLEL_LIMIT=1
fi

if [[ ! -d "$TASKS_ROOT" ]]; then
  echo "tasks root not found: $TASKS_ROOT"
  exit 1
fi
TASKS_ROOT="$(cd "$TASKS_ROOT" && pwd -P)"
if [[ ! -x "$DISPATCH_SCRIPT" ]]; then
  echo "dispatch script not executable: $DISPATCH_SCRIPT"
  exit 1
fi

# Rewrite the runtime snapshot through a temp file so local capacity calculations land
# atomically when this script adjusts concurrency settings.
if [[ -f "$RUNTIME_CONFIG" ]]; then
  tmp_runtime="$(mktemp "$TASKS_ROOT/.runtime.XXXXXX.json")"
  jq \
    --arg mode "$MODE" \
    --argjson logical "$LOGICAL_THREADS" \
    --argjson reserved "$RESERVED_THREADS" \
    --argjson effective "$EFFECTIVE_THREADS" \
    --argjson max_parallel "$PARALLEL_LIMIT" \
    --argjson max_tasks "$REQUESTED_MAX_TASKS" \
    '.mode = $mode | .host.logical_threads = $logical | .host.reserved_threads = $reserved | .host.effective_worker_threads = $effective | .local_threads.max_parallel = $max_parallel | .local_threads.max_tasks_per_tick = $max_tasks' \
    "$RUNTIME_CONFIG" > "$tmp_runtime" && mv "$tmp_runtime" "$RUNTIME_CONFIG"
fi

CANDIDATES=()
while IFS= read -r -d '' meta; do
  task_dir="${meta%/meta.json}"
  task_id="$(jq -r '.id // ""' "$meta" 2>/dev/null || true)"
  state="$(jq -r '.state // ""' "$meta" 2>/dev/null || true)"
  updated_at="$(jq -r '.updated_at // ""' "$meta" 2>/dev/null || true)"
  if [[ -z "$task_id" ]]; then
    continue
  fi

  if [[ "$state" == "IN_PROGRESS" ]]; then
    age_min="$(iso_age_minutes "$updated_at" 2>/dev/null || echo -1)"
    if [[ "$age_min" =~ ^[0-9]+$ ]] && [[ "$age_min" -ge "$STALE_IN_PROGRESS_MINUTES" ]]; then
      op_id="op_orchestrate_${task_id}_stale_block_$(date -u +%Y%m%d%H%M%S)_$$"
      "$TRANSITION_SCRIPT" "$task_dir" "agent-orchestrator" "$op_id" "IN_PROGRESS" "BLOCKED_SYSTEM_ERROR" "orchestrator: stale in_progress auto block" >/dev/null 2>&1 || true
      state="BLOCKED_SYSTEM_ERROR"
    fi
  fi

  case "$state" in
    CLOSED|BLOCKED_AWAITING_CLARIFICATION|BLOCKED_PENDING_APPROVAL)
      continue
      ;;
  esac
  CANDIDATES+=("$updated_at|$task_id")
done < <(find "$TASKS_ROOT" -mindepth 2 -maxdepth 2 -name meta.json -print0)

QUEUE_DEPTH="${#CANDIDATES[@]}"

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  ACL_DENIED_COUNT=0
  if [[ -f "$DENIED_PATH" ]]; then
    ACL_DENIED_COUNT="$(wc -l < "$DENIED_PATH" | tr -d '[:space:]')"
  fi
  "$DASHBOARD_SCRIPT" "$TASKS_ROOT" "$ROOT/templates/coordination/orchestrator/dashboard.md" "$ROOT/templates/coordination/orchestrator/dashboard.json" >/dev/null
  jq -cn \
    --arg status "ok" \
    --arg mode "$MODE" \
    --argjson processed 0 \
    --argjson advanced 0 \
    --argjson failed 0 \
    --argjson logical_threads "$LOGICAL_THREADS" \
    --argjson effective_worker_threads "$EFFECTIVE_THREADS" \
    --argjson parallel_limit "$PARALLEL_LIMIT" \
    --argjson queue_depth "$QUEUE_DEPTH" \
    --argjson throttled "$THROTTLED" \
    --arg policy_mode "$POLICY_MODE" \
    --argjson acl_denied_count "$ACL_DENIED_COUNT" \
    --arg sandbox_status "$(jq -r '.security.sandbox_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
    --arg commit_guard_status "$(jq -r '.security.commit_guard_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
    --arg kb_import_confirm_required "$(jq -r '.kb_import.confirm_required // true' "$RUNTIME_CONFIG" 2>/dev/null)" \
    --arg kb_import_auto_enabled "$(jq -r '.kb_import.auto_enabled // false' "$RUNTIME_CONFIG" 2>/dev/null)" \
    --arg workspace_sync_sensitivity "$(jq -r '.sync.workspace_sync_sensitivity // \"MEDIUM\"' "$RUNTIME_CONFIG" 2>/dev/null)" \
    '{status:$status,mode:$mode,processed:$processed,advanced:$advanced,failed:$failed,logical_threads:$logical_threads,effective_worker_threads:$effective_worker_threads,parallel_limit:$parallel_limit,queue_depth:$queue_depth,throttled:$throttled,policy_mode:$policy_mode,sandbox_status:$sandbox_status,commit_guard_status:$commit_guard_status,kb_import_confirm_required:$kb_import_confirm_required,kb_import_auto_enabled:$kb_import_auto_enabled,workspace_sync_sensitivity:$workspace_sync_sensitivity,acl_denied_count:$acl_denied_count}'
  exit 0
fi

IFS=$'\n' SORTED=( $(printf '%s\n' "${CANDIDATES[@]}" | sort) )
unset IFS

TASK_IDS=()
for row in "${SORTED[@]}"; do
  TASK_IDS+=("${row#*|}")
  if [[ ${#TASK_IDS[@]} -ge "$REQUESTED_MAX_TASKS" ]]; then
    break
  fi
done

PIDS=()
PID_TASKS=()
SUCCESS=0
FAILED=0
FAILURES=()

wait_first_job() {
  local pid="${PIDS[0]}"
  local task_id="${PID_TASKS[0]}"
  if wait "$pid"; then
    SUCCESS=$((SUCCESS + 1))
  else
    FAILED=$((FAILED + 1))
    FAILURES+=("$task_id: dispatch failed")
  fi
  PIDS=("${PIDS[@]:1}")
  PID_TASKS=("${PID_TASKS[@]:1}")
}

for task_id in "${TASK_IDS[@]}"; do
  "$DISPATCH_SCRIPT" --tasks-root "$TASKS_ROOT" --task-id "$task_id" --mode "$MODE" --role "scheduler-ops" >/dev/null 2>&1 &
  PIDS+=("$!")
  PID_TASKS+=("$task_id")
  while [[ ${#PIDS[@]} -ge "$PARALLEL_LIMIT" ]]; do
    wait_first_job
  done
done

while [[ ${#PIDS[@]} -gt 0 ]]; do
  wait_first_job
done

"$DASHBOARD_SCRIPT" "$TASKS_ROOT" "$ROOT/templates/coordination/orchestrator/dashboard.md" "$ROOT/templates/coordination/orchestrator/dashboard.json" >/dev/null
ACL_DENIED_COUNT=0
if [[ -f "$DENIED_PATH" ]]; then
  ACL_DENIED_COUNT="$(wc -l < "$DENIED_PATH" | tr -d '[:space:]')"
fi

if [[ $FAILED -gt 0 ]]; then
  jq -cn \
    --arg status "partial" \
    --arg mode "$MODE" \
    --argjson processed ${#TASK_IDS[@]} \
    --argjson advanced "$SUCCESS" \
    --argjson failed "$FAILED" \
    --argjson logical_threads "$LOGICAL_THREADS" \
    --argjson effective_worker_threads "$EFFECTIVE_THREADS" \
    --argjson parallel_limit "$PARALLEL_LIMIT" \
    --argjson queue_depth "$QUEUE_DEPTH" \
    --argjson throttled "$THROTTLED" \
    --arg policy_mode "$POLICY_MODE" \
    --argjson acl_denied_count "$ACL_DENIED_COUNT" \
    --arg sandbox_status "$(jq -r '.security.sandbox_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
    --arg commit_guard_status "$(jq -r '.security.commit_guard_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
    --arg kb_import_confirm_required "$(jq -r '.kb_import.confirm_required // true' "$RUNTIME_CONFIG" 2>/dev/null)" \
    --arg kb_import_auto_enabled "$(jq -r '.kb_import.auto_enabled // false' "$RUNTIME_CONFIG" 2>/dev/null)" \
    --arg workspace_sync_sensitivity "$(jq -r '.sync.workspace_sync_sensitivity // \"MEDIUM\"' "$RUNTIME_CONFIG" 2>/dev/null)" \
    --argjson failures "$(printf '%s\n' "${FAILURES[@]}" | jq -R . | jq -s .)" \
    '{status:$status,mode:$mode,processed:$processed,advanced:$advanced,failed:$failed,logical_threads:$logical_threads,effective_worker_threads:$effective_worker_threads,parallel_limit:$parallel_limit,queue_depth:$queue_depth,throttled:$throttled,policy_mode:$policy_mode,sandbox_status:$sandbox_status,commit_guard_status:$commit_guard_status,kb_import_confirm_required:$kb_import_confirm_required,kb_import_auto_enabled:$kb_import_auto_enabled,workspace_sync_sensitivity:$workspace_sync_sensitivity,acl_denied_count:$acl_denied_count,failures:$failures}'
  exit 1
fi

jq -cn \
  --arg status "ok" \
  --arg mode "$MODE" \
  --argjson processed ${#TASK_IDS[@]} \
  --argjson advanced "$SUCCESS" \
  --argjson failed 0 \
  --argjson logical_threads "$LOGICAL_THREADS" \
  --argjson effective_worker_threads "$EFFECTIVE_THREADS" \
  --argjson parallel_limit "$PARALLEL_LIMIT" \
  --argjson queue_depth "$QUEUE_DEPTH" \
  --argjson throttled "$THROTTLED" \
  --arg policy_mode "$POLICY_MODE" \
  --argjson acl_denied_count "$ACL_DENIED_COUNT" \
  --arg sandbox_status "$(jq -r '.security.sandbox_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
  --arg commit_guard_status "$(jq -r '.security.commit_guard_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null | sed 's/true/enabled/;s/false/disabled/')" \
  --arg kb_import_confirm_required "$(jq -r '.kb_import.confirm_required // true' "$RUNTIME_CONFIG" 2>/dev/null)" \
  --arg kb_import_auto_enabled "$(jq -r '.kb_import.auto_enabled // false' "$RUNTIME_CONFIG" 2>/dev/null)" \
  --arg workspace_sync_sensitivity "$(jq -r '.sync.workspace_sync_sensitivity // \"MEDIUM\"' "$RUNTIME_CONFIG" 2>/dev/null)" \
  '{status:$status,mode:$mode,processed:$processed,advanced:$advanced,failed:$failed,logical_threads:$logical_threads,effective_worker_threads:$effective_worker_threads,parallel_limit:$parallel_limit,queue_depth:$queue_depth,throttled:$throttled,policy_mode:$policy_mode,sandbox_status:$sandbox_status,commit_guard_status:$commit_guard_status,kb_import_confirm_required:$kb_import_confirm_required,kb_import_auto_enabled:$kb_import_auto_enabled,workspace_sync_sensitivity:$workspace_sync_sensitivity,acl_denied_count:$acl_denied_count}'
