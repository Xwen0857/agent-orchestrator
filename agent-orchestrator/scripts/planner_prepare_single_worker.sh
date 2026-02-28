#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task_dir> <worker_id>"
  exit 2
fi

TASK_DIR="$1"
WORKER_ID="$2"
META="$TASK_DIR/meta.json"
if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
source "$ROOT/agent-orchestrator/scripts/planner_state_paths.sh"
TASK_ID="$(jq -r '.id' "$META")"
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
if [[ ! -f "$STRATEGY" ]]; then
  echo "strategy missing: $STRATEGY"
  exit 1
fi

TITLE="$(jq -r '.title // .goal // "untitled"' "$STRATEGY")"
GOAL="$(jq -r '.goal // ""' "$STRATEGY")"
RISK="$(jq -r '.risk_level // "MEDIUM"' "$STRATEGY")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PRIMARY_ID="primary_${TASK_ID#task_}"
CHECKLIST_ID="CL_${TASK_ID#task_}"
SUBCHECKLIST_ID="SCL_${TASK_ID#task_}_001"

PRIMARY_TEMPLATE_FILE="$ROOT/templates/coordination/planner/primary.example.md"
PRIMARY_FILE="$(resolve_planner_primary_path)"
CHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/planner/checklist.example.md"
CHECKLIST_FILE="$(resolve_planner_checklist_path)"
SUBCHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/tasks/subchecklist.example.md"
SUBCHECKLIST_FILE="$(resolve_subchecklists_runtime_dir)/${SUBCHECKLIST_ID}.md"
WORKER_TASKS_TEMPLATE_FILE="$ROOT/templates/coordination/tasks/worker-task.example.md"
WORKER_TASKS_FILE="$(resolve_worker_tasks_runtime_dir)/${WORKER_ID}_tasks.md"
WORKER_LIFECYCLE_FILE="$ROOT/templates/coordination/worker_lifecycle/${WORKER_ID}_lifecycle.md"

mkdir -p "$(dirname "$PRIMARY_FILE")" "$(dirname "$CHECKLIST_FILE")" "$(dirname "$SUBCHECKLIST_FILE")" "$(dirname "$WORKER_TASKS_FILE")" "$(dirname "$WORKER_LIFECYCLE_FILE")"

ensure_runtime_file_from_template "$PRIMARY_FILE" "$PRIMARY_TEMPLATE_FILE"

ensure_planner_checklist_file "$CHECKLIST_FILE" "$CHECKLIST_TEMPLATE_FILE"
ensure_runtime_file_from_template "$WORKER_TASKS_FILE" "$WORKER_TASKS_TEMPLATE_FILE"

if [[ ! -f "$WORKER_LIFECYCLE_FILE" ]]; then
  cat > "$WORKER_LIFECYCLE_FILE" <<'TABLE'
| timestamp | worker_task | owner_role | lifecycle_event | status | notes |
|---|---|---|---|---|---|
TABLE
fi

if ! grep -Fq "$PRIMARY_ID" "$PRIMARY_FILE"; then
  printf '| %s | %s | %s | %s | %s | P1 | STARTED | YES |\n' \
    "$PRIMARY_ID" "$TITLE" "$GOAL" "risk=$RISK; single-worker" "delivery files + unittest pass" >> "$PRIMARY_FILE"
fi

if ! grep -Fq "$CHECKLIST_ID" "$CHECKLIST_FILE"; then
  printf '| %s | %s | planner | IN_PROGRESS |  | code+test prepared | task=%s |\n' \
    "$CHECKLIST_ID" "$TITLE" "$TASK_ID" >> "$CHECKLIST_FILE"
fi

ensure_runtime_file_from_template "$SUBCHECKLIST_FILE" "$SUBCHECKLIST_TEMPLATE_FILE"
cat > "$SUBCHECKLIST_FILE" <<TABLE
| subchecklist_id | checklist_item_id | title | status | verification_rule | notes |
|---|---|---|---|---|---|
| $SUBCHECKLIST_ID | $CHECKLIST_ID | $TITLE | READY | tester_result.json status PASS | generated_at=$NOW |
TABLE

if ! grep -Fq "$TASK_ID" "$WORKER_TASKS_FILE"; then
  printf '| %s | %s | %s | %s | %s | worker-delivery | ASSIGNED | P1 | 0 | prepared_at=%s |\n' \
    "$TASK_ID" "$PRIMARY_ID" "$CHECKLIST_ID" "$SUBCHECKLIST_ID" "$TITLE" "$NOW" >> "$WORKER_TASKS_FILE"
fi

if ! grep -Fq "$TASK_ID" "$WORKER_LIFECYCLE_FILE"; then
  printf '| %s | %s | planner-ops | CREATED | ACTIVE | planned assignment generated |\n' \
    "$NOW" "$TASK_ID" >> "$WORKER_LIFECYCLE_FILE"
fi

PLAN_TMP="$(mktemp "$TASK_DIR/.plan.XXXXXX")"
awk -v goal="$GOAL" -v title="$TITLE" '
  {
    if ($0 ~ /^- Scope:[[:space:]]*$/) {
      print "- Scope: " title
    } else if ($0 ~ /^- Constraints:[[:space:]]*$/) {
      print "- Constraints: single-worker deterministic pipeline"
    } else if ($0 ~ /^- Milestones:[[:space:]]*$/) {
      print "- Milestones: PLAN->ASSIGN->IMPLEMENT->TEST->CLOSE"
    } else {
      print
    }
  }
' "$TASK_DIR/plan.md" > "$PLAN_TMP"
mv "$PLAN_TMP" "$TASK_DIR/plan.md"

echo "planner prepared: task_id=$TASK_ID worker_id=$WORKER_ID"
