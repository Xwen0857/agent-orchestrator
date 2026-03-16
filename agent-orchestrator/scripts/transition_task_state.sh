#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Performs one guarded task state transition with policy checks and audit logging.
# Inputs: task directory, actor, operation id, from-state, to-state, and reason text.
# Side effects: validates task artifacts, may create approval records, and rewrites
# task metadata and log state when the transition is allowed.
# Failure model: exits non-zero on invalid transitions, missing guards, or failed writes.

if [[ $# -lt 6 ]]; then
  echo "usage: $0 <task_dir> <actor> <operation_id> <from_state> <to_state> <reason>"
  exit 2
fi

TASK_DIR="$1"
ACTOR="$2"
OPERATION_ID="$3"
FROM_STATE="$4"
TO_STATE="$5"
REASON="$6"

META="$TASK_DIR/meta.json"
LOG="$TASK_DIR/log.ndjson"
LOCK="$TASK_DIR/.lock"
APPROVAL="$TASK_DIR/approval.json"
CREATE_APPROVAL_TICKET_SCRIPT="audit-guard/scripts/create_approval_ticket.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json not found: $META"
  exit 1
fi

if [[ ! -f "$LOG" ]]; then
  : > "$LOG"
fi

# Keep the transition allowlist explicit so invalid state jumps fail before any
# metadata mutation is attempted.
is_allowed_transition() {
  local from="$1"
  local to="$2"
  case "$from:$to" in
    CREATED:PLANNED) return 0 ;;
    PLANNED:ASSIGNED) return 0 ;;
    ASSIGNED:IN_PROGRESS) return 0 ;;
    IN_PROGRESS:TESTING) return 0 ;;
    TESTING:APPROVED) return 0 ;;
    TESTING:REJECTED) return 0 ;;
    APPROVED:CLOSED) return 0 ;;
    REJECTED:IN_PROGRESS) return 0 ;;
    BLOCKED_AWAITING_CLARIFICATION:IN_PROGRESS) return 0 ;;
    BLOCKED_PENDING_APPROVAL:IN_PROGRESS) return 0 ;;
    BLOCKED_PENDING_APPROVAL:REJECTED) return 0 ;;
    BLOCKED_SYSTEM_ERROR:ASSIGNED) return 0 ;;
    BLOCKED_SYSTEM_ERROR:REJECTED) return 0 ;;
    *:BLOCKED_AWAITING_CLARIFICATION) return 0 ;;
    *:BLOCKED_PENDING_APPROVAL) return 0 ;;
    *:BLOCKED_SYSTEM_ERROR) return 0 ;;
    *) return 1 ;;
  esac
}

required_actor_for_transition() {
  local from="$1"
  local to="$2"
  case "$from:$to" in
    CREATED:PLANNED) echo "planner-core" ;;
    PLANNED:ASSIGNED) echo "planner-core" ;;
    ASSIGNED:IN_PROGRESS) echo "scheduler-ops" ;;
    IN_PROGRESS:TESTING) echo "worker-delivery" ;;
    TESTING:APPROVED) echo "tester-ephemeral" ;;
    TESTING:REJECTED) echo "tester-ephemeral" ;;
    APPROVED:CLOSED) echo "agent-orchestrator" ;;
    REJECTED:IN_PROGRESS) echo "scheduler-ops" ;;
    BLOCKED_AWAITING_CLARIFICATION:IN_PROGRESS) echo "agent-orchestrator" ;;
    BLOCKED_PENDING_APPROVAL:IN_PROGRESS) echo "agent-orchestrator" ;;
    BLOCKED_PENDING_APPROVAL:REJECTED) echo "agent-orchestrator" ;;
    BLOCKED_SYSTEM_ERROR:ASSIGNED) echo "scheduler-ops" ;;
    BLOCKED_SYSTEM_ERROR:REJECTED) echo "scheduler-ops" ;;
    *:BLOCKED_AWAITING_CLARIFICATION) echo "worker-delivery" ;;
    *:BLOCKED_PENDING_APPROVAL) echo "audit-guard" ;;
    *:BLOCKED_SYSTEM_ERROR) echo "agent-orchestrator" ;;
    *) echo "" ;;
  esac
}

match_q() {
  local mode="$1"
  local pattern="$2"
  local file="$3"
  if command -v rg >/dev/null 2>&1; then
    if [[ "$mode" == "i" ]]; then
      rg -qi "$pattern" "$file"
    else
      rg -q "$pattern" "$file"
    fi
    return
  fi
  if [[ "$mode" == "i" ]]; then
    grep -Eiq "$pattern" "$file"
  else
    grep -Eq "$pattern" "$file"
  fi
}

stage_for_state() {
  local state="$1"
  case "$state" in
    CREATED) echo "INTAKE" ;;
    PLANNED) echo "PLANNING" ;;
    ASSIGNED) echo "DELIVERY" ;;
    IN_PROGRESS) echo "DELIVERY" ;;
    TESTING) echo "TEST" ;;
    APPROVED) echo "AUDIT" ;;
    REJECTED) echo "DELIVERY" ;;
    CLOSED) echo "COMPLETE" ;;
    *) echo "" ;;
  esac
}

require_file_for_transition() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    echo "guard failed: required file missing for transition ($label): $path"
    exit 1
  fi
}

enforce_transition_guards() {
  local from="$1"
  local to="$2"
  local actor="$3"
  local task_dir="$4"
  local reason="$5"

  local required_actor
  required_actor="$(required_actor_for_transition "$from" "$to")"
  COMPAT_USED=false
  COMPAT_NOTE=""
  if [[ -n "$required_actor" && "$actor" != "$required_actor" ]]; then
    # Compatibility shim: keep legacy planner-ops for one migration window.
    if [[ "$actor" == "planner-ops" && ( "$from:$to" == "CREATED:PLANNED" || "$from:$to" == "PLANNED:ASSIGNED" || "$from:$to" == "ASSIGNED:IN_PROGRESS" ) ]]; then
      COMPAT_USED=true
      COMPAT_NOTE="legacy planner-ops accepted for $from->$to"
      echo "guard compat: $COMPAT_NOTE reason=$reason"
    else
      echo "guard failed: actor mismatch for $from->$to expected=$required_actor actual=$actor"
      exit 1
    fi
  fi

  case "$from:$to" in
    CREATED:PLANNED)
      require_file_for_transition "$task_dir/plan.md" "plan.md"
      ;;
    PLANNED:ASSIGNED)
      require_file_for_transition "$task_dir/plan.md" "plan.md"
      if ! jq -e '.owner | type == "string" and length > 0' "$task_dir/meta.json" >/dev/null 2>&1; then
        echo "guard failed: owner missing in meta.json"
        exit 1
      fi
      if ! jq -e '.budget.max_token_cost > 0 and .budget.max_execution_time_seconds > 0' "$task_dir/meta.json" >/dev/null 2>&1; then
        echo "guard failed: budget fields missing in meta.json"
        exit 1
      fi
      ;;
    ASSIGNED:IN_PROGRESS)
      require_file_for_transition "$task_dir/work.md" "work.md"
      ;;
    IN_PROGRESS:TESTING)
      require_file_for_transition "$task_dir/work.md" "work.md"
      require_file_for_transition "$task_dir/test.md" "test.md"
      if ! match_q i "Changed files:[[:space:]]*(.+)" "$task_dir/work.md"; then
        echo "guard failed: changed files missing in work.md"
        exit 1
      fi
      if match_q i "Changed files:[[:space:]]*(pending implementation|none|n/a|待补充)" "$task_dir/work.md"; then
        echo "guard failed: changed files still placeholder in work.md"
        exit 1
      fi
      if ! match_q i "(\\.py|\\.js|\\.ts|\\.tsx|\\.jsx|\\.go|\\.rs|\\.java|\\.cpp|\\.c|\\.h|\\.md)" "$task_dir/work.md"; then
        echo "guard failed: no concrete changed file paths found in work.md"
        exit 1
      fi
      if ! match_q i "Commands:[[:space:]]*(.+)" "$task_dir/test.md"; then
        echo "guard failed: test commands missing in test.md"
        exit 1
      fi
      if match_q i "Commands:[[:space:]]*manual-smoke" "$task_dir/test.md"; then
        echo "guard failed: test commands still placeholder manual-smoke"
        exit 1
      fi
      ;;
    TESTING:APPROVED)
      require_file_for_transition "$task_dir/test.md" "test.md"
      require_file_for_transition "$task_dir/tester_result.json" "tester_result.json"
      if ! jq -e '.status == "PASS"' "$task_dir/tester_result.json" >/dev/null 2>&1; then
        echo "guard failed: tester_result.json status is not PASS"
        exit 1
      fi
      ;;
    TESTING:REJECTED)
      require_file_for_transition "$task_dir/test.md" "test.md"
      if ! match_q n "Result:[[:space:]]*FAIL|status:[[:space:]]*FAIL|FAIL" "$task_dir/test.md"; then
        echo "guard failed: tester FAIL evidence missing in test.md"
        exit 1
      fi
      ;;
    APPROVED:CLOSED)
      require_file_for_transition "$task_dir/audit.md" "audit.md"
      require_file_for_transition "$task_dir/plan.md" "plan.md"
      require_file_for_transition "$task_dir/work.md" "work.md"
      require_file_for_transition "$task_dir/test.md" "test.md"
      if jq -e '.children | type == "array" and length > 0' "$task_dir/meta.json" >/dev/null 2>&1; then
        local run_root staging_manifest aggregate_audit delivery_root
        run_root="$(jq -r '.run_root // ""' "$task_dir/meta.json")"
        if [[ -z "$run_root" || ! -d "$run_root" ]]; then
          echo "guard failed: parent run_root missing for aggregate close"
          exit 1
        fi
        staging_manifest="$run_root/delivery_staging_manifest.json"
        aggregate_audit="$task_dir/aggregate_audit.json"
        delivery_root="$run_root/delivery"
        require_file_for_transition "$staging_manifest" "delivery_staging_manifest.json"
        require_file_for_transition "$aggregate_audit" "aggregate_audit.json"
        if ! jq -e '.status == "PASS"' "$aggregate_audit" >/dev/null 2>&1; then
          echo "guard failed: aggregate_audit.json status is not PASS"
          exit 1
        fi
        if [[ ! -d "$delivery_root" ]]; then
          echo "guard failed: parent delivery not promoted"
          exit 1
        fi
        while IFS= read -r child_id; do
          [[ -n "$child_id" ]] || continue
          local child_meta
          child_meta="$(dirname "$task_dir")/$child_id/meta.json"
          if [[ ! -f "$child_meta" ]]; then
            echo "guard failed: child task meta missing for aggregate close: $child_id"
            exit 1
          fi
          local child_state
          child_state="$(jq -r '.state // ""' "$child_meta")"
          if [[ "$child_state" != "CLOSED" ]]; then
            echo "guard failed: child task not closed for aggregate close: $child_id state=$child_state"
            exit 1
          fi
        done < <(jq -r '.children[]? // empty' "$task_dir/meta.json")
      fi
      ;;
    REJECTED:IN_PROGRESS)
      require_file_for_transition "$task_dir/work.md" "work.md"
      if ! match_q i "retry|重试" "$task_dir/work.md"; then
        echo "guard failed: retry evidence missing in work.md"
        exit 1
      fi
      ;;
    *:BLOCKED_AWAITING_CLARIFICATION)
      require_file_for_transition "$task_dir/clarification_request.md" "clarification_request.md"
      ;;
    *:BLOCKED_PENDING_APPROVAL)
      require_file_for_transition "$task_dir/audit.md" "audit.md"
      ;;
    *:BLOCKED_SYSTEM_ERROR)
      require_file_for_transition "$task_dir/audit.md" "audit.md"
      ;;
    BLOCKED_AWAITING_CLARIFICATION:IN_PROGRESS)
      require_file_for_transition "$task_dir/clarification_request.md" "clarification_request.md"
      ;;
    BLOCKED_SYSTEM_ERROR:ASSIGNED)
      require_file_for_transition "$task_dir/audit.md" "audit.md"
      ;;
    BLOCKED_SYSTEM_ERROR:REJECTED)
      require_file_for_transition "$task_dir/audit.md" "audit.md"
      ;;
  esac
}

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

CURRENT_STATE="$(jq -r '.state' "$META")"
if [[ "$CURRENT_STATE" != "$FROM_STATE" ]]; then
  echo "state mismatch: expected=$FROM_STATE actual=$CURRENT_STATE"
  exit 1
fi

CURRENT_VERSION="$(jq -r '.version // 0' "$META")"
if [[ ! "$CURRENT_VERSION" =~ ^[0-9]+$ ]]; then
  CURRENT_VERSION=0
fi
NEW_VERSION=$((CURRENT_VERSION + 1))
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
APPROVAL_ID=""
EFFECTIVE_TO_STATE="$TO_STATE"
COMPAT_USED=false
COMPAT_NOTE=""

PLANNING_ACTOR_SET=""
SCHEDULING_ACTOR_SET=""
case "$FROM_STATE:$TO_STATE" in
  CREATED:PLANNED|PLANNED:ASSIGNED)
    PLANNING_ACTOR_SET="planner-core"
    ;;
  ASSIGNED:IN_PROGRESS|REJECTED:IN_PROGRESS|BLOCKED_SYSTEM_ERROR:ASSIGNED)
    SCHEDULING_ACTOR_SET="scheduler-ops"
    ;;
esac

read -r TOKEN_USED TIME_USED EXTERNAL_USED MAX_TOKEN MAX_TIME TASK_ID < <(
  jq -r '[.consumption.token_cost_used // 0, .consumption.execution_time_used_seconds // 0, .consumption.external_calls_used // 0, .budget.max_token_cost // 0, .budget.max_execution_time_seconds // 0, .id] | @tsv' "$META"
)

token_pct=0
time_pct=0
if [[ "$MAX_TOKEN" -gt 0 ]]; then
  token_pct=$(( (TOKEN_USED * 100) / MAX_TOKEN ))
fi
if [[ "$MAX_TIME" -gt 0 ]]; then
  time_pct=$(( (TIME_USED * 100) / MAX_TIME ))
fi

has_valid_approval=false
APPROVAL_SCOPE=""
AUTO_BUDGET_BLOCK=false
if [[ -f "$APPROVAL" ]]; then
  if "$(dirname "$0")/validate_approval.sh" "$TASK_DIR" >/dev/null 2>&1; then
    has_valid_approval=true
    APPROVAL_ID="$(jq -r '.approval_id' "$APPROVAL")"
    APPROVAL_SCOPE="$(jq -r '.scope // ""' "$APPROVAL")"
  fi
fi

if [[ $token_pct -ge 100 || $time_pct -ge 100 ]]; then
  budget_scope_ok=false
  if [[ "$APPROVAL_SCOPE" == "over_budget_continue" || "$APPROVAL_SCOPE" == "high_risk_operation" || "$APPROVAL_SCOPE" == "break_glass" ]]; then
    budget_scope_ok=true
  fi
  if [[ "$TO_STATE" != "BLOCKED_PENDING_APPROVAL" && ( "$has_valid_approval" != true || "$budget_scope_ok" != true ) ]]; then
    EFFECTIVE_TO_STATE="BLOCKED_PENDING_APPROVAL"
    AUTO_BUDGET_BLOCK=true
    REASON="${REASON}; auto budget block token=${token_pct}% time=${time_pct}%"
  fi
fi

if [[ "$FROM_STATE" == "BLOCKED_PENDING_APPROVAL" && "$TO_STATE" == "IN_PROGRESS" ]]; then
  if ! "$(dirname "$0")/validate_approval.sh" "$TASK_DIR" >/dev/null; then
    echo "approval validation failed for unblock transition"
    exit 1
  fi
  APPROVAL_ID="$(jq -r '.approval_id' "$APPROVAL")"
  APPROVAL_SCOPE="$(jq -r '.scope // ""' "$APPROVAL")"
  BLOCK_REASON="$(jq -r '.last_error // ""' "$META")"

  unblock_scope_ok=false
  if [[ "$BLOCK_REASON" == *"audit gate blocked"* ]]; then
    if [[ "$APPROVAL_SCOPE" == "high_risk_operation" || "$APPROVAL_SCOPE" == "break_glass" ]]; then
      unblock_scope_ok=true
    fi
  elif [[ "$BLOCK_REASON" == *"auto budget block"* ]]; then
    if [[ "$APPROVAL_SCOPE" == "over_budget_continue" || "$APPROVAL_SCOPE" == "high_risk_operation" || "$APPROVAL_SCOPE" == "break_glass" ]]; then
      unblock_scope_ok=true
    fi
  else
    if [[ "$APPROVAL_SCOPE" == "over_budget_continue" || "$APPROVAL_SCOPE" == "high_risk_operation" || "$APPROVAL_SCOPE" == "break_glass" ]]; then
      unblock_scope_ok=true
    fi
  fi

  if [[ "$unblock_scope_ok" != true ]]; then
    echo "approval scope invalid for unblock: scope=$APPROVAL_SCOPE block_reason=$BLOCK_REASON"
    exit 1
  fi
fi

if ! is_allowed_transition "$FROM_STATE" "$EFFECTIVE_TO_STATE"; then
  echo "illegal transition: $FROM_STATE -> $EFFECTIVE_TO_STATE"
  exit 1
fi

enforce_transition_guards "$FROM_STATE" "$EFFECTIVE_TO_STATE" "$ACTOR" "$TASK_DIR" "$REASON"

if [[ "$AUTO_BUDGET_BLOCK" == true && -z "$APPROVAL_ID" ]]; then
  APPROVAL_ID="$("$CREATE_APPROVAL_TICKET_SCRIPT" \
    "$TASK_DIR" \
    "$ACTOR" \
    "HIGH" \
    "auto_budget_block_transition" \
    "$TASK_ID" \
    "budget_exhausted token=${token_pct}% time=${time_pct}%")"
  REASON="${REASON}; approval_id=${APPROVAL_ID}"
fi

META_TMP="$(mktemp "$TASK_DIR/.meta.XXXXXX")"
jq \
  --arg state "$EFFECTIVE_TO_STATE" \
  --arg stage "$(stage_for_state "$EFFECTIVE_TO_STATE")" \
  --arg now "$NOW" \
  --arg actor "$ACTOR" \
  --arg reason "$REASON" \
  --arg planning_actor_set "$PLANNING_ACTOR_SET" \
  --arg scheduling_actor_set "$SCHEDULING_ACTOR_SET" \
  --argjson compat_used "$COMPAT_USED" \
  --argjson version "$NEW_VERSION" \
  '.state = $state
   | .stage = (if ($stage | length) > 0 then $stage else .stage end)
   | .updated_at = $now
   | .version = $version
   | .owner = $actor
   | .last_error = (if ($state | startswith("BLOCKED_")) then $reason else "" end)
   | .execution_roles = (.execution_roles // {})
   | .execution_roles.planning_actor = (if ($planning_actor_set | length) > 0 then $planning_actor_set else (.execution_roles.planning_actor // "planner-core") end)
   | .execution_roles.scheduling_actor = (if ($scheduling_actor_set | length) > 0 then $scheduling_actor_set else (.execution_roles.scheduling_actor // "scheduler-ops") end)
   | .execution_roles.compat_mode = ((.execution_roles.compat_mode // false) or $compat_used)
   | .execution_roles.compat_hits = ((.execution_roles.compat_hits // 0) + (if $compat_used then 1 else 0 end))
   | if $compat_used then .execution_roles.last_compat_at = $now else . end' \
  "$META" > "$META_TMP"

PREV_HASH="$(tail -n 1 "$LOG" 2>/dev/null | jq -r '.hash_self // empty' 2>/dev/null || true)"
EVENT_ID="evt_$(date -u +"%Y%m%d%H%M%S")_$$"
LOG_TMP="$(mktemp "$TASK_DIR/.log.XXXXXX")"
cp "$LOG" "$LOG_TMP"

EVENT_NO_HASH="$(jq -cn \
  --arg event_id "$EVENT_ID" \
  --arg timestamp "$NOW" \
  --arg task_id "$TASK_ID" \
  --arg operation_id "$OPERATION_ID" \
  --arg actor "$ACTOR" \
  --arg action "STATE_TRANSITION" \
  --arg before_state "$FROM_STATE" \
  --arg after_state "$EFFECTIVE_TO_STATE" \
  --arg approval_id "$APPROVAL_ID" \
  --arg reason "$REASON" \
  --arg hash_prev "$PREV_HASH" \
  --argjson before_version "$CURRENT_VERSION" \
  --argjson after_version "$NEW_VERSION" \
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
    before_version: $before_version,
    after_version: $after_version,
    budget_snapshot: {
      token_cost_used: $token_used,
      execution_time_used_seconds: $time_used,
      external_calls_used: $external_used
    },
    artifacts_delta: ["meta.json"],
    approval_id: $approval_id,
    reason: $reason,
    hash_prev: $hash_prev
  }'
)"

EVENT_HASH="$(printf "%s" "$EVENT_NO_HASH" | shasum -a 256 | awk '{print $1}')"
EVENT_LINE="$(printf "%s" "$EVENT_NO_HASH" | jq -c --arg hash "$EVENT_HASH" '. + { hash_self: $hash }')"
printf "%s\n" "$EVENT_LINE" >> "$LOG_TMP"

if [[ "$COMPAT_USED" == true ]]; then
  COMPAT_EVENT_ID="evt_compat_$(date -u +"%Y%m%d%H%M%S")_$$"
  PREV_HASH="$EVENT_HASH"
  COMPAT_NO_HASH="$(jq -cn \
    --arg event_id "$COMPAT_EVENT_ID" \
    --arg timestamp "$NOW" \
    --arg task_id "$TASK_ID" \
    --arg operation_id "${OPERATION_ID}_compat" \
    --arg actor "$ACTOR" \
    --arg action "ACTOR_COMPAT_USED" \
    --arg before_state "$FROM_STATE" \
    --arg after_state "$EFFECTIVE_TO_STATE" \
    --arg reason "$COMPAT_NOTE" \
    --arg hash_prev "$PREV_HASH" \
    --argjson before_version "$CURRENT_VERSION" \
    --argjson after_version "$NEW_VERSION" \
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
      before_version: $before_version,
      after_version: $after_version,
      budget_snapshot: {
        token_cost_used: $token_used,
        execution_time_used_seconds: $time_used,
        external_calls_used: $external_used
      },
      artifacts_delta: [],
      approval_id: "",
      reason: $reason,
      hash_prev: $hash_prev
    }'
  )"
  COMPAT_HASH="$(printf "%s" "$COMPAT_NO_HASH" | shasum -a 256 | awk '{print $1}')"
  COMPAT_LINE="$(printf "%s" "$COMPAT_NO_HASH" | jq -c --arg hash "$COMPAT_HASH" '. + { hash_self: $hash }')"
  printf "%s\n" "$COMPAT_LINE" >> "$LOG_TMP"
  EVENT_HASH="$COMPAT_HASH"
fi

token_pct=0
time_pct=0
if [[ "$MAX_TOKEN" -gt 0 ]]; then
  token_pct=$(( (TOKEN_USED * 100) / MAX_TOKEN ))
fi
if [[ "$MAX_TIME" -gt 0 ]]; then
  time_pct=$(( (TIME_USED * 100) / MAX_TIME ))
fi
if [[ $token_pct -ge 80 || $time_pct -ge 80 ]]; then
  WARN_ID="evt_warn_$(date -u +"%Y%m%d%H%M%S")_$$"
  PREV_HASH="$EVENT_HASH"
  WARN_NO_HASH="$(jq -cn \
    --arg event_id "$WARN_ID" \
    --arg timestamp "$NOW" \
    --arg task_id "$TASK_ID" \
    --arg operation_id "${OPERATION_ID}_warn" \
    --arg actor "$ACTOR" \
    --arg action "WARN_BUDGET" \
    --arg reason "budget usage token=${token_pct}% time=${time_pct}%" \
    --arg hash_prev "$PREV_HASH" \
    --argjson version "$NEW_VERSION" \
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
      before_state: "",
      after_state: "",
      before_version: $version,
      after_version: $version,
      budget_snapshot: {
        token_cost_used: $token_used,
        execution_time_used_seconds: $time_used,
        external_calls_used: $external_used
      },
      artifacts_delta: [],
      approval_id: "",
      reason: $reason,
      hash_prev: $hash_prev
    }'
  )"
  WARN_HASH="$(printf "%s" "$WARN_NO_HASH" | shasum -a 256 | awk '{print $1}')"
  WARN_LINE="$(printf "%s" "$WARN_NO_HASH" | jq -c --arg hash "$WARN_HASH" '. + { hash_self: $hash }')"
  printf "%s\n" "$WARN_LINE" >> "$LOG_TMP"
fi

LOG_BAK="$(mktemp "$TASK_DIR/.logbak.XXXXXX")"
cp "$LOG" "$LOG_BAK"
if ! mv "$LOG_TMP" "$LOG"; then
  echo "failed to write log atomically"
  rm -f "$LOG_BAK" "$META_TMP"
  exit 1
fi

if ! mv "$META_TMP" "$META"; then
  mv "$LOG_BAK" "$LOG" || true
  echo "failed to write meta atomically; rolled back log"
  exit 1
fi
rm -f "$LOG_BAK"

echo "transition complete: $TASK_ID $FROM_STATE -> $EFFECTIVE_TO_STATE (requested=$TO_STATE, v$CURRENT_VERSION -> v$NEW_VERSION)"
