#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Consumes one observer bridge refinement packet and converts it into a planner-owned
# queued replan candidate without directly finalizing planner consume.
# Inputs: task directory.
# Side effects: validates observer packet, writes a planner handoff intake, records
# planner breadcrumbs, queues planner_replan/runtime_replan, and may pause the task.
# Failure model: exits non-zero on missing packet, invalid schema, ACL denial, or malformed metadata.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
TRANSITION_SCRIPT="$ROOT/agent-orchestrator/scripts/transition_task_state.sh"
ACL_SCRIPT="$ROOT/agent-orchestrator/scripts/enforce_role_acl.sh"
OBSERVER_CORE_INGRESS_CLI="$ROOT/extensions/orchestrator-dashboard/orchestrate-observer-core-ingress-cli.ts"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
if [[ "$TASK_DIR" != /* ]]; then
  TASK_DIR="$ROOT/$TASK_DIR"
fi
TASK_DIR="$(cd "$TASK_DIR" && pwd -P)"
TASKS_ROOT="$(cd "$TASK_DIR/.." && pwd -P)"
META="$TASK_DIR/meta.json"
PACKET="$TASK_DIR/observer_refinement_packet.json"
REQUEST="$TASK_DIR/scheduler_escalation_request.json"
INTAKE="$TASK_DIR/planner_observer_bridge_intake.json"

[[ -f "$META" ]] || { echo "meta missing: $META"; exit 1; }
[[ -f "$PACKET" ]] || { echo "observer bridge packet missing: $PACKET"; exit 1; }
TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing"; exit 1; }

acl_allow() {
  local role="$1"
  local action="$2"
  local target="$3"
  "$ACL_SCRIPT" --role "$role" --action "$action" --target "$target" --task-id "$TASK_ID" --tasks-root "$TASKS_ROOT" >/dev/null
}

acl_allow "observer-bridge" "read" "$PACKET"
acl_allow "observer-bridge" "write" "$INTAKE"

pnpm --dir "$ROOT/openclaw" exec node --import tsx "$OBSERVER_CORE_INGRESS_CLI" "$PACKET" "$INTAKE"

REQUEST_ID="$(jq -r '.request_id // ""' "$INTAKE")"
FINGERPRINT="$(jq -r '.bridge_fingerprint // ""' "$INTAKE")"
ESCALATION_REASON="$(jq -r '.escalation_reason // "observer_bridge_execution_exhaustion"' "$INTAKE")"
OBSERVED_AT="$(jq -r '.observed_at // empty' "$PACKET" 2>/dev/null || true)"
[[ -n "$REQUEST_ID" && -n "$FINGERPRINT" ]] || { echo "observer bridge intake missing request id/fingerprint"; exit 1; }

LAST_CONSUMED_REQUEST_ID="$(jq -r '.observer.bridge_last_consumed_request_id // ""' "$META" 2>/dev/null || true)"
LAST_CONSUMED_FINGERPRINT="$(jq -r '.observer.bridge_last_consumed_fingerprint // ""' "$META" 2>/dev/null || true)"
STATE="$(jq -r '.state // ""' "$META" 2>/dev/null || true)"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STAMP="$(date -u +"%Y%m%d%H%M%S")"

acl_allow "planner-core" "write" "$META"
if [[ -f "$TASK_DIR/plan.md" ]]; then
  acl_allow "planner-core" "write" "$TASK_DIR/plan.md"
fi
if [[ -f "$TASK_DIR/work.md" ]]; then
  acl_allow "planner-core" "write" "$TASK_DIR/work.md"
fi
acl_allow "planner-core" "write" "$TASK_DIR/clarification_request.md"
if [[ -f "$TASK_DIR/log.ndjson" ]]; then
  acl_allow "planner-core" "append" "$TASK_DIR/log.ndjson"
fi

if [[ "$LAST_CONSUMED_REQUEST_ID" == "$REQUEST_ID" && "$LAST_CONSUMED_FINGERPRINT" == "$FINGERPRINT" ]]; then
  if [[ -f "$TASK_DIR/work.md" ]]; then
    printf '\n- Latest action: planner skipped duplicate observer bridge packet at %s\n' "$NOW" >> "$TASK_DIR/work.md"
  fi
  if [[ -x "$APPEND_SCRIPT" ]]; then
    "$APPEND_SCRIPT" \
      "$TASK_DIR" \
      "planner-core" \
      "op_observer_bridge_skip_${TASK_ID}_$STAMP" \
      "PLANNER_REPLAN_OBSERVER_BRIDGE_SKIPPED_DUPLICATE" \
      "observer_bridge_duplicate_consume" >/dev/null 2>&1 || true
  fi
  echo "observer bridge packet already consumed: task_id=$TASK_ID"
  exit 0
fi

TMP_META="$(mktemp "$TASK_DIR/.meta.observer-bridge.XXXXXX.json")"
jq \
  --arg now "$NOW" \
  --arg request_id "$REQUEST_ID" \
  --arg fingerprint "$FINGERPRINT" \
  --arg observed_at "$OBSERVED_AT" \
  --arg escalation_reason "$ESCALATION_REASON" \
  '.planner_replan.status = "queued"
  | .planner_replan.requested_at = $now
  | .planner_replan.impact = "hard"
  | .planner_replan.worker_policy = "pause_and_require_replan"
  | .planner_replan.scope_summary = ["observer_bridge_execution_exhaustion"]
  | .runtime_replan.consume_status = "pending_consume"
  | .runtime_replan.blocked_reason = ""
  | .runtime_replan.last_runtime_actor = "planner-observer-bridge-consume"
  | .runtime_replan.last_runtime_transition = "observer_bridge->pending_consume"
  | .runtime_replan.source_planner_policy = "pause_and_require_replan"
  | .runtime_replan.source_planner_impact = "hard"
  | .observer = (.observer // {})
  | .observer.runtime_view_path = (.observer.runtime_view_path // "observer_view.json")
  | .observer.bridge_packet_path = "observer_refinement_packet.json"
  | .observer.bridge_last_observed_at = (if ($observed_at|length) > 0 then $observed_at else (.observer.bridge_last_observed_at // "") end)
  | .observer.bridge_last_fingerprint = $fingerprint
  | .observer.bridge_last_request_id = $request_id
  | .observer.bridge_last_consumed_at = $now
  | .observer.bridge_last_consumed_fingerprint = $fingerprint
  | .observer.bridge_last_consumed_request_id = $request_id
  | .scheduler = (.scheduler // {})
  | .scheduler.escalation_bridge = (.scheduler.escalation_bridge // {})
  | .scheduler.escalation_bridge.last_consumed_at = $now
  | .scheduler.escalation_bridge.last_consumed_fingerprint = $fingerprint
  | .scheduler.escalation_bridge.last_consumed_request_id = $request_id
  | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

if [[ -f "$TASK_DIR/plan.md" ]]; then
  printf '\n- Replan note (%s): observer bridge queued planner replan candidate (%s)\n' "$NOW" "$ESCALATION_REASON" >> "$TASK_DIR/plan.md"
fi
if [[ -f "$TASK_DIR/work.md" ]]; then
  printf '\n- Latest action: planner accepted observer bridge packet at %s (%s)\n' "$NOW" "$ESCALATION_REASON" >> "$TASK_DIR/work.md"
fi
cat > "$TASK_DIR/clarification_request.md" <<EOF
# Clarification Request

- Requested at: $NOW
- Source: observer.bridge
- Reason: $ESCALATION_REASON
- Action: planner replan queued with policy \`pause_and_require_replan\`
- Evidence:
  - \`observer_refinement_packet.json\`
  - \`scheduler_escalation_request.json\`
  - \`planner_observer_bridge_intake.json\`
EOF

if [[ -x "$APPEND_SCRIPT" ]]; then
  "$APPEND_SCRIPT" \
    "$TASK_DIR" \
    "planner-core" \
    "op_observer_bridge_${TASK_ID}_$STAMP" \
    "PLANNER_REPLAN_QUEUED_FROM_OBSERVER_BRIDGE" \
    "observer_bridge_execution_exhaustion" >/dev/null 2>&1 || true
fi

CURRENT_STATE="$(jq -r '.state // ""' "$META" 2>/dev/null || true)"
if [[ "$CURRENT_STATE" != "BLOCKED_AWAITING_CLARIFICATION" && "$CURRENT_STATE" != "CLOSED" ]]; then
  "$TRANSITION_SCRIPT" \
    "$TASK_DIR" \
    "worker-delivery" \
    "op_observer_bridge_block_${TASK_ID}_$STAMP" \
    "$CURRENT_STATE" \
    "BLOCKED_AWAITING_CLARIFICATION" \
    "observer bridge requires planner replan" >/dev/null 2>&1 || true
fi

echo "observer bridge packet queued planner replan: task_id=$TASK_ID"
