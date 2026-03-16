#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Validates that a task's approval.json still matches the approval ticket and
# is currently usable.
# Inputs: task directory containing meta.json and approval.json.
# Side effects: none beyond reading approval artifacts.
# Failure model: exits non-zero on missing fields, expired approvals, or ticket mismatch.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
APPROVAL="$TASK_DIR/approval.json"
APPROVAL_DIR="templates/coordination/audit/approvals"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

if [[ ! -f "$APPROVAL" ]]; then
  echo "approval missing: $APPROVAL"
  exit 1
fi

TASK_ID="$(jq -r '.id' "$META")"
APPROVAL_TASK_ID="$(jq -r '.task_id // empty' "$APPROVAL")"
APPROVAL_ID="$(jq -r '.approval_id // empty' "$APPROVAL")"
APPROVED_BY="$(jq -r '.approved_by // empty' "$APPROVAL")"
APPROVED_AT="$(jq -r '.approved_at // empty' "$APPROVAL")"
SCOPE="$(jq -r '.scope // empty' "$APPROVAL")"
EXPIRES_AT="$(jq -r '.expires_at // empty' "$APPROVAL")"

if [[ -z "$APPROVAL_TASK_ID" || -z "$APPROVAL_ID" || -z "$APPROVED_BY" || -z "$APPROVED_AT" || -z "$SCOPE" || -z "$EXPIRES_AT" ]]; then
  echo "approval.json missing required fields"
  exit 1
fi

if [[ ! "$APPROVAL_ID" =~ ^APR-[0-9]{8}-[0-9]{6}(-[0-9]+)?$ ]]; then
  echo "approval id format invalid: $APPROVAL_ID"
  exit 1
fi

if [[ "$TASK_ID" != "$APPROVAL_TASK_ID" ]]; then
  echo "approval task mismatch: meta.id=$TASK_ID approval.task_id=$APPROVAL_TASK_ID"
  exit 1
fi

# Restrict approvals to the known operational scopes so stray tickets cannot be
# reused for unrelated actions.
case "$SCOPE" in
  over_budget_continue|high_risk_operation|break_glass) ;;
  *)
    echo "approval scope invalid: $SCOPE"
    exit 1
    ;;
esac

# Timestamp validation is delegated to Python for strict UTC parsing rather than
# relying on shell date portability.
if python3 - "$APPROVED_AT" "$EXPIRES_AT" <<'PY'
import sys
from datetime import datetime, timezone
approved_at = datetime.strptime(sys.argv[1], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
expires_at = datetime.strptime(sys.argv[2], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
now = datetime.now(timezone.utc)
if approved_at > now:
    sys.exit(2)
if expires_at <= now:
    sys.exit(3)
PY
then
  :
else
  rc=$?
  if [[ "$rc" -eq 2 ]]; then
    echo "approval approved_at is in the future: $APPROVAL_ID"
  elif [[ "$rc" -eq 3 ]]; then
    echo "approval expired: $APPROVAL_ID"
  else
    echo "approval timestamp invalid: $APPROVAL_ID"
  fi
  exit 1
fi

APPROVAL_MD="$APPROVAL_DIR/$APPROVAL_ID.md"
if [[ ! -f "$APPROVAL_MD" ]]; then
  echo "approval ticket not found: $APPROVAL_MD"
  exit 1
fi

APPROVAL_MD_TASK_ID="$(sed -n 's/^task_id:[[:space:]]*//p' "$APPROVAL_MD" | tail -n 1)"
APPROVAL_MD_SCOPE="$(sed -n 's/^scope:[[:space:]]*//p' "$APPROVAL_MD" | tail -n 1)"

if [[ -z "$APPROVAL_MD_TASK_ID" || "$APPROVAL_MD_TASK_ID" != "$TASK_ID" ]]; then
  echo "approval ticket task_id mismatch: ticket=$APPROVAL_MD_TASK_ID task=$TASK_ID"
  exit 1
fi

if [[ -n "$APPROVAL_MD_SCOPE" && "$APPROVAL_MD_SCOPE" != "$SCOPE" ]]; then
  echo "approval ticket scope mismatch: ticket=$APPROVAL_MD_SCOPE approval=$SCOPE"
  exit 1
fi

if ! grep -Eq "decision:[[:space:]]*APPROVED|status:[[:space:]]*APPROVED" "$APPROVAL_MD"; then
  echo "approval ticket not approved: $APPROVAL_MD"
  exit 1
fi

if grep -Eq "decision:[[:space:]]*DENIED|status:[[:space:]]*DENIED|decision:[[:space:]]*EXPIRED|status:[[:space:]]*EXPIRED" "$APPROVAL_MD"; then
  echo "approval ticket denied/expired: $APPROVAL_MD"
  exit 1
fi

echo "approval valid: $APPROVAL_ID"
