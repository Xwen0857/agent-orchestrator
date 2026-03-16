#!/usr/bin/env bash
set -euo pipefail

# Creates a pending approval ticket markdown file for a blocked operation.
# Inputs: task dir, requesting agent, risk tier, operation summary, impact scope, and matched rules.
# Side effects: writes one approval ticket under the audit approvals directory.
# Failure model: exits non-zero on invalid args or missing task metadata.

if [[ $# -lt 6 ]]; then
  echo "usage: $0 <task_dir> <requested_by_agent> <risk_tier> <operation_summary> <impact_scope> <matched_rules_csv>"
  exit 2
fi

TASK_DIR="$1"
REQUESTED_BY_AGENT="$2"
RISK_TIER="$3"
OP_SUMMARY="$4"
IMPACT_SCOPE="$5"
MATCHED_RULES="$6"

META="$TASK_DIR/meta.json"
APPROVAL_DIR="templates/coordination/audit/approvals"
mkdir -p "$APPROVAL_DIR"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

TASK_ID="$(jq -r '.id' "$META")"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
approval_id="APR-$(date -u +%Y%m%d-%H%M%S)-$$"
ticket="$APPROVAL_DIR/$approval_id.md"

# The ticket markdown is the operator-facing approval artifact referenced later by
# grant and validation flows.
cat > "$ticket" <<EOF
# Approval Request

approval_id: $approval_id
risk_level: $RISK_TIER
operation: $OP_SUMMARY
impact_scope: $IMPACT_SCOPE
rollback_plan: revert operation and restore last stable artifacts
status: PENDING
task_id: $TASK_ID
requested_by_agent: $REQUESTED_BY_AGENT
created_at: $timestamp
matched_rules: $MATCHED_RULES
EOF

echo "$approval_id"
