#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task_dir> <operation_request.json>"
  exit 2
fi

TASK_DIR="$1"
REQUEST_JSON="$2"

META="$TASK_DIR/meta.json"
AUDIT_MD="$TASK_DIR/audit.md"
APPROVAL_DIR="templates/coordination/audit/approvals"
TRANSITION_SCRIPT="agent-orchestrator/scripts/transition_task_state.sh"
APPEND_SCRIPT="agent-orchestrator/scripts/append_task_event.sh"
VALIDATE_APPROVAL_SCRIPT="agent-orchestrator/scripts/validate_approval.sh"
CREATE_APPROVAL_TICKET_SCRIPT="audit-guard/scripts/create_approval_ticket.sh"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi
if [[ ! -f "$REQUEST_JSON" ]]; then
  echo "request missing: $REQUEST_JSON"
  exit 1
fi
mkdir -p "$APPROVAL_DIR"

TASK_ID="$(jq -r '.id' "$META")"
CURRENT_STATE="$(jq -r '.state' "$META")"
RISK_LEVEL="$(jq -r '.risk_level' "$META")"
TOKEN_USED="$(jq -r '.consumption.token_cost_used // 0' "$META")"
TIME_USED="$(jq -r '.consumption.execution_time_used_seconds // 0' "$META")"
TOKEN_MAX="$(jq -r '.budget.max_token_cost' "$META")"
TIME_MAX="$(jq -r '.budget.max_execution_time_seconds' "$META")"

REQUEST_OP_ID="$(jq -r '.operation_id' "$REQUEST_JSON")"
REQUEST_ACTOR="$(jq -r '.actor // "unknown-actor"' "$REQUEST_JSON")"
REQUEST_SUMMARY="$(jq -r '.operation // "unspecified-operation"' "$REQUEST_JSON")"
DESTRUCTIVE="$(jq -r '.destructive // false' "$REQUEST_JSON")"
EXTERNAL_WRITE="$(jq -r '.external_write // false' "$REQUEST_JSON")"
OVERWRITE="$(jq -r '.overwrite // false' "$REQUEST_JSON")"
PERMISSION_ELEVATION="$(jq -r '.permission_elevation // false' "$REQUEST_JSON")"
TARGET_PATH="$(jq -r '.target_path // ""' "$REQUEST_JSON")"

token_pct=0
time_pct=0
if [[ "$TOKEN_MAX" -gt 0 ]]; then
  token_pct=$(( (TOKEN_USED * 100) / TOKEN_MAX ))
fi
if [[ "$TIME_MAX" -gt 0 ]]; then
  time_pct=$(( (TIME_USED * 100) / TIME_MAX ))
fi

triggers=()
risk_tier="MONITORED"
decision="ALLOW"

if [[ "$RISK_LEVEL" == "HIGH" || "$RISK_LEVEL" == "CRITICAL" ]]; then
  triggers+=("risk_level=$RISK_LEVEL")
  risk_tier="HIGH"
fi
if [[ "$token_pct" -ge 100 || "$time_pct" -ge 100 ]]; then
  triggers+=("budget_exhausted token=${token_pct}% time=${time_pct}%")
  risk_tier="HIGH"
fi
if [[ "$DESTRUCTIVE" == "true" ]]; then
  triggers+=("destructive_operation")
  risk_tier="CRITICAL"
fi
if [[ "$EXTERNAL_WRITE" == "true" ]]; then
  triggers+=("external_write")
  risk_tier="HIGH"
fi
if [[ "$OVERWRITE" == "true" ]]; then
  triggers+=("overwrite")
  risk_tier="HIGH"
fi
if [[ "$PERMISSION_ELEVATION" == "true" ]]; then
  triggers+=("permission_elevation")
  risk_tier="CRITICAL"
fi
if [[ "$TARGET_PATH" =~ ^/ ]]; then
  triggers+=("absolute_path_target")
fi

has_valid_approval=false
approval_scope=""
if [[ -f "$TASK_DIR/approval.json" ]]; then
  if "$VALIDATE_APPROVAL_SCRIPT" "$TASK_DIR" >/dev/null 2>&1; then
    has_valid_approval=true
    approval_scope="$(jq -r '.scope // ""' "$TASK_DIR/approval.json")"
  fi
fi

if [[ "${#triggers[@]}" -gt 0 ]]; then
  requires_high_risk_scope=false
  requires_budget_scope=false

  if [[ "$RISK_LEVEL" == "HIGH" || "$RISK_LEVEL" == "CRITICAL" ]]; then
    requires_high_risk_scope=true
  fi
  if [[ "$DESTRUCTIVE" == "true" || "$EXTERNAL_WRITE" == "true" || "$OVERWRITE" == "true" || "$PERMISSION_ELEVATION" == "true" ]]; then
    requires_high_risk_scope=true
  fi
  if [[ "$token_pct" -ge 100 || "$time_pct" -ge 100 ]]; then
    requires_budget_scope=true
  fi

  approved_for_high_risk=false
  approved_for_budget=false
  if [[ "$has_valid_approval" == true ]]; then
    if [[ "$approval_scope" == "high_risk_operation" || "$approval_scope" == "break_glass" ]]; then
      approved_for_high_risk=true
    fi
    if [[ "$approval_scope" == "over_budget_continue" || "$approval_scope" == "high_risk_operation" || "$approval_scope" == "break_glass" ]]; then
      approved_for_budget=true
    fi
  fi

  allowed=true
  if [[ "$requires_high_risk_scope" == true && "$approved_for_high_risk" != true ]]; then
    allowed=false
  fi
  if [[ "$requires_budget_scope" == true && "$approved_for_budget" != true ]]; then
    allowed=false
  fi

  if [[ "$allowed" == true ]]; then
    decision="MONITOR"
  else
    decision="BLOCK_PENDING_APPROVAL"
  fi
fi

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
approval_id=""
created_ticket=""

reason="gate_decision=$decision triggers=$(printf "%s," "${triggers[@]}" | sed 's/,$//')"

if [[ "$decision" == "BLOCK_PENDING_APPROVAL" ]]; then
  # Enforce block state first; this avoids a decision-recorded-but-not-blocked window.
  if ! "$TRANSITION_SCRIPT" "$TASK_DIR" "audit-guard" "${REQUEST_OP_ID}_block" "$CURRENT_STATE" "BLOCKED_PENDING_APPROVAL" "audit gate blocked: $(printf "%s," "${triggers[@]}" | sed 's/,$//')"; then
    echo "failed to block task during gate"
    exit 1
  fi
  approval_id="$("$CREATE_APPROVAL_TICKET_SCRIPT" "$TASK_DIR" "$REQUEST_ACTOR" "$risk_tier" "$REQUEST_SUMMARY" "$TARGET_PATH" "$(printf "%s," "${triggers[@]}" | sed 's/,$//')")"
  created_ticket="$APPROVAL_DIR/$approval_id.md"
fi

STATE_AFTER_GATE="$(jq -r '.state' "$META")"
if ! "$APPEND_SCRIPT" "$TASK_DIR" "audit-guard" "${REQUEST_OP_ID}_gate" "GATE_DECISION" "$reason" "$CURRENT_STATE" "$STATE_AFTER_GATE"; then
  # Compensate ticket if gate decision log failed after ticket creation.
  if [[ -n "$created_ticket" && -f "$created_ticket" ]]; then
    rm -f "$created_ticket"
  fi
  echo "failed to append gate decision event"
  exit 1
fi

{
  echo ""
  echo "## Gate Decision @ $timestamp"
  echo "- operation_id: $REQUEST_OP_ID"
  echo "- decision: $decision"
  echo "- risk_tier: $risk_tier"
  echo "- triggers: $(printf "%s," "${triggers[@]}" | sed 's/,$//')"
  if [[ -n "$approval_id" ]]; then
    echo "- approval_id: $approval_id"
  fi
} >> "$AUDIT_MD"

jq -cn \
  --arg task_id "$TASK_ID" \
  --arg operation_id "$REQUEST_OP_ID" \
  --arg decision "$decision" \
  --arg risk_tier "$risk_tier" \
  --arg approval_id "$approval_id" \
  --argjson triggers "$(printf '%s\n' "${triggers[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  '{
    task_id: $task_id,
    operation_id: $operation_id,
    decision: $decision,
    risk_tier: $risk_tier,
    approval_id: $approval_id,
    triggers: $triggers
  }'

if [[ "$decision" == "BLOCK_PENDING_APPROVAL" ]]; then
  exit 10
fi
