#!/usr/bin/env bash
set -euo pipefail

# Grants an approval ticket and writes the task-local approval record consumed by
# gate validation and state-unblock flows.
# Inputs: task dir, approval id, approver, scope, and optional duration in minutes.
# Side effects: writes `approval.json`, appends the approval decision to the ticket,
# and appends one approval-granted event to the task log.
# Failure model: exits non-zero on invalid args, missing ticket/task files, or failed event append.

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <task_dir> <approval_id> <approved_by> <scope> [duration_minutes]"
  exit 2
fi

TASK_DIR="$1"
APPROVAL_ID="$2"
APPROVED_BY="$3"
SCOPE="$4"
DURATION_MINUTES="${5:-120}"

META="$TASK_DIR/meta.json"
APPROVAL_MD="templates/coordination/audit/approvals/$APPROVAL_ID.md"
APPROVAL_JSON="$TASK_DIR/approval.json"
APPEND_SCRIPT="agent-orchestrator/scripts/append_task_event.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi
if [[ ! -f "$APPROVAL_MD" ]]; then
  echo "approval ticket missing: $APPROVAL_MD"
  exit 1
fi

TASK_ID="$(jq -r '.id' "$META")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
EXPIRES_AT="$(python3 - "$DURATION_MINUTES" <<'PY'
import sys
from datetime import datetime, timezone, timedelta
mins = int(sys.argv[1])
print((datetime.now(timezone.utc) + timedelta(minutes=mins)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)"

# `approval.json` is the machine-readable approval artifact that later gate checks
# use to decide whether blocked work may continue.
cat > "$APPROVAL_JSON" <<EOF
{
  "approval_id": "$APPROVAL_ID",
  "task_id": "$TASK_ID",
  "approved_by": "$APPROVED_BY",
  "approved_at": "$NOW",
  "scope": "$SCOPE",
  "expires_at": "$EXPIRES_AT",
  "notes": "granted by audit-guard"
}
EOF

{
  echo ""
  echo "decision: APPROVED"
  echo "decider: $APPROVED_BY"
  echo "decision_reason: approved via grant_approval.sh"
  echo "approved_at: $NOW"
  echo "scope: $SCOPE"
  echo "expires_at: $EXPIRES_AT"
} >> "$APPROVAL_MD"

"$APPEND_SCRIPT" "$TASK_DIR" "audit-guard" "op_grant_${APPROVAL_ID}" "APPROVAL_GRANTED" "approval_id=$APPROVAL_ID scope=$SCOPE"
echo "approval granted: $APPROVAL_ID -> $APPROVAL_JSON"
