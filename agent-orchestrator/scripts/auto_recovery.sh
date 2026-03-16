#!/usr/bin/env bash
set -euo pipefail

# Releases stale locks and re-blocks stale in-progress tasks so the orchestrator can
# recover from abandoned work without manual cleanup.
# Inputs: optional task root, stale lock seconds, and stale in-progress seconds.
# Side effects: removes stale lock files, invokes guarded state transitions, and refreshes
# dashboard and system-health summaries after recovery.
# Failure model: exits non-zero if the task root is missing; individual cleanup actions are best-effort where noted.

ROOT="${1:-templates/coordination/tasks/task_folders}"
LOCK_STALE_SECONDS="${2:-900}"
INPROGRESS_STALE_SECONDS="${3:-3600}"
TRANSITION_SCRIPT="$(dirname "$0")/transition_task_state.sh"
DASHBOARD_SCRIPT="$(dirname "$0")/dashboard_summary.sh"
SYSTEM_HEALTH_SCRIPT="$(dirname "$0")/system_health_check.sh"
CONFIG="templates/coordination/planner/config/current.md"
PROPS="templates/coordination/planner/properties.md"
KEEPER_PID_FILE="templates/coordination/orchestrator/.keeper-scheduler.pid"
KEEPER_LOCK_FILE="templates/coordination/orchestrator/.keeper-scheduler.lock"

iso_to_epoch() {
  local ts="$1"
  local parsed
  parsed="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null || true)"
  if [[ -n "$parsed" ]]; then
    echo "$parsed"
    return 0
  fi
  parsed="$(date -u -d "$ts" "+%s" 2>/dev/null || true)"
  if [[ -n "$parsed" ]]; then
    echo "$parsed"
    return 0
  fi
  date -u +%s
}

if [[ ! -d "$ROOT" ]]; then
  echo "root not found: $ROOT"
  exit 1
fi

# Iterate each task folder independently so one malformed task does not block recovery
# for the rest of the queue.
now_epoch="$(date -u +%s)"
recover_unlock=0
recover_block=0
recover_keeper_unlock=0

keeper_cycle_minutes="$(sed -n 's/^- keeper_cycle_minutes:[[:space:]]*//p' "$PROPS" | tail -n 1 | tr -d '\r')"
if [[ -z "$keeper_cycle_minutes" ]]; then
  keeper_cycle_minutes=60
fi
keeper_lock_stale_seconds=$((keeper_cycle_minutes * 120))

while IFS= read -r -d '' task_dir; do
  meta="$task_dir/meta.json"
  [[ -f "$meta" ]] || continue

  task_id="$(jq -r '.id' "$meta")"
  state="$(jq -r '.state' "$meta")"
  updated_at="$(jq -r '.updated_at' "$meta")"
  updated_epoch="$(iso_to_epoch "$updated_at")"

  if [[ -f "$task_dir/.lock" ]]; then
    lock_mtime="$(stat -f "%m" "$task_dir/.lock" 2>/dev/null || stat -c "%Y" "$task_dir/.lock" 2>/dev/null || echo "$now_epoch")"
    lock_age=$((now_epoch - lock_mtime))
    if [[ "$lock_age" -gt "$LOCK_STALE_SECONDS" ]]; then
      # Stale lock removal is destructive, so only do it after an age check against the threshold.
      rm -f "$task_dir/.lock"
      recover_unlock=$((recover_unlock + 1))
      echo "released stale lock: $task_id age=${lock_age}s"
    fi
  fi

  if [[ "$state" == "IN_PROGRESS" ]]; then
    age=$((now_epoch - updated_epoch))
    if [[ "$age" -gt "$INPROGRESS_STALE_SECONDS" ]]; then
      op_id="op_auto_recover_${task_id}_$(date -u +%Y%m%d%H%M%S)"
      "$TRANSITION_SCRIPT" "$task_dir" "agent-orchestrator" "$op_id" "IN_PROGRESS" "BLOCKED_SYSTEM_ERROR" "stale in_progress auto-recovery age=${age}s"
      recover_block=$((recover_block + 1))
    fi
  fi
done < <(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name "task_*" -print0 | sort -z)

# Refresh health outputs at the end so operators see post-recovery state even when
# individual cleanup steps had to degrade gracefully.
keeper_enabled="$(sed -n 's/^keeper_enabled:[[:space:]]*//p' "$CONFIG" | tail -n 1 | tr -d '\r')"
if [[ "$keeper_enabled" == "true" && -f "$KEEPER_LOCK_FILE" ]]; then
  keeper_pid=""
  if [[ -f "$KEEPER_PID_FILE" ]]; then
    keeper_pid="$(cat "$KEEPER_PID_FILE" 2>/dev/null || true)"
  fi
  keeper_running=false
  if [[ -n "$keeper_pid" ]] && kill -0 "$keeper_pid" 2>/dev/null; then
    keeper_running=true
  fi
  lock_mtime="$(stat -f "%m" "$KEEPER_LOCK_FILE" 2>/dev/null || stat -c "%Y" "$KEEPER_LOCK_FILE" 2>/dev/null || echo "$now_epoch")"
  lock_age=$((now_epoch - lock_mtime))
  if [[ "$keeper_running" != "true" && "$lock_age" -gt "$keeper_lock_stale_seconds" ]]; then
    rm -f "$KEEPER_LOCK_FILE"
    recover_keeper_unlock=$((recover_keeper_unlock + 1))
    echo "released stale keeper scheduler lock age=${lock_age}s"
  fi
fi

"$DASHBOARD_SCRIPT" "$ROOT" >/dev/null || true
"$SYSTEM_HEALTH_SCRIPT" "$ROOT" >/dev/null || true

echo "auto recovery summary: unlocked=$recover_unlock blocked=$recover_block keeper_unlocked=$recover_keeper_unlock"
