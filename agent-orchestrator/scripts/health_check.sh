#!/usr/bin/env bash
set -euo pipefail

# Summarizes task-folder health across locks, stale work, artifact presence, log integrity,
# and approval validity.
# Inputs: optional task root and stale threshold in seconds.
# Side effects: none beyond invoking validation helpers and printing one JSON report.
# Failure model: returns an empty healthy-style result when the root is missing; otherwise exits non-zero only on shell-level failures.

ROOT="${1:-templates/coordination/tasks/task_folders}"
NOW_EPOCH="$(date -u +%s)"
STALE_SEC="${2:-3600}"
VERIFY_LOG_CHAIN_SCRIPT="agent-orchestrator/scripts/verify_task_log_chain.sh"
VALIDATE_APPROVAL_SCRIPT="agent-orchestrator/scripts/validate_approval.sh"

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

orphan_locks=()
stale_in_progress=()
missing_artifacts=()
invalid_log_chain=()
blocked_without_valid_approval=()

if [[ ! -d "$ROOT" ]]; then
  echo "[]"
  exit 0
fi

# Evaluate each task independently so one malformed task still leaves a usable
# global health summary for the rest of the queue.
while IFS= read -r -d '' task_dir; do
  meta="$task_dir/meta.json"
  if [[ ! -f "$meta" ]]; then
    if [[ -f "$task_dir/.lock" ]]; then
      orphan_locks+=("$(basename "$task_dir")")
    fi
    continue
  fi

  task_id="$(jq -r '.id' "$meta")"
  state="$(jq -r '.state' "$meta")"
  updated_at="$(jq -r '.updated_at' "$meta")"
  updated_epoch="$(iso_to_epoch "$updated_at")"
  age=$((NOW_EPOCH - updated_epoch))

  if [[ "$state" == "IN_PROGRESS" && "$age" -gt "$STALE_SEC" ]]; then
    stale_in_progress+=("$task_id")
  fi

  for f in plan.md work.md test.md audit.md log.ndjson; do
    if [[ ! -f "$task_dir/$f" ]]; then
      missing_artifacts+=("$task_id:$f")
    fi
  done

  if ! "$VERIFY_LOG_CHAIN_SCRIPT" "$task_dir" >/dev/null 2>&1; then
    invalid_log_chain+=("$task_id")
  fi

  if [[ "$state" == "BLOCKED_PENDING_APPROVAL" ]]; then
    if ! "$VALIDATE_APPROVAL_SCRIPT" "$task_dir" >/dev/null 2>&1; then
      blocked_without_valid_approval+=("$task_id")
    fi
  fi
done < <(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name "task_*" -print0 | sort -z)

jq -cn \
  --arg checked_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --argjson orphan_locks "$(printf '%s\n' "${orphan_locks[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --argjson stale_in_progress "$(printf '%s\n' "${stale_in_progress[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --argjson missing_artifacts "$(printf '%s\n' "${missing_artifacts[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --argjson invalid_log_chain "$(printf '%s\n' "${invalid_log_chain[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --argjson blocked_without_valid_approval "$(printf '%s\n' "${blocked_without_valid_approval[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  '{
    checked_at: $checked_at,
    status: (if (($orphan_locks|length)+($stale_in_progress|length)+($missing_artifacts|length)+($invalid_log_chain|length)+($blocked_without_valid_approval|length)) == 0 then "HEALTHY" else "DEGRADED" end),
    orphan_locks: $orphan_locks,
    stale_in_progress: $stale_in_progress,
    missing_artifacts: $missing_artifacts,
    invalid_log_chain: $invalid_log_chain,
    blocked_without_valid_approval: $blocked_without_valid_approval
  }'
