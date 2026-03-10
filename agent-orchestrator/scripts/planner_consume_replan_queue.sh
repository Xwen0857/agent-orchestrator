#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Consumes one queued planner replan request without re-running full planner split logic.
# Inputs: task directory.
# Side effects: records planner-facing replan breadcrumbs, marks the queued replan as applied,
# updates sync sequence markers, and appends a task event.
# Failure model: exits non-zero on missing task artifacts or malformed metadata.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
source "$ROOT/agent-orchestrator/scripts/planner_state_paths.sh"
source "$ROOT/agent-orchestrator/scripts/planner_strategy_summary.sh"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
TRANSITION_SCRIPT="$ROOT/agent-orchestrator/scripts/transition_task_state.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
if [[ "$TASK_DIR" != /* ]]; then
  TASK_DIR="$ROOT/$TASK_DIR"
fi
TASK_DIR="$(cd "$TASK_DIR" && pwd -P)"

META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta missing: $META"; exit 1; }
TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing"; exit 1; }
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
[[ -f "$STRATEGY" ]] || { echo "strategy missing: $STRATEGY"; exit 1; }

STATUS="$(jq -r '.planner_replan.status // ""' "$META")"
if [[ "$STATUS" != "queued" ]]; then
  echo "planner replan not queued: $TASK_ID"
  exit 0
fi
WORKER_POLICY="$(jq -r '.planner_replan.worker_policy // "continue"' "$META")"
IMPACT="$(jq -r '.planner_replan.impact // "soft"' "$META")"

load_planner_strategy_summary "$STRATEGY"
TITLE="$(jq -r '.title // .summary_input.task_goal // .goal // "untitled"' "$STRATEGY")"
PRIMARY_TEMPLATE_FILE="$ROOT/templates/coordination/planner/primary.example.md"
CHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/planner/checklist.example.md"
PRIMARY_FILE="$(resolve_planner_primary_path)"
CHECKLIST_FILE="$(resolve_planner_checklist_path)"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d%H%M%S")"
PRIMARY_ID="REPLAN_${TASK_ID#task_}_$STAMP"
CHECKLIST_ID="RCL_${TASK_ID#task_}_$STAMP"
BATCH_PATH="$(jq -r '.planner_replan.latest_amendment_batch_path // ""' "$META")"
REQUESTED_AT="$(jq -r '.planner_replan.requested_at // ""' "$META")"

ensure_runtime_file_from_template "$PRIMARY_FILE" "$PRIMARY_TEMPLATE_FILE"
ensure_planner_checklist_file "$CHECKLIST_FILE" "$CHECKLIST_TEMPLATE_FILE"

printf '| %s | %s | %s | %s | %s | P1 | UPDATED | YES |\n' \
  "$PRIMARY_ID" "$TITLE" "$PLANNER_GOAL" "replan-consume:$IMPACT" "planner input updated from receptionist amendment batch" >> "$PRIMARY_FILE"
printf '| %s | %s | planner-core | UPDATED |  | downstream worker must use amended structured inputs | task=%s batch=%s |\n' \
  "$CHECKLIST_ID" "$TITLE" "$TASK_ID" "${BATCH_PATH:-"(none)"}" >> "$CHECKLIST_FILE"

if [[ -f "$TASK_DIR/plan.md" ]]; then
  printf '\n- Replan note (%s): receptionist amendment batch absorbed into structured planner inputs (impact=%s policy=%s)\n' "$NOW" "$IMPACT" "$WORKER_POLICY" >> "$TASK_DIR/plan.md"
fi
if [[ -f "$TASK_DIR/work.md" ]]; then
  printf '\n- Latest action: planner consumed queued amendment batch at %s (policy=%s)\n' "$NOW" "$WORKER_POLICY" >> "$TASK_DIR/work.md"
fi

EXECUTION_STATUS="ready"
DIRTY_STATE="false"
SYNC_REASON="receptionist_amendment_batch"
if [[ "$WORKER_POLICY" == "revalidate_then_resume" ]]; then
  EXECUTION_STATUS="awaiting_revalidation"
  DIRTY_STATE="true"
  SYNC_REASON="receptionist_amendment_batch_pending_revalidation"
elif [[ "$WORKER_POLICY" == "pause_and_require_replan" ]]; then
  EXECUTION_STATUS="paused"
  DIRTY_STATE="true"
  SYNC_REASON="receptionist_amendment_batch_requires_replan"
  cat > "$TASK_DIR/clarification_request.md" <<EOF
# Clarification Request

- Task: $TASK_ID
- Issue: amended task goal requires planner-level replan before worker execution resumes
- Policy: $WORKER_POLICY
- Impact: $IMPACT
- Timestamp: $NOW
EOF
fi

TMP_META="$(mktemp "$TASK_DIR/.meta.replan.XXXXXX.json")"
jq \
  --arg now "$NOW" \
  --arg batch_path "$BATCH_PATH" \
  --arg execution_status "$EXECUTION_STATUS" \
  --arg sync_reason "$SYNC_REASON" \
  --arg requested_at "$REQUESTED_AT" \
  --arg worker_policy "$WORKER_POLICY" \
  --arg impact "$IMPACT" \
  --argjson dirty_state "$DIRTY_STATE" \
  '.planner_replan.status = "applied"
  | .planner_replan.applied_at = $now
  | .runtime_replan.consume_status = $execution_status
  | .runtime_replan.consumed_at = $now
  | .runtime_replan.blocked_reason = (if $execution_status == "paused" then "planner_pause_and_require_replan" else "" end)
  | .runtime_replan.last_runtime_actor = "planner-consume-replan-queue"
  | .runtime_replan.last_runtime_transition = ("pending_consume->" + $execution_status)
  | .runtime_replan.source_planner_requested_at = $requested_at
  | .runtime_replan.source_planner_policy = $worker_policy
  | .runtime_replan.source_planner_impact = $impact
  | if $execution_status == "ready" then
      .workspace_last_synced_seq = (.workspace_user_change_seq // .workspace_last_synced_seq // 0)
    else .
    end
  | .workspace_last_sync_reason = $sync_reason
  | .dirty_state = $dirty_state
  | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

if [[ "$WORKER_POLICY" == "pause_and_require_replan" && -x "$TRANSITION_SCRIPT" ]]; then
  CURRENT_STATE="$(jq -r '.state // ""' "$META" 2>/dev/null || true)"
  if [[ "$CURRENT_STATE" != "BLOCKED_AWAITING_CLARIFICATION" && "$CURRENT_STATE" != "CLOSED" ]]; then
    "$TRANSITION_SCRIPT" \
      "$TASK_DIR" \
      "worker-delivery" \
      "op_replan_block_${TASK_ID}_$STAMP" \
      "$CURRENT_STATE" \
      "BLOCKED_AWAITING_CLARIFICATION" \
      "planner replan pause requires clarification" >/dev/null 2>&1 || true
  fi
fi

if [[ -x "$APPEND_SCRIPT" ]]; then
  "$APPEND_SCRIPT" \
    "$TASK_DIR" \
    "planner-core" \
    "op_replan_${TASK_ID}_$STAMP" \
    "PLANNER_REPLAN_APPLIED" \
    "receptionist_amendment_batch_consumed" >/dev/null 2>&1 || true
fi

echo "planner replan applied: task_id=$TASK_ID"
