#!/usr/bin/env bash
set -euo pipefail

# Opens or refreshes a clarification request for a task and moves the task into
# the blocked-awaiting-clarification state when needed.
# Inputs: task dir, actor, operation id, question, and optional context.
# Side effects: rewrites clarification_request.md and may transition task state.
# Failure model: exits non-zero when task metadata is missing or state transition fails.

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <task_dir> <actor> <operation_id> <question> [context]"
  exit 2
fi

TASK_DIR="$1"
ACTOR="$2"
OPERATION_ID="$3"
QUESTION="$4"
CONTEXT="${5:-}"

META="$TASK_DIR/meta.json"
CLAR_FILE="$TASK_DIR/clarification_request.md"
TRANSITION_SCRIPT="agent-orchestrator/scripts/transition_task_state.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

CURRENT_STATE="$(jq -r '.state' "$META")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Rewrite the whole request file so the current open question is explicit and
# any stale response fields are cleared.
cat > "$CLAR_FILE" <<EOF
# Clarification Request

task_id: $(jq -r '.id' "$META")
status: OPEN
asked_by: $ACTOR
asked_at: $NOW
question: $QUESTION
context: $CONTEXT
response:
responded_by:
responded_at:
EOF

# Avoid logging a duplicate transition when the task is already in the blocked
# clarification state.
if [[ "$CURRENT_STATE" != "BLOCKED_AWAITING_CLARIFICATION" ]]; then
  "$TRANSITION_SCRIPT" "$TASK_DIR" "$ACTOR" "$OPERATION_ID" "$CURRENT_STATE" "BLOCKED_AWAITING_CLARIFICATION" "clarification requested: $QUESTION"
else
  echo "task already blocked awaiting clarification"
fi

echo "clarification requested: $CLAR_FILE"
