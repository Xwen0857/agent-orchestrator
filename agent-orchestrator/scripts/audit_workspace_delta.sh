#!/usr/bin/env bash
set -euo pipefail

# Records a summary of workspace delta information into the task audit trail.
# Inputs: task directory.
# Side effects: appends an audit section to `audit.md`, updates the workspace snapshot file,
# and optionally appends one audit event to the task log.
# Failure model: exits non-zero on missing required task artifacts; degrades to "skipped" JSON when workspace context is absent.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
AUDIT_MD="$TASK_DIR/audit.md"
SNAPSHOT="$TASK_DIR/.audit_workspace_snapshot.json"
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"

[[ -f "$META" ]] || { echo "meta missing"; exit 1; }
[[ -f "$AUDIT_MD" ]] || { echo "audit.md missing"; exit 1; }

TASK_ID="$(jq -r '.id // ""' "$META")"
RUN_ROOT="$(jq -r '.run_root // ""' "$META")"
[[ -n "$RUN_ROOT" ]] || { jq -cn '{status:"skipped",reason:"no_run_root"}'; exit 0; }
[[ -d "$RUN_ROOT" ]] || { jq -cn '{status:"skipped",reason:"run_root_missing"}'; exit 0; }

MANIFEST="$RUN_ROOT/manifest.lock.json"
REPORT="$RUN_ROOT/workspace_change_report.json"
[[ -f "$MANIFEST" ]] || { jq -cn '{status:"skipped",reason:"no_manifest"}'; exit 0; }

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CUR_SNAPSHOT_ID="$(jq -r '.snapshot_id // ""' "$MANIFEST")"
PREV_SNAPSHOT_ID=""
if [[ -f "$SNAPSHOT" ]]; then
  PREV_SNAPSHOT_ID="$(jq -r '.snapshot_id // ""' "$SNAPSHOT" 2>/dev/null || true)"
fi

if [[ "$CUR_SNAPSHOT_ID" == "$PREV_SNAPSHOT_ID" && -n "$CUR_SNAPSHOT_ID" ]]; then
  jq -cn --arg status "skipped" --arg reason "snapshot_unchanged" '{status:$status,reason:$reason}'
  exit 0
fi

# Append a human-readable audit summary while the JSON snapshot file stores the
# machine-readable cursor used to suppress duplicate audits.
CHANGED_COUNT="$(jq -r '.changed_count // 0' "$MANIFEST")"
CHANGED_FILES="$(jq -r '(.changed_files // []) | map("\(.change):\(.path)") | .[0:20] | join(", ")' "$MANIFEST")"
if [[ -z "$CHANGED_FILES" ]]; then
  CHANGED_FILES="(none)"
fi
KEY_HITS="0"
SEMANTIC_SCORE="0"
if [[ -f "$REPORT" ]]; then
  KEY_HITS="$(jq -r '.key_path_hits // 0' "$REPORT")"
  SEMANTIC_SCORE="$(jq -r '.semantic_score // 0' "$REPORT")"
fi

{
  echo ""
  echo "## Workspace Delta Audit @ $NOW"
  echo "- task_id: $TASK_ID"
  echo "- run_root: $RUN_ROOT"
  echo "- snapshot_id: $CUR_SNAPSHOT_ID"
  echo "- changed_count: $CHANGED_COUNT"
  echo "- key_path_hits: $KEY_HITS"
  echo "- semantic_score: $SEMANTIC_SCORE"
  echo "- changed_files: $CHANGED_FILES"
  echo "- decision: MONITOR (workspace delta recorded)"
} >> "$AUDIT_MD"

jq -cn \
  --arg timestamp "$NOW" \
  --arg snapshot_id "$CUR_SNAPSHOT_ID" \
  --arg prev_snapshot_id "$PREV_SNAPSHOT_ID" \
  '{timestamp:$timestamp,snapshot_id:$snapshot_id,prev_snapshot_id:$prev_snapshot_id}' > "$SNAPSHOT"

if [[ -x "$APPEND_SCRIPT" ]]; then
  "$APPEND_SCRIPT" "$TASK_DIR" "audit-guard" "op_ws_audit_${TASK_ID}_$(date -u +%Y%m%d%H%M%S)" "WORKSPACE_DELTA_AUDITED" "changes=$CHANGED_COUNT snapshot=$CUR_SNAPSHOT_ID" >/dev/null 2>&1 || true
fi

jq -cn \
  --arg status "ok" \
  --arg task_id "$TASK_ID" \
  --arg snapshot_id "$CUR_SNAPSHOT_ID" \
  --argjson changed_count "$CHANGED_COUNT" \
  --arg changed_files "$CHANGED_FILES" \
  '{status:$status,task_id:$task_id,snapshot_id:$snapshot_id,changed_count:$changed_count,changed_files:$changed_files}'
