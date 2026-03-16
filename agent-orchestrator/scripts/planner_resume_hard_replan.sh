#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Resumes a hard-tier paused replan after planner-side clarification/rebuild is complete.
# Inputs: task directory.
# Side effects: marks the hard replan as resolved, records planner breadcrumbs,
# and transitions BLOCKED_AWAITING_CLARIFICATION back to IN_PROGRESS.
# Failure model: exits non-zero on missing task artifacts or invalid replan state.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
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

POLICY="$(jq -r '.planner_replan.worker_policy // ""' "$META")"
STATUS="$(jq -r '.runtime_replan.consume_status // ""' "$META")"
STATE="$(jq -r '.state // ""' "$META")"

[[ "$POLICY" == "pause_and_require_replan" ]] || {
  echo "task is not in hard replan policy: $TASK_ID"
  exit 1
}
[[ "$STATUS" == "paused" ]] || {
  echo "task is not paused for hard replan: $TASK_ID"
  exit 1
}
[[ "$STATE" == "BLOCKED_AWAITING_CLARIFICATION" ]] || {
  echo "task is not blocked awaiting clarification: $TASK_ID state=$STATE"
  exit 1
}

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d%H%M%S")"

cat > "$TASK_DIR/clarification_response.md" <<EOF
# Clarification Response

- Task: $TASK_ID
- Resolution: planner updated worker strategy after hard-tier amendment
- Timestamp: $NOW
EOF

if [[ -f "$TASK_DIR/plan.md" ]]; then
  printf '\n- Replan resume (%s): planner completed hard-tier replan and resumed execution\n' "$NOW" >> "$TASK_DIR/plan.md"
fi
if [[ -f "$TASK_DIR/work.md" ]]; then
  printf '\n- Latest action: planner resumed hard-tier replan flow at %s\n' "$NOW" >> "$TASK_DIR/work.md"
fi

TMP_META="$(mktemp "$TASK_DIR/.meta.resume.XXXXXX.json")"
jq \
  --arg now "$NOW" \
  '.planner_replan.status = "resolved"
  | .runtime_replan.consume_status = "ready"
  | .runtime_replan.resumed_at = $now
  | .runtime_replan.blocked_reason = ""
  | .runtime_replan.last_runtime_actor = "planner-resume-hard-replan"
  | .runtime_replan.last_runtime_transition = "paused->ready"
  | .workspace_last_synced_seq = (.workspace_user_change_seq // .workspace_last_synced_seq // 0)
  | .workspace_last_sync_reason = "receptionist_amendment_batch_resumed"
  | .dirty_state = false
  | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

"$TRANSITION_SCRIPT" \
  "$TASK_DIR" \
  "agent-orchestrator" \
  "op_replan_resume_${TASK_ID}_$STAMP" \
  "BLOCKED_AWAITING_CLARIFICATION" \
  "IN_PROGRESS" \
  "planner hard replan resolved" >/dev/null 2>&1

if [[ -x "$APPEND_SCRIPT" ]]; then
  "$APPEND_SCRIPT" \
    "$TASK_DIR" \
    "planner-core" \
    "op_replan_resolved_${TASK_ID}_$STAMP" \
    "PLANNER_REPLAN_RESUMED" \
    "planner_hard_replan_resolved" >/dev/null 2>&1 || true
fi

echo "planner hard replan resumed: task_id=$TASK_ID"
