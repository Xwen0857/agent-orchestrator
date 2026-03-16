#!/usr/bin/env bash
set -euo pipefail

# Resolves a task clarification request and optionally resumes work.
# Inputs: task dir, responder, operation id, and response text.
# Side effects: updates clarification_request.md and may transition the task
# back to IN_PROGRESS.
# Failure model: exits non-zero when required task artifacts are missing.

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <task_dir> <responder> <operation_id> <response>"
  exit 2
fi

TASK_DIR="$1"
RESPONDER="$2"
OPERATION_ID="$3"
RESPONSE="$4"

META="$TASK_DIR/meta.json"
CLAR_FILE="$TASK_DIR/clarification_request.md"
TRANSITION_SCRIPT="agent-orchestrator/scripts/transition_task_state.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi
if [[ ! -f "$CLAR_FILE" ]]; then
  echo "clarification file missing: $CLAR_FILE"
  exit 1
fi

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CURRENT_STATE="$(jq -r '.state' "$META")"

# Rewrite only the resolution fields so the original question context remains
# intact for later audit.
awk -v responder="$RESPONDER" -v response="$RESPONSE" -v now="$NOW" '
  /^status:/ { print "status: RESOLVED"; next }
  /^response:/ { print "response: " response; next }
  /^responded_by:/ { print "responded_by: " responder; next }
  /^responded_at:/ { print "responded_at: " now; next }
  { print }
' "$CLAR_FILE" > "$CLAR_FILE.tmp"
mv "$CLAR_FILE.tmp" "$CLAR_FILE"

# Only auto-resume tasks that are still blocked for clarification; otherwise
# keep the response on record and let orchestration decide the next step.
if [[ "$CURRENT_STATE" == "BLOCKED_AWAITING_CLARIFICATION" ]]; then
  "$TRANSITION_SCRIPT" "$TASK_DIR" "agent-orchestrator" "$OPERATION_ID" "BLOCKED_AWAITING_CLARIFICATION" "IN_PROGRESS" "clarification resolved by $RESPONDER"
else
  echo "task state is $CURRENT_STATE, skip auto-resume"
fi

echo "clarification resolved: $CLAR_FILE"
