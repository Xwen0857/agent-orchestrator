#!/usr/bin/env bash
set -euo pipefail

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

if [[ "$CURRENT_STATE" != "BLOCKED_AWAITING_CLARIFICATION" ]]; then
  "$TRANSITION_SCRIPT" "$TASK_DIR" "$ACTOR" "$OPERATION_ID" "$CURRENT_STATE" "BLOCKED_AWAITING_CLARIFICATION" "clarification requested: $QUESTION"
else
  echo "task already blocked awaiting clarification"
fi

echo "clarification requested: $CLAR_FILE"
