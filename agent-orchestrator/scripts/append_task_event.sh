#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 5 ]]; then
  echo "usage: $0 <task_dir> <actor> <operation_id> <action> <reason> [before_state] [after_state]"
  exit 2
fi

TASK_DIR="$1"
ACTOR="$2"
OPERATION_ID="$3"
ACTION="$4"
REASON="$5"
BEFORE_STATE="${6:-}"
AFTER_STATE="${7:-}"

META="$TASK_DIR/meta.json"
LOG="$TASK_DIR/log.ndjson"
LOCK="$TASK_DIR/.lock"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

if [[ ! -f "$LOG" ]]; then
  : > "$LOG"
fi

acquire_lock() {
  local i=0
  while ! (set -o noclobber; echo "$$" > "$LOCK") 2>/dev/null; do
    i=$((i + 1))
    if [[ $i -gt 50 ]]; then
      echo "failed to acquire lock: $LOCK"
      exit 1
    fi
    sleep 0.1
  done
}

release_lock() {
  rm -f "$LOCK"
}

trap release_lock EXIT
acquire_lock

if [[ -s "$LOG" ]] && jq -e --arg op "$OPERATION_ID" 'select(.operation_id == $op)' "$LOG" >/dev/null 2>&1; then
  echo "idempotent replay detected for operation_id=$OPERATION_ID; no-op"
  exit 0
fi

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TASK_ID="$(jq -r '.id' "$META")"
META_STATE="$(jq -r '.state' "$META")"
META_VERSION="$(jq -r '.version' "$META")"
read -r TOKEN_USED TIME_USED EXTERNAL_USED < <(
  jq -r '[.consumption.token_cost_used // 0, .consumption.execution_time_used_seconds // 0, .consumption.external_calls_used // 0] | @tsv' "$META"
)

PREV_HASH="$(tail -n 1 "$LOG" 2>/dev/null | jq -r '.hash_self // empty' 2>/dev/null || true)"
EVENT_ID="evt_$(date -u +"%Y%m%d%H%M%S")_$$"

if [[ -z "$BEFORE_STATE" ]]; then
  BEFORE_STATE="$META_STATE"
fi
if [[ -z "$AFTER_STATE" ]]; then
  AFTER_STATE="$META_STATE"
fi

EVENT_NO_HASH="$(jq -cn \
  --arg event_id "$EVENT_ID" \
  --arg timestamp "$NOW" \
  --arg task_id "$TASK_ID" \
  --arg operation_id "$OPERATION_ID" \
  --arg actor "$ACTOR" \
  --arg action "$ACTION" \
  --arg before_state "$BEFORE_STATE" \
  --arg after_state "$AFTER_STATE" \
  --arg approval_id "" \
  --arg reason "$REASON" \
  --arg hash_prev "$PREV_HASH" \
  --argjson version "$META_VERSION" \
  --argjson token_used "$TOKEN_USED" \
  --argjson time_used "$TIME_USED" \
  --argjson external_used "$EXTERNAL_USED" \
  '{
    event_id: $event_id,
    timestamp: $timestamp,
    task_id: $task_id,
    operation_id: $operation_id,
    actor: $actor,
    action: $action,
    before_state: $before_state,
    after_state: $after_state,
    before_version: $version,
    after_version: $version,
    budget_snapshot: {
      token_cost_used: $token_used,
      execution_time_used_seconds: $time_used,
      external_calls_used: $external_used
    },
    artifacts_delta: [],
    approval_id: $approval_id,
    reason: $reason,
    hash_prev: $hash_prev
  }'
)"

EVENT_HASH="$(printf "%s" "$EVENT_NO_HASH" | shasum -a 256 | awk '{print $1}')"
EVENT_LINE="$(printf "%s" "$EVENT_NO_HASH" | jq -c --arg hash "$EVENT_HASH" '. + { hash_self: $hash }')"
printf "%s\n" "$EVENT_LINE" >> "$LOG"

echo "event appended: $TASK_ID action=$ACTION op=$OPERATION_ID"
