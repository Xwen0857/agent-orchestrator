#!/usr/bin/env bash
set -euo pipefail

# Decides whether workspace changes should trigger a planner sync and records
# the result.
# Inputs: task directory with workspace_change_report.json.
# Side effects: may rewrite task metadata, append a task event, append work log
# evidence, and update the planner checklist.
# Failure model: exits non-zero when task metadata is missing; otherwise reports JSON status.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
source "$ROOT/agent-orchestrator/scripts/planner_state_paths.sh"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta missing"; exit 1; }

TASK_ID="$(jq -r '.id // ""' "$META")"
RUN_ROOT="$(jq -r '.run_root // ""' "$META")"
REPORT="$RUN_ROOT/workspace_change_report.json"
CHECKLIST_TEMPLATE="$ROOT/templates/coordination/planner/checklist.example.md"
CHECKLIST="$(resolve_planner_checklist_path)"
[[ -f "$REPORT" ]] || { jq -cn '{status:"skipped",reason:"no_report"}'; exit 0; }

SENSITIVITY="$(jq -r '.sync.workspace_sync_sensitivity // "MEDIUM"' "$RUNTIME_CONFIG" 2>/dev/null || echo MEDIUM)"
CHANGED="$(jq -r '.changed_count // 0' "$REPORT")"
KEY_HITS="$(jq -r '.key_path_hits // 0' "$REPORT")"
SCORE="$(jq -r '.semantic_score // 0' "$REPORT")"
CHANGED_FILES_CSV="$(jq -r '(.changed_files // []) | map(tostring) | join(", ")' "$REPORT")"
if [[ -z "$CHANGED_FILES_CSV" ]]; then
  CHANGED_FILES_CSV="(none)"
fi

TRIGGER=false
REASON=""

# Sensitivity controls how aggressively workspace churn should invalidate the
# current plan.
case "$SENSITIVITY" in
  HIGH)
    if [[ "$KEY_HITS" -ge 1 || "$CHANGED" -ge 1 ]]; then TRIGGER=true; REASON="high_sensitivity"; fi
    ;;
  MEDIUM)
    if [[ "$CHANGED" -ge 5 || "$KEY_HITS" -ge 1 || "$(awk -v s="$SCORE" 'BEGIN{print (s>=0.6)?1:0}')" -eq 1 ]]; then
      TRIGGER=true; REASON="medium_threshold"
    fi
    ;;
  LOW)
    if [[ "$CHANGED" -ge 15 && "$KEY_HITS" -ge 1 ]] || [[ "$(awk -v s="$SCORE" 'BEGIN{print (s>=0.8)?1:0}')" -eq 1 ]]; then
      TRIGGER=true; REASON="low_threshold"
    fi
    ;;
  *)
    ;;
esac

if [[ "$TRIGGER" == true ]]; then
  NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  TMP_META="$(mktemp "$TASK_DIR/.meta.wssync.XXXXXX.json")"
  jq \
    --arg now "$NOW" \
    --arg reason "$REASON" \
    '.workspace_last_synced_seq = (.workspace_user_change_seq // 0)
    | .workspace_last_sync_reason = $reason
    | .dirty_state = false
    | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

  if [[ -x "$APPEND_SCRIPT" ]]; then
    "$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "op_ws_sync_${TASK_ID}_$(date -u +%Y%m%d%H%M%S)" "WORKSPACE_SYNC_TRIGGERED" "$REASON" >/dev/null 2>&1 || true
  fi

  if [[ -f "$TASK_DIR/work.md" ]]; then
    {
      echo "- Latest action: planner synced task due to workspace changes ($REASON)"
      echo "- Changed files: $CHANGED_FILES_CSV"
    } >> "$TASK_DIR/work.md"
  fi

  # Keep a visible checklist breadcrumb for planner operators, even when the
  # sync was triggered automatically.
  ensure_planner_checklist_file "$CHECKLIST" "$CHECKLIST_TEMPLATE"
  printf '| WS-SYNC-%s | workspace delta sync for %s | planner | UPDATED |  | reconcile run strategy with workspace increments | reason=%s changed=%s key_hits=%s score=%s |\n' \
    "$(date -u +%Y%m%d%H%M%S)" "$TASK_ID" "$REASON" "$CHANGED" "$KEY_HITS" "$SCORE" >> "$CHECKLIST"

  jq -cn \
    --arg status "triggered" \
    --arg reason "$REASON" \
    --arg sensitivity "$SENSITIVITY" \
    --arg changed_files "$CHANGED_FILES_CSV" \
    '{status:$status,reason:$reason,sensitivity:$sensitivity,changed_files:$changed_files}'
  exit 0
fi

jq -cn --arg status "no_trigger" --arg sensitivity "$SENSITIVITY" '{status:$status,sensitivity:$sensitivity}'
