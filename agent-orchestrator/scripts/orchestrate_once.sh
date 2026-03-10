#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
source "$ROOT/agent-orchestrator/scripts/planner_state_paths.sh"
TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"
TARGET_TASK_ID=""
DISPATCH_ROLE="agent-orchestrator"
INPUT_WORK_DOMAIN_ID=""
INPUT_WORKSPACE_ROOT=""
ONLY_ONE_TASK=true
PLANNING_ACTOR="planner-core"
SCHEDULING_ACTOR="scheduler-ops"
if [[ $# -gt 0 ]]; then
  case "${1:-}" in
    --task-id|--role|--work-domain-id|--workspace-root)
      echo "usage: $0 [tasks_root] [--task-id <task_id>] [--role <role>] [--work-domain-id <id>] [--workspace-root <path>]"
      exit 2
      ;;
    *)
      TASKS_ROOT="$1"
      shift
      ;;
  esac
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id)
      if [[ $# -lt 2 ]]; then
        echo "--task-id requires a value"
        exit 2
      fi
      TARGET_TASK_ID="$2"
      shift 2
      ;;
    --role)
      if [[ $# -lt 2 ]]; then
        echo "--role requires a value"
        exit 2
      fi
      DISPATCH_ROLE="$2"
      shift 2
      ;;
    --work-domain-id)
      if [[ $# -lt 2 ]]; then
        echo "--work-domain-id requires a value"
        exit 2
      fi
      INPUT_WORK_DOMAIN_ID="$2"
      shift 2
      ;;
    --workspace-root)
      if [[ $# -lt 2 ]]; then
        echo "--workspace-root requires a value"
        exit 2
      fi
      INPUT_WORKSPACE_ROOT="$2"
      shift 2
      ;;
    *)
      echo "usage: $0 [tasks_root] [--task-id <task_id>] [--role <role>] [--work-domain-id <id>] [--workspace-root <path>]"
      exit 2
      ;;
  esac
done
DASHBOARD_SCRIPT="$ROOT/agent-orchestrator/scripts/dashboard_summary.sh"
TRANSITION_SCRIPT="$ROOT/agent-orchestrator/scripts/transition_task_state.sh"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
WORKER_SCRIPT="$ROOT/agent-orchestrator/scripts/worker_realize_task.sh"
TESTER_SCRIPT="$ROOT/agent-orchestrator/scripts/tester_run_task.sh"
PLANNER_MULTI_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_workers.sh"
PLANNER_SINGLE_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_single_worker.sh"
PLANNER_ENTRY_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_entry.sh"
ALLOCATE_WORK_DOMAIN_SCRIPT="$ROOT/agent-orchestrator/scripts/allocate_work_domain.sh"
ACL_SCRIPT="$ROOT/agent-orchestrator/scripts/enforce_role_acl.sh"
BUILD_POLICY_SCRIPT="$ROOT/agent-orchestrator/scripts/build_role_permissions.sh"
SANDBOX_SCRIPT="$ROOT/agent-orchestrator/scripts/launch_agent_sandbox.sh"
COMMIT_GUARD_SCRIPT="$ROOT/agent-orchestrator/scripts/guard_workspace_changes.sh"
ENSURE_WORKSPACE_SCRIPT="$ROOT/agent-orchestrator/scripts/ensure_workspace_contract.sh"
ENV_BUILD_SCRIPT="$ROOT/agent-orchestrator/scripts/workspace_build_env.sh"
WS_CHANGE_DETECT_SCRIPT="$ROOT/agent-orchestrator/scripts/detect_workspace_user_changes.sh"
WS_SYNC_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_sync_on_workspace_change.sh"
REPLAN_CONSUME_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_consume_replan_queue.sh"
AUDIT_WS_DELTA_SCRIPT="$ROOT/agent-orchestrator/scripts/audit_workspace_delta.sh"
AGGREGATE_SCRIPT="$ROOT/agent-orchestrator/scripts/aggregate_child_deliveries.sh"
AUDIT_AGGREGATE_SCRIPT="$ROOT/agent-orchestrator/scripts/audit_aggregate_release.sh"
PROMOTE_AGGREGATE_SCRIPT="$ROOT/agent-orchestrator/scripts/promote_or_rollback_aggregate.sh"
RECORD_COMPLETED_CONTEXT_SCRIPT="$ROOT/agent-orchestrator/scripts/record_completed_task_context.sh"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"

if [[ ! -d "$TASKS_ROOT" ]]; then
  echo "tasks root not found: $TASKS_ROOT"
  exit 1
fi
TASKS_ROOT="$(cd "$TASKS_ROOT" && pwd -P)"

if [[ ! -x "$TRANSITION_SCRIPT" ]]; then
  echo "transition script not executable: $TRANSITION_SCRIPT"
  exit 1
fi
if [[ ! -x "$APPEND_SCRIPT" ]]; then
  echo "append event script not executable: $APPEND_SCRIPT"
  exit 1
fi
if [[ ! -x "$WORKER_SCRIPT" ]]; then
  echo "worker script not executable: $WORKER_SCRIPT"
  exit 1
fi
if [[ ! -x "$TESTER_SCRIPT" ]]; then
  echo "tester script not executable: $TESTER_SCRIPT"
  exit 1
fi
if [[ ! -x "$PLANNER_MULTI_SCRIPT" ]]; then
  echo "planner script not executable: $PLANNER_MULTI_SCRIPT"
  exit 1
fi
if [[ ! -x "$PLANNER_SINGLE_SCRIPT" ]]; then
  echo "planner script not executable: $PLANNER_SINGLE_SCRIPT"
  exit 1
fi
if [[ ! -x "$PLANNER_ENTRY_SCRIPT" ]]; then
  echo "planner entry script not executable: $PLANNER_ENTRY_SCRIPT"
  exit 1
fi
if [[ ! -x "$ALLOCATE_WORK_DOMAIN_SCRIPT" ]]; then
  echo "work domain script not executable: $ALLOCATE_WORK_DOMAIN_SCRIPT"
  exit 1
fi
if [[ ! -x "$ACL_SCRIPT" ]]; then
  echo "acl script not executable: $ACL_SCRIPT"
  exit 1
fi
if [[ ! -x "$SANDBOX_SCRIPT" ]]; then
  echo "sandbox script not executable: $SANDBOX_SCRIPT"
  exit 1
fi
if [[ ! -x "$COMMIT_GUARD_SCRIPT" ]]; then
  echo "commit guard script not executable: $COMMIT_GUARD_SCRIPT"
  exit 1
fi
if [[ ! -x "$ENSURE_WORKSPACE_SCRIPT" ]]; then
  echo "workspace contract script not executable: $ENSURE_WORKSPACE_SCRIPT"
  exit 1
fi
if [[ ! -x "$ENV_BUILD_SCRIPT" ]]; then
  echo "workspace env build script not executable: $ENV_BUILD_SCRIPT"
  exit 1
fi
if [[ ! -x "$WS_CHANGE_DETECT_SCRIPT" ]]; then
  echo "workspace change detect script not executable: $WS_CHANGE_DETECT_SCRIPT"
  exit 1
fi
if [[ ! -x "$WS_SYNC_SCRIPT" ]]; then
  echo "workspace sync script not executable: $WS_SYNC_SCRIPT"
  exit 1
fi
if [[ ! -x "$REPLAN_CONSUME_SCRIPT" ]]; then
  echo "replan consume script not executable: $REPLAN_CONSUME_SCRIPT"
  exit 1
fi
if [[ ! -x "$AUDIT_WS_DELTA_SCRIPT" ]]; then
  echo "audit workspace delta script not executable: $AUDIT_WS_DELTA_SCRIPT"
  exit 1
fi
if [[ ! -x "$AGGREGATE_SCRIPT" ]]; then
  echo "aggregate script not executable: $AGGREGATE_SCRIPT"
  exit 1
fi
if [[ ! -x "$AUDIT_AGGREGATE_SCRIPT" ]]; then
  echo "aggregate audit script not executable: $AUDIT_AGGREGATE_SCRIPT"
  exit 1
fi
if [[ ! -x "$PROMOTE_AGGREGATE_SCRIPT" ]]; then
  echo "aggregate promote/rollback script not executable: $PROMOTE_AGGREGATE_SCRIPT"
  exit 1
fi
if [[ ! -x "$RECORD_COMPLETED_CONTEXT_SCRIPT" ]]; then
  echo "record completed context script not executable: $RECORD_COMPLETED_CONTEXT_SCRIPT"
  exit 1
fi

"$BUILD_POLICY_SCRIPT" >/dev/null 2>&1 || true

POLICY_MODE="$(jq -r '.security.policy_mode // "enforce"' "$RUNTIME_CONFIG" 2>/dev/null || echo "enforce")"
WORKDOMAIN_SYNC_STRATEGY="$(jq -r '.workdomain.sync_strategy // "copy_on_submit"' "$RUNTIME_CONFIG" 2>/dev/null || echo "copy_on_submit")"
SANDBOX_ENABLED="$(jq -r '.security.sandbox_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
COMMIT_GUARD_ENABLED="$(jq -r '.security.commit_guard_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
KB_CONFIRM_REQUIRED="$(jq -r '.kb_import.confirm_required // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
KB_AUTO_ENABLED="$(jq -r '.kb_import.auto_enabled // false' "$RUNTIME_CONFIG" 2>/dev/null || echo false)"
WS_SYNC_SENSITIVITY="$(jq -r '.sync.workspace_sync_sensitivity // \"MEDIUM\"' "$RUNTIME_CONFIG" 2>/dev/null || echo MEDIUM)"
PROJECT_RUNTIME_PROFILE_DEFAULT="$(jq -r '.agent_runtime_isolation.project_profile_name // "project_execution"' "$RUNTIME_CONFIG" 2>/dev/null || echo "project_execution")"

append_if_missing() {
  local file="$1"
  local text="$2"
  if ! grep -Fq "$text" "$file" 2>/dev/null; then
    printf '\n%s\n' "$text" >> "$file"
  fi
}

latest_line_matching() {
  local pattern="$1"
  local file="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$file" 2>/dev/null | tail -n 1 | cut -d: -f2- || true
    return
  fi
  grep -En "$pattern" "$file" 2>/dev/null | tail -n 1 | cut -d: -f2- || true
}

sanitize_worker_submission_files() {
  local task_dir="$1"
  local work_file test_file tmp
  work_file="$task_dir/work.md"
  test_file="$task_dir/test.md"

  if [[ -f "$work_file" ]]; then
    tmp="$(mktemp)"
    awk '
      BEGIN { IGNORECASE=1 }
      /^- Latest action:[[:space:]]*$/ { next }
      /^- Changed files:[[:space:]]*$/ { next }
      /^- Changed files:[[:space:]]*(none|n\/a|pending implementation)$/ { next }
      { print }
    ' "$work_file" > "$tmp"
    mv "$tmp" "$work_file"
  fi

  if [[ -f "$test_file" ]]; then
    tmp="$(mktemp)"
    awk '
      BEGIN { IGNORECASE=1 }
      /^- Commands:[[:space:]]*$/ { next }
      /^- Commands:[[:space:]]*manual-smoke$/ { next }
      { print }
    ' "$test_file" > "$tmp"
    mv "$tmp" "$test_file"
  fi
}

is_retryable_goal() {
  local goal="$1"
  local goal_lower
  goal_lower="$(printf '%s' "$goal" | tr '[:upper:]' '[:lower:]')"
  if [[ ( "$goal_lower" == *"websocket"* || "$goal_lower" == *"web socket"* || "$goal_lower" == *"ws"* || "$goal" == *"WebSocket"* ) \
    && ( "$goal_lower" == *"calc"* || "$goal_lower" == *"calculator"* || "$goal" == *"计算器"* ) ]]; then
    return 0
  fi
  return 1
}

task_worker_id() {
  local task_id="$1"
  local raw
  raw="${task_id#task_}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_')"
  raw="${raw#_}"
  raw="${raw%_}"
  if [[ -z "$raw" ]]; then
    raw="generic"
  fi
  printf 'worker_%s\n' "$(printf '%s' "$raw" | cut -c1-48)"
}

worker_status_file() {
  local worker_id="$1"
  printf '%s/templates/coordination/workers/%s_worker.md\n' "$ROOT" "$worker_id"
}

worker_tasks_file() {
  local worker_id="$1"
  printf '%s/%s_tasks.md\n' "$(resolve_worker_tasks_runtime_dir)" "$worker_id"
}

worker_lifecycle_file() {
  local worker_id="$1"
  printf '%s/templates/coordination/worker_lifecycle/%s_lifecycle.md\n' "$ROOT" "$worker_id"
}

worker_delivery_log_file() {
  local worker_id="$1"
  printf '%s/templates/coordination/workers/%s_delivery.ndjson\n' "$ROOT" "$worker_id"
}

ensure_worker_views() {
  local worker_id="$1"
  local status_file tasks_file lifecycle_file delivery_log_file
  status_file="$(worker_status_file "$worker_id")"
  tasks_file="$(worker_tasks_file "$worker_id")"
  lifecycle_file="$(worker_lifecycle_file "$worker_id")"
  delivery_log_file="$(worker_delivery_log_file "$worker_id")"

  mkdir -p "$(dirname "$status_file")" "$(dirname "$tasks_file")" "$(dirname "$lifecycle_file")"

  if [[ ! -f "$status_file" ]]; then
    cat > "$status_file" <<'TABLE'
| timestamp | worker_task | owner_role | status | performance_metrics | notes |
|---|---|---|---|---|---|
TABLE
  fi
  if [[ ! -f "$tasks_file" ]]; then
    cat > "$tasks_file" <<'TABLE'
| task_id | primary_id | checklist_item_id | subchecklist_id | title | owner_role | status | priority | attempts | notes |
|---|---|---|---|---|---|---|---|---|---|
TABLE
  fi
  if [[ ! -f "$lifecycle_file" ]]; then
    cat > "$lifecycle_file" <<'TABLE'
| timestamp | worker_task | owner_role | lifecycle_event | status | notes |
|---|---|---|---|---|---|
TABLE
  fi
  if [[ ! -f "$delivery_log_file" ]]; then
    : > "$delivery_log_file"
  fi
}

record_worker_status() {
  local worker_id="$1"
  local task_id="$2"
  local status="$3"
  local notes="$4"
  local ts status_file tasks_file
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  status_file="$(worker_status_file "$worker_id")"
  tasks_file="$(worker_tasks_file "$worker_id")"
  printf '| %s | %s | worker-delivery | %s | n/a | %s |\n' "$ts" "$task_id" "$status" "$notes" >> "$status_file"
  printf '| %s | n/a | n/a | n/a | %s | worker-delivery | %s | P1 | 1 | %s |\n' "$task_id" "$task_id" "$status" "$notes" >> "$tasks_file"
}

record_worker_lifecycle() {
  local worker_id="$1"
  local task_id="$2"
  local lifecycle_event="$3"
  local status="$4"
  local notes="$5"
  local ts lifecycle_file
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  lifecycle_file="$(worker_lifecycle_file "$worker_id")"
  printf '| %s | %s | worker-delivery | %s | %s | %s |\n' "$ts" "$task_id" "$lifecycle_event" "$status" "$notes" >> "$lifecycle_file"
}

assert_worker_submission_with_log() {
  local task_dir="$1"
  local task_id="$2"
  local worker_id="$3"
  local work_file task_delivery_log global_delivery_log ts summary
  work_file="$task_dir/work.md"
  task_delivery_log="$task_dir/worker_submission.ndjson"
  global_delivery_log="$(worker_delivery_log_file "$worker_id")"

  if [[ ! -f "$work_file" ]]; then
    echo "worker submission missing work.md"
    return 1
  fi

  local latest_action_line changed_files_line
  latest_action_line="$(latest_line_matching "^- Latest action:[[:space:]]*.+" "$work_file")"
  changed_files_line="$(latest_line_matching "^- Changed files:[[:space:]]*.+" "$work_file")"

  if [[ -z "$latest_action_line" || "$latest_action_line" == "- Latest action:" ]]; then
    echo "worker submission rejected: missing actionable Latest action"
    return 1
  fi
  if [[ -z "$changed_files_line" || "$changed_files_line" == "- Changed files:" || "$changed_files_line" == *"none"* ]]; then
    echo "worker submission rejected: missing changed files evidence"
    return 1
  fi

  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  summary="${latest_action_line#- Latest action: }"
  mkdir -p "$(dirname "$global_delivery_log")"
  jq -cn \
    --arg timestamp "$ts" \
    --arg task_id "$task_id" \
    --arg worker_id "$worker_id" \
    --arg summary "$summary" \
    --arg changed_files "${changed_files_line#- Changed files: }" \
    '{timestamp:$timestamp,task_id:$task_id,worker_id:$worker_id,summary:$summary,changed_files:$changed_files}' >> "$task_delivery_log"
  jq -cn \
    --arg timestamp "$ts" \
    --arg task_id "$task_id" \
    --arg worker_id "$worker_id" \
    --arg summary "$summary" \
    --arg changed_files "${changed_files_line#- Changed files: }" \
    '{timestamp:$timestamp,task_id:$task_id,worker_id:$worker_id,summary:$summary,changed_files:$changed_files}' >> "$global_delivery_log"

  append_if_missing "$work_file" "- Delivery log: worker_submission.ndjson"
}

run_transition() {
  local task_dir="$1"
  local actor="$2"
  local from="$3"
  local to="$4"
  local reason="$5"
  local task_id="$6"
  local op_id="op_orchestrate_${task_id}_${from}_${to}_$(date -u +%Y%m%d%H%M%S)_$$"
  "$TRANSITION_SCRIPT" "$task_dir" "$actor" "$op_id" "$from" "$to" "$reason" >/dev/null
}

append_event_nonfatal() {
  local task_dir="$1"
  local actor="$2"
  local action="$3"
  local reason="$4"
  local before_state="${5:-}"
  local after_state="${6:-}"
  local op_id="op_evt_$(date -u +%Y%m%d%H%M%S)_$$_$RANDOM"
  "$APPEND_SCRIPT" "$task_dir" "$actor" "$op_id" "$action" "$reason" "$before_state" "$after_state" >/dev/null 2>&1 || true
}

ensure_execution_roles_meta() {
  local task_dir="$1"
  local state="$2"
  local planning_actor="${3:-$PLANNING_ACTOR}"
  local scheduling_actor="${4:-$SCHEDULING_ACTOR}"
  local compat_default=false
  local tmp
  if [[ "$state" != "CREATED" ]]; then
    compat_default=true
  fi
  tmp="$(mktemp "$task_dir/.meta.roles.XXXXXX.json")"
  jq \
    --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg planning_actor "$planning_actor" \
    --arg scheduling_actor "$scheduling_actor" \
    --argjson compat_default "$compat_default" \
    '.execution_roles = (.execution_roles // {})
    | .execution_roles.planning_actor = (.execution_roles.planning_actor // $planning_actor)
    | .execution_roles.scheduling_actor = (.execution_roles.scheduling_actor // $scheduling_actor)
    | .execution_roles.compat_mode = (.execution_roles.compat_mode // $compat_default)
    | .execution_roles.compat_hits = (.execution_roles.compat_hits // 0)
    | .updated_at = $now' "$task_dir/meta.json" > "$tmp" && mv "$tmp" "$task_dir/meta.json"
}

update_aggregate_meta() {
  local task_dir="$1"
  local publish_status="$2"
  local staging_root="$3"
  local manifest_path="$4"
  local audit_path="$5"
  local block_reason="$6"
  local now
  local tmp
  local collisions_count
  local aggregate_audit_status
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  collisions_count=0
  if [[ -f "$manifest_path" ]]; then
    collisions_count="$(jq -r '(.collisions // []) | length' "$manifest_path" 2>/dev/null || echo 0)"
  fi
  aggregate_audit_status=""
  case "$publish_status" in
    audited_pass|published) aggregate_audit_status="PASS" ;;
    audited_fail|rolled_back) aggregate_audit_status="FAIL" ;;
    *) aggregate_audit_status="" ;;
  esac
  tmp="$(mktemp "$task_dir/.meta.aggregate.XXXXXX.json")"
  jq \
    --arg publish_status "$publish_status" \
    --arg staging_root "$staging_root" \
    --arg manifest_path "$manifest_path" \
    --arg audit_path "$audit_path" \
    --arg block_reason "$block_reason" \
    --arg now "$now" \
    --arg aggregate_audit_status "$aggregate_audit_status" \
    --argjson collisions_count "$collisions_count" \
    '.aggregate = (.aggregate // {})
    | .aggregate.staging_root = $staging_root
    | .aggregate.manifest_path = $manifest_path
    | .aggregate.audit_path = $audit_path
    | .aggregate.publish_status = $publish_status
    | .aggregate.last_block_reason = $block_reason
    | .aggregate_collisions_count = $collisions_count
    | .aggregate_audit_status = $aggregate_audit_status
    | if $publish_status == "published" then .aggregate.last_publish_at = $now else . end
    | if $publish_status == "rolled_back" then .aggregate.last_rollback_at = $now else . end
    | .updated_at = $now' "$task_dir/meta.json" > "$tmp" && mv "$tmp" "$task_dir/meta.json"
}

aggregate_children_to_staging() {
  local task_dir="$1"
  local run_root="$2"
  local children_json="$3"
  "$AGGREGATE_SCRIPT" --task-dir "$task_dir" --run-root "$run_root" --children-json "$children_json"
}

audit_aggregate_release() {
  local task_dir="$1"
  local run_root="$2"
  "$AUDIT_AGGREGATE_SCRIPT" --task-dir "$task_dir" --run-root "$run_root"
}

promote_or_rollback_aggregate() {
  local task_dir="$1"
  local run_root="$2"
  local mode="$3"
  local reason="$4"
  "$PROMOTE_AGGREGATE_SCRIPT" --task-dir "$task_dir" --run-root "$run_root" --mode "$mode" --reason "$reason"
}

acl_allow() {
  local role="$1"
  local action="$2"
  local target="$3"
  local task_id="$4"
  if "$ACL_SCRIPT" --role "$role" --action "$action" --target "$target" --task-id "$task_id" --tasks-root "$TASKS_ROOT" >/dev/null; then
    return 0
  fi
  return 1
}

allocate_work_domain_for_task() {
  local task_dir="$1"
  local worker_id="$2"
  "$ALLOCATE_WORK_DOMAIN_SCRIPT" "$task_dir" "$worker_id" >/dev/null
}

sync_delivery_to_run_root() {
  local task_dir="$1"
  local run_root="$2"
  local task_id="$3"
  local src="$task_dir/delivery"
  local dst="$run_root/delivery"
  if [[ "$WORKDOMAIN_SYNC_STRATEGY" != "copy_on_submit" ]]; then
    return 0
  fi
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  if ! acl_allow "worker-delivery" "write" "$run_root" "$task_id"; then
    return 1
  fi
  mkdir -p "$dst"
  rm -rf "$dst"/* 2>/dev/null || true
  cp -R "$src/." "$dst/" 2>/dev/null || true
  return 0
}

trigger_workspace_hooks() {
  local task_dir="$1"
  local task_id="$2"
  local run_root="$3"
  local ws_changed ws_report
  if [[ -z "$run_root" || ! -d "$run_root" ]]; then
    return 0
  fi
  ws_changed=0
  if acl_allow "$PLANNING_ACTOR" "read" "$run_root" "$task_id"; then
    ws_report="$("$WS_CHANGE_DETECT_SCRIPT" "$task_dir" 2>/dev/null || echo '{"changed_count":0}')"
    ws_changed="$(printf '%s' "$ws_report" | jq -r '.changed_count // 0' 2>/dev/null || echo 0)"
    if [[ "$ws_changed" =~ ^[0-9]+$ ]] && [[ "$ws_changed" -gt 0 ]]; then
      "$WS_SYNC_SCRIPT" "$task_dir" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$ws_changed" =~ ^[0-9]+$ ]] && [[ "$ws_changed" -gt 0 ]]; then
    if acl_allow "audit-guard" "read" "$run_root" "$task_id"; then
      "$AUDIT_WS_DELTA_SCRIPT" "$task_dir" >/dev/null 2>&1 || true
    fi
  fi
  return 0
}

is_parent_aggregate_task() {
  local meta="$1"
  if jq -e '.children | type == "array" and length > 0' "$meta" >/dev/null 2>&1 \
    && ! jq -e '.parent_task_id | type == "string" and length > 0' "$meta" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

append_parent_progress_notes() {
  local task_dir="$1"
  local task_id="$2"
  local children_csv="$3"
  append_if_missing "$task_dir/work.md" "- Latest action: parent aggregate coordinator tracking child tasks"
  append_if_missing "$task_dir/work.md" "- Changed files: split_plan.json, child task meta updates"
  append_if_missing "$task_dir/work.md" "- Aggregate children: $children_csv"
  append_if_missing "$task_dir/test.md" "- Commands: aggregate-check child states are CLOSED"
}

write_parent_tester_pass() {
  local task_dir="$1"
  local task_id="$2"
  local result_json="$task_dir/tester_result.json"
  jq -n \
    --arg task_id "$task_id" \
    --arg status "PASS" \
    --arg details "aggregate pass: all child tasks are CLOSED" \
    '{task_id:$task_id,status:$status,details:$details}' > "$result_json"
  {
    echo "- Commands: aggregate-check child states are CLOSED"
    echo "- Result: PASS"
    echo "- Evidence: all children reached CLOSED"
  } >> "$task_dir/test.md"
}

processed=0
advanced=0
failed=0
failed_lines=()

while IFS= read -r -d '' meta; do
  task_dir="${meta%/meta.json}"
  task_dir="$(cd "$task_dir" && pwd -P)"
  task_id="$(jq -r '.id' "$meta")"
  state="$(jq -r '.state' "$meta")"
  run_root_hint="$(jq -r '.run_root // ""' "$meta" 2>/dev/null || true)"
  trigger_workspace_hooks "$task_dir" "$task_id" "$run_root_hint"

  if [[ "$state" == "CLOSED" ]]; then
    continue
  fi

  if [[ -n "$TARGET_TASK_ID" && "$task_id" != "$TARGET_TASK_ID" ]]; then
    continue
  fi

  strategy_file="$task_dir/${task_id}.strategy.json"
  if [[ ! -f "$strategy_file" ]]; then
    continue
  fi

  processed=$((processed + 1))

  if [[ ! -f "$task_dir/plan.md" || ! -f "$task_dir/work.md" || ! -f "$task_dir/test.md" || ! -f "$task_dir/audit.md" ]]; then
    failed=$((failed + 1))
    failed_lines+=("$task_id: missing required artifact files")
    continue
  fi

  goal="$(jq -r '.goal // ""' "$strategy_file" 2>/dev/null || true)"
  worker_id="$(task_worker_id "$task_id")"
  is_parent=false
  if is_parent_aggregate_task "$meta"; then
    is_parent=true
  fi
  children=()
  if [[ "$is_parent" == true ]]; then
    while IFS= read -r child; do
      [[ -n "$child" ]] && children+=("$child")
    done < <(jq -r '.children[]? // empty' "$meta")
  fi
  ensure_worker_views "$worker_id"
  if ! allocate_work_domain_for_task "$task_dir" "$worker_id"; then
    failed=$((failed + 1))
    failed_lines+=("$task_id: work domain allocation failed")
    op_id="op_orchestrate_${task_id}_workdomain_fail_$(date -u +%Y%m%d%H%M%S)_$$"
    "$TRANSITION_SCRIPT" "$task_dir" "agent-orchestrator" "$op_id" "$state" "BLOCKED_SYSTEM_ERROR" "orchestrator: work domain allocation failed" >/dev/null 2>&1 || true
    continue
  fi
  if [[ -n "$INPUT_WORK_DOMAIN_ID" || -n "$INPUT_WORKSPACE_ROOT" ]]; then
    tmp_meta="$(mktemp "$task_dir/.meta.input_domain.XXXXXX.json")"
    jq \
      --arg input_work_domain_id "$INPUT_WORK_DOMAIN_ID" \
      --arg input_workspace_root "$INPUT_WORKSPACE_ROOT" \
      --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      'if ($input_work_domain_id|length)>0 then .work_domain_id=$input_work_domain_id else . end
      | if ($input_workspace_root|length)>0 then .workspace_root=$input_workspace_root else . end
      | .updated_at = $now' "$meta" > "$tmp_meta" && mv "$tmp_meta" "$meta"
  fi
  if ! "$ENSURE_WORKSPACE_SCRIPT" "$task_dir" "$DISPATCH_ROLE" >/dev/null 2>&1; then
    failed=$((failed + 1))
    failed_lines+=("$task_id: workspace contract init failed")
    continue
  fi
  work_domain_id="$(jq -r '.work_domain_id // ""' "$meta" 2>/dev/null || true)"
  workspace_root="$(jq -r '.workspace_root // ""' "$meta" 2>/dev/null || true)"
  run_root="$(jq -r '.run_root // ""' "$meta" 2>/dev/null || true)"
  role_policy_version="$(jq -r '.role_constraints_version // ""' "$meta" 2>/dev/null || true)"
  runtime_profile_project="$(jq -r '.runtime_profile_project // ""' "$meta" 2>/dev/null || true)"
  if [[ -z "$runtime_profile_project" ]]; then
    runtime_profile_project="$PROJECT_RUNTIME_PROFILE_DEFAULT"
  fi
  ensure_execution_roles_meta "$task_dir" "$state" "$PLANNING_ACTOR" "$SCHEDULING_ACTOR"
  planner_replan_status="$(jq -r '.planner_replan.status // ""' "$meta" 2>/dev/null || true)"
  if [[ "$planner_replan_status" == "queued" && "$state" != "CLOSED" ]]; then
    if ! "$REPLAN_CONSUME_SCRIPT" "$task_dir" >/dev/null 2>&1; then
      failed=$((failed + 1))
      failed_lines+=("$task_id: planner replan consume failed")
      continue
    fi
    advanced=$((advanced + 1))
    continue
  fi
  if [[ "$planner_replan_status" == "applied" && "$state" != "CLOSED" ]]; then
    planner_replan_worker_policy="$(jq -r '.planner_replan.worker_policy // "continue"' "$meta" 2>/dev/null || true)"
    runtime_replan_consume_status="$(jq -r '.runtime_replan.consume_status // ""' "$meta" 2>/dev/null || true)"
    if [[ "$planner_replan_worker_policy" == "revalidate_then_resume" && "$runtime_replan_consume_status" != "ready" ]]; then
      tmp_meta="$(mktemp "$task_dir/.meta.revalidated.XXXXXX.json")"
      now_revalidated="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      jq \
        --arg now "$now_revalidated" \
        '.runtime_replan.consume_status = "ready"
        | .runtime_replan.consumed_at = (.runtime_replan.consumed_at // $now)
        | .runtime_replan.last_runtime_actor = "orchestrate_once"
        | .runtime_replan.last_runtime_transition = "awaiting_revalidation->ready"
        | .workspace_last_synced_seq = (.workspace_user_change_seq // .workspace_last_synced_seq // 0)
        | .workspace_last_sync_reason = "receptionist_amendment_batch_revalidated"
        | .dirty_state = false
        | .updated_at = $now' "$meta" > "$tmp_meta" && mv "$tmp_meta" "$meta"
      append_event_nonfatal "$task_dir" "$PLANNING_ACTOR" "PLANNER_REPLAN_REVALIDATED" "planner revalidated amended inputs before resume" "$state" "$state"
      append_if_missing "$task_dir/work.md" "- Latest action: planner revalidated amended inputs before resume"
      advanced=$((advanced + 1))
      continue
    fi
    if [[ "$planner_replan_worker_policy" == "pause_and_require_replan" ]]; then
      append_if_missing "$task_dir/work.md" "- Latest action: worker execution paused pending runtime recovery request"
      continue
    fi
  fi

  case "$state" in
    CREATED)
      if ! acl_allow "$PLANNING_ACTOR" "write" "$task_dir/plan.md" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied planner write plan")
        continue
      fi
      if ! "$PLANNER_ENTRY_SCRIPT" --task-dir "$task_dir" >/dev/null 2>&1; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: planner entry failed")
        continue
      fi
      append_if_missing "$task_dir/plan.md" "- Goal: $goal"
      append_if_missing "$task_dir/plan.md" "- Worker assignment: $worker_id"
      record_worker_lifecycle "$worker_id" "$task_id" "CREATED" "ACTIVE" "planner assigned worker for task"
      if ! acl_allow "$PLANNING_ACTOR" "write" "$task_dir/meta.json" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied planner transition")
        continue
      fi
      if ! run_transition "$task_dir" "$PLANNING_ACTOR" "CREATED" "PLANNED" "orchestrator: planned from strategy" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition CREATED->PLANNED failed")
        continue
      fi
      if ! run_transition "$task_dir" "$PLANNING_ACTOR" "PLANNED" "ASSIGNED" "orchestrator: assigned for delivery" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition PLANNED->ASSIGNED failed")
        continue
      fi
      advanced=$((advanced + 1))
      ;;
    ASSIGNED)
      if [[ "$is_parent" == true ]]; then
        blocked_child=""
        all_children_closed=true
        for child_id in "${children[@]}"; do
          child_meta="$TASKS_ROOT/$child_id/meta.json"
          if [[ ! -f "$child_meta" ]]; then
            all_children_closed=false
            continue
          fi
          child_state="$(jq -r '.state // ""' "$child_meta")"
          if [[ "$child_state" == BLOCKED_* ]]; then
            blocked_child="$child_id:$child_state"
            break
          fi
          if [[ "$child_state" != "CLOSED" ]]; then
            all_children_closed=false
          fi
        done
        children_csv="$(IFS=,; echo "${children[*]}")"
        append_parent_progress_notes "$task_dir" "$task_id" "$children_csv"
        if [[ -n "$blocked_child" ]]; then
          {
            echo "# Clarification Request"
            echo
            echo "- Task: $task_id"
            echo "- Issue: child task blocked during aggregate execution"
            echo "- Blocked child: $blocked_child"
            echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
          } > "$task_dir/clarification_request.md"
          if run_transition "$task_dir" "worker-delivery" "ASSIGNED" "BLOCKED_AWAITING_CLARIFICATION" "orchestrator: blocked child in aggregate flow" "$task_id"; then
            record_worker_status "$worker_id" "$task_id" "BLOCKED_AWAITING_CLARIFICATION" "aggregate blocked by child"
            advanced=$((advanced + 1))
            continue
          fi
        fi
        if [[ "$all_children_closed" == true && ${#children[@]} -gt 0 ]]; then
          append_event_nonfatal "$task_dir" "$SCHEDULING_ACTOR" "SCHEDULER_DISPATCHED" "scheduler dispatched parent task for aggregate progression" "ASSIGNED" "IN_PROGRESS"
          if run_transition "$task_dir" "$SCHEDULING_ACTOR" "ASSIGNED" "IN_PROGRESS" "orchestrator: parent aggregate moved to in_progress" "$task_id"; then
            record_worker_status "$worker_id" "$task_id" "IN_PROGRESS" "aggregate progressing to closure"
            advanced=$((advanced + 1))
            continue
          fi
        fi
        continue
      fi
      append_if_missing "$task_dir/work.md" "- Latest action: worker accepted task"
      record_worker_status "$worker_id" "$task_id" "ASSIGNED" "accepted by task-scoped worker"
      record_worker_lifecycle "$worker_id" "$task_id" "ACTIVATED" "ACTIVE" "worker accepted assignment"
      if ! acl_allow "$SCHEDULING_ACTOR" "write" "$task_dir/meta.json" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied scheduler transition ASSIGNED->IN_PROGRESS")
        continue
      fi
      append_event_nonfatal "$task_dir" "$SCHEDULING_ACTOR" "SCHEDULER_DISPATCHED" "scheduler dispatched task to delivery worker" "ASSIGNED" "IN_PROGRESS"
      if ! run_transition "$task_dir" "$SCHEDULING_ACTOR" "ASSIGNED" "IN_PROGRESS" "orchestrator: worker execution started" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition ASSIGNED->IN_PROGRESS failed")
        continue
      fi
      record_worker_status "$worker_id" "$task_id" "IN_PROGRESS" "started execution"
      advanced=$((advanced + 1))
      ;;
    IN_PROGRESS)
      if [[ "$is_parent" == true ]]; then
        blocked_child=""
        all_children_closed=true
        for child_id in "${children[@]}"; do
          child_meta="$TASKS_ROOT/$child_id/meta.json"
          if [[ ! -f "$child_meta" ]]; then
            all_children_closed=false
            continue
          fi
          child_state="$(jq -r '.state // ""' "$child_meta")"
          if [[ "$child_state" == BLOCKED_* ]]; then
            blocked_child="$child_id:$child_state"
            break
          fi
          if [[ "$child_state" != "CLOSED" ]]; then
            all_children_closed=false
          fi
        done
        children_csv="$(IFS=,; echo "${children[*]}")"
        append_parent_progress_notes "$task_dir" "$task_id" "$children_csv"
        if [[ -n "$blocked_child" ]]; then
          {
            echo "# Clarification Request"
            echo
            echo "- Task: $task_id"
            echo "- Issue: child task blocked during aggregate execution"
            echo "- Blocked child: $blocked_child"
            echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
          } > "$task_dir/clarification_request.md"
          if run_transition "$task_dir" "worker-delivery" "IN_PROGRESS" "BLOCKED_AWAITING_CLARIFICATION" "orchestrator: blocked child in aggregate flow" "$task_id"; then
            record_worker_status "$worker_id" "$task_id" "BLOCKED_AWAITING_CLARIFICATION" "aggregate blocked by child"
            advanced=$((advanced + 1))
            continue
          fi
        fi
        if [[ "$all_children_closed" != true || ${#children[@]} -eq 0 ]]; then
          continue
        fi
        if [[ -z "$run_root" || ! -d "$run_root" ]]; then
          append_if_missing "$task_dir/audit.md" "- Aggregate staging failed: parent run_root missing"
          update_aggregate_meta "$task_dir" "rolled_back" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "missing run_root for aggregate staging"
          if run_transition "$task_dir" "audit-guard" "IN_PROGRESS" "BLOCKED_PENDING_APPROVAL" "orchestrator: aggregate staging failed missing run_root" "$task_id"; then
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: missing run_root for aggregate staging")
          continue
        fi

        children_json="$(jq -c '.children // []' "$meta" 2>/dev/null || echo '[]')"
        if ! aggregate_children_to_staging "$task_dir" "$run_root" "$children_json" >/dev/null 2>&1; then
          aggregate_reason="aggregate staging failed (collisions or missing child delivery)"
          append_if_missing "$task_dir/audit.md" "- Aggregate staging failed: $aggregate_reason"
          promote_or_rollback_aggregate "$task_dir" "$run_root" "rollback" "$aggregate_reason" >/dev/null 2>&1 || true
          update_aggregate_meta "$task_dir" "rolled_back" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "$aggregate_reason"
          append_event_nonfatal "$task_dir" "agent-orchestrator" "AGGREGATE_STAGE_FAILED" "$aggregate_reason" "IN_PROGRESS" "BLOCKED_PENDING_APPROVAL"
          if run_transition "$task_dir" "audit-guard" "IN_PROGRESS" "BLOCKED_PENDING_APPROVAL" "orchestrator: aggregate staging failed" "$task_id"; then
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: aggregate staging failed")
          continue
        fi

        update_aggregate_meta "$task_dir" "staged" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" ""
        append_if_missing "$task_dir/work.md" "- Latest action: aggregate staged to delivery_staging"
        append_if_missing "$task_dir/work.md" "- Changed files: run_root/delivery_staging, run_root/delivery_staging_manifest.json"
        append_event_nonfatal "$task_dir" "agent-orchestrator" "AGGREGATE_STAGED" "aggregate staged to delivery_staging" "IN_PROGRESS" "TESTING"

        if run_transition "$task_dir" "worker-delivery" "IN_PROGRESS" "TESTING" "orchestrator: aggregate staged and waiting audit" "$task_id"; then
          record_worker_status "$worker_id" "$task_id" "TESTING" "aggregate staged; pending post-aggregate audit"
          advanced=$((advanced + 1))
          continue
        fi
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition IN_PROGRESS->TESTING failed after aggregate staging")
        continue
      fi
      if ! acl_allow "worker-delivery" "write" "$task_dir/work.md" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied worker write work")
        continue
      fi
      if [[ -n "$run_root" ]]; then
        if ! "$ENV_BUILD_SCRIPT" "$run_root" >/dev/null 2>&1; then
          failed=$((failed + 1))
          failed_lines+=("$task_id: workspace env build failed")
          continue
        fi
      fi
      if [[ "$SANDBOX_ENABLED" == "true" ]]; then
        if ! "$SANDBOX_SCRIPT" --role "worker-delivery" --task-id "$task_id" --workspace-root "$workspace_root" --run-root "$run_root" --runtime-profile "$runtime_profile_project" -- "$WORKER_SCRIPT" "$task_dir" >/dev/null 2>&1; then
          worker_rc=1
        else
          worker_rc=0
        fi
      elif ! "$WORKER_SCRIPT" "$task_dir" >/dev/null 2>&1; then
        worker_rc=1
      else
        worker_rc=0
      fi
      if [[ "$worker_rc" -ne 0 ]]; then
        {
          echo "# Clarification Request"
          echo
          echo "- Task: $task_id"
          echo "- Issue: deterministic worker could not map goal to an implementation template"
          echo "- Requested action: planner should provide retry guidance or route to LLM-backed worker"
          echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        } > "$task_dir/clarification_request.md"
        if run_transition "$task_dir" "worker-delivery" "IN_PROGRESS" "BLOCKED_AWAITING_CLARIFICATION" "orchestrator: worker unsupported goal, requires clarification" "$task_id"; then
          record_worker_status "$worker_id" "$task_id" "BLOCKED_AWAITING_CLARIFICATION" "unsupported goal; waiting for planner clarification"
          record_worker_lifecycle "$worker_id" "$task_id" "BLOCKED" "ACTIVE" "worker could not map deterministic template"
          advanced=$((advanced + 1))
          continue
        fi
        failed=$((failed + 1))
        failed_lines+=("$task_id: worker delivery failed")
        record_worker_status "$worker_id" "$task_id" "FAILED" "worker delivery failed"
        record_worker_lifecycle "$worker_id" "$task_id" "DELIVERY_FAILED" "ACTIVE" "worker implementation failed"
        continue
      fi
      sanitize_worker_submission_files "$task_dir"
      if ! assert_worker_submission_with_log "$task_dir" "$task_id" "$worker_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: worker submission missing mandatory log or evidence")
        record_worker_status "$worker_id" "$task_id" "FAILED" "submission rejected: missing work log/evidence"
        record_worker_lifecycle "$worker_id" "$task_id" "SUBMISSION_REJECTED" "ACTIVE" "work log missing at submission"
        continue
      fi
      if ! sync_delivery_to_run_root "$task_dir" "$run_root" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied worker delivery sync to run_root")
        continue
      fi
      if [[ "$COMMIT_GUARD_ENABLED" == "true" ]]; then
        if ! "$COMMIT_GUARD_SCRIPT" --task-id "$task_id" --run-root "$run_root" --role "worker-delivery" --tasks-root "$TASKS_ROOT" >/dev/null 2>&1; then
          failed=$((failed + 1))
          failed_lines+=("$task_id: commit guard denied workspace changes")
          continue
        fi
      fi
      if ! acl_allow "worker-delivery" "write" "$task_dir/meta.json" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied worker transition IN_PROGRESS->TESTING")
        continue
      fi
      if ! run_transition "$task_dir" "worker-delivery" "IN_PROGRESS" "TESTING" "orchestrator: moved to testing" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition IN_PROGRESS->TESTING failed")
        record_worker_status "$worker_id" "$task_id" "FAILED" "failed moving to testing"
        continue
      fi
      record_worker_status "$worker_id" "$task_id" "TESTING" "delivery submitted with worker log"
      record_worker_lifecycle "$worker_id" "$task_id" "SUBMITTED" "ACTIVE" "delivery + work log submitted"
      advanced=$((advanced + 1))
      ;;
    REJECTED)
      if is_retryable_goal "$goal"; then
        append_if_missing "$task_dir/work.md" "- Retry evidence: retry requested by orchestrator after transient failure"
        append_if_missing "$task_dir/work.md" "- Latest action: retry requested by orchestrator"
        append_event_nonfatal "$task_dir" "$SCHEDULING_ACTOR" "SCHEDULER_RETRY_TRIGGERED" "scheduler triggered retry for rejected task" "REJECTED" "IN_PROGRESS"
        if ! run_transition "$task_dir" "$SCHEDULING_ACTOR" "REJECTED" "IN_PROGRESS" "orchestrator: retry rejected task with deterministic template" "$task_id"; then
          failed=$((failed + 1))
          failed_lines+=("$task_id: transition REJECTED->IN_PROGRESS failed")
          record_worker_status "$worker_id" "$task_id" "FAILED" "failed reopening rejected task"
          continue
        fi
        record_worker_status "$worker_id" "$task_id" "IN_PROGRESS" "reopened after rejection"
        record_worker_lifecycle "$worker_id" "$task_id" "REOPENED" "ACTIVE" "scheduler reopened rejected task for retry"
        advanced=$((advanced + 1))
      fi
      ;;
    TESTING)
      if [[ "$is_parent" == true ]]; then
        blocked_child=""
        all_children_closed=true
        for child_id in "${children[@]}"; do
          child_meta="$TASKS_ROOT/$child_id/meta.json"
          if [[ ! -f "$child_meta" ]]; then
            all_children_closed=false
            continue
          fi
          child_state="$(jq -r '.state // ""' "$child_meta")"
          if [[ "$child_state" == BLOCKED_* ]]; then
            blocked_child="$child_id:$child_state"
            break
          fi
          if [[ "$child_state" != "CLOSED" ]]; then
            all_children_closed=false
          fi
        done
        if [[ -n "$blocked_child" ]]; then
          {
            echo "# Clarification Request"
            echo
            echo "- Task: $task_id"
            echo "- Issue: child task blocked during aggregate execution"
            echo "- Blocked child: $blocked_child"
            echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
          } > "$task_dir/clarification_request.md"
          if run_transition "$task_dir" "worker-delivery" "TESTING" "BLOCKED_AWAITING_CLARIFICATION" "orchestrator: blocked child in aggregate flow" "$task_id"; then
            record_worker_status "$worker_id" "$task_id" "BLOCKED_AWAITING_CLARIFICATION" "aggregate blocked by child"
            advanced=$((advanced + 1))
            continue
          fi
        fi
        if [[ "$all_children_closed" != true || ${#children[@]} -eq 0 ]]; then
          continue
        fi
        if [[ -z "$run_root" || ! -d "$run_root" ]]; then
          append_if_missing "$task_dir/audit.md" "- Aggregate audit failed: parent run_root missing"
          update_aggregate_meta "$task_dir" "audited_fail" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "missing run_root for aggregate audit"
          if run_transition "$task_dir" "audit-guard" "TESTING" "BLOCKED_PENDING_APPROVAL" "orchestrator: aggregate audit failed missing run_root" "$task_id"; then
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: missing run_root for aggregate audit")
          continue
        fi

        if audit_aggregate_release "$task_dir" "$run_root" >/dev/null 2>&1; then
          update_aggregate_meta "$task_dir" "audited_pass" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" ""
          append_if_missing "$task_dir/audit.md" "- Aggregate audit: PASS"
          write_parent_tester_pass "$task_dir" "$task_id"
          append_event_nonfatal "$task_dir" "audit-guard" "AGGREGATE_AUDIT_PASS" "aggregate post-merge audit passed" "TESTING" "APPROVED"
          if run_transition "$task_dir" "tester-ephemeral" "TESTING" "APPROVED" "orchestrator: aggregate audit passed" "$task_id"; then
            record_worker_status "$worker_id" "$task_id" "APPROVED" "aggregate post-merge audit passed"
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: transition TESTING->APPROVED failed after aggregate audit pass")
          continue
        fi

        aggregate_reason="aggregate audit failed"
        promote_or_rollback_aggregate "$task_dir" "$run_root" "rollback" "$aggregate_reason" >/dev/null 2>&1 || true
        update_aggregate_meta "$task_dir" "rolled_back" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "$aggregate_reason"
        append_if_missing "$task_dir/audit.md" "- Aggregate audit: FAIL"
        append_event_nonfatal "$task_dir" "audit-guard" "AGGREGATE_AUDIT_FAIL" "$aggregate_reason" "TESTING" "BLOCKED_PENDING_APPROVAL"
        if run_transition "$task_dir" "audit-guard" "TESTING" "BLOCKED_PENDING_APPROVAL" "orchestrator: aggregate audit failed" "$task_id"; then
          advanced=$((advanced + 1))
          continue
        fi
        failed=$((failed + 1))
        failed_lines+=("$task_id: aggregate audit failed")
        continue
      fi
      if ! acl_allow "tester-ephemeral" "write" "$task_dir/test.md" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied tester write result")
        continue
      fi
      if [[ "$SANDBOX_ENABLED" == "true" ]]; then
        if ! "$SANDBOX_SCRIPT" --role "tester-ephemeral" --task-id "$task_id" --workspace-root "$workspace_root" --run-root "$run_root" --runtime-profile "$runtime_profile_project" -- "$TESTER_SCRIPT" "$task_dir" >/dev/null 2>&1; then
          tester_rc=1
        else
          tester_rc=0
        fi
      elif "$TESTER_SCRIPT" "$task_dir" >/dev/null 2>&1; then
        tester_rc=0
      else
        tester_rc=1
      fi
      if [[ "$tester_rc" -ne 0 ]]; then
        op_id="op_orchestrate_${task_id}_TESTING_REJECTED_$(date -u +%Y%m%d%H%M%S)_$$"
        "$TRANSITION_SCRIPT" "$task_dir" "tester-ephemeral" "$op_id" "TESTING" "REJECTED" "orchestrator: tester rejected" >/dev/null 2>&1 || true
        failed=$((failed + 1))
        failed_lines+=("$task_id: tester failed; moved to REJECTED")
        record_worker_status "$worker_id" "$task_id" "REJECTED" "tester failed"
        record_worker_lifecycle "$worker_id" "$task_id" "REJECTED" "ACTIVE" "tester rejected delivery"
        continue
      fi
      if ! run_transition "$task_dir" "tester-ephemeral" "TESTING" "APPROVED" "orchestrator: tester approved" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition TESTING->APPROVED failed")
        record_worker_status "$worker_id" "$task_id" "FAILED" "failed moving to approved"
        continue
      fi
      record_worker_status "$worker_id" "$task_id" "APPROVED" "tester passed"
      record_worker_lifecycle "$worker_id" "$task_id" "VERIFIED" "ACTIVE" "tester approved delivery"
      advanced=$((advanced + 1))
      ;;
    APPROVED)
      if [[ "$is_parent" == true ]]; then
        if [[ -z "$run_root" || ! -d "$run_root" ]]; then
          append_if_missing "$task_dir/audit.md" "- Aggregate publish failed: parent run_root missing"
          update_aggregate_meta "$task_dir" "audited_fail" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "missing run_root for aggregate publish"
          if run_transition "$task_dir" "agent-orchestrator" "APPROVED" "BLOCKED_SYSTEM_ERROR" "orchestrator: aggregate publish failed missing run_root" "$task_id"; then
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: missing run_root for aggregate publish")
          continue
        fi

        if ! promote_or_rollback_aggregate "$task_dir" "$run_root" "promote" "aggregate publish after audit pass" >/dev/null 2>&1; then
          append_if_missing "$task_dir/audit.md" "- Aggregate publish failed: promote error"
          append_event_nonfatal "$task_dir" "agent-orchestrator" "AGGREGATE_PROMOTE_FAIL" "aggregate promote failed" "APPROVED" "BLOCKED_SYSTEM_ERROR"
          update_aggregate_meta "$task_dir" "audited_fail" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" "aggregate promote failed"
          if run_transition "$task_dir" "agent-orchestrator" "APPROVED" "BLOCKED_SYSTEM_ERROR" "orchestrator: aggregate promote failed" "$task_id"; then
            advanced=$((advanced + 1))
            continue
          fi
          failed=$((failed + 1))
          failed_lines+=("$task_id: aggregate promote failed")
          continue
        fi

        update_aggregate_meta "$task_dir" "published" "$run_root/delivery_staging" "$run_root/delivery_staging_manifest.json" "$task_dir/aggregate_audit.json" ""
        append_if_missing "$task_dir/audit.md" "- Gate decision: APPROVED"
        append_if_missing "$task_dir/audit.md" "- Notes: aggregate publish promoted from staging"
        append_event_nonfatal "$task_dir" "agent-orchestrator" "AGGREGATE_PROMOTED" "aggregate staging promoted to delivery" "APPROVED" "CLOSED"
        if run_transition "$task_dir" "agent-orchestrator" "APPROVED" "CLOSED" "orchestrator: aggregate publish complete" "$task_id"; then
          "$RECORD_COMPLETED_CONTEXT_SCRIPT" "$task_dir" >/dev/null 2>&1 || true
          record_worker_status "$worker_id" "$task_id" "CLOSED" "aggregate workflow complete"
          record_worker_lifecycle "$worker_id" "$task_id" "EXPIRED" "RETIRED" "parent aggregate completed"
          advanced=$((advanced + 1))
          continue
        fi
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition APPROVED->CLOSED failed after aggregate publish")
        continue
      fi
      if ! acl_allow "audit-guard" "write" "$task_dir/audit.md" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: acl denied audit write")
        continue
      fi
      append_if_missing "$task_dir/audit.md" "- Gate decision: APPROVED"
      append_if_missing "$task_dir/audit.md" "- Notes: close by orchestrator loop"
      if [[ -n "$run_root" && -d "$run_root" ]]; then
        if ! acl_allow "audit-guard" "read" "$run_root" "$task_id"; then
          failed=$((failed + 1))
          failed_lines+=("$task_id: acl denied audit read workspace/run_root")
          continue
        fi
        "$AUDIT_WS_DELTA_SCRIPT" "$task_dir" >/dev/null 2>&1 || true
      fi
      if ! run_transition "$task_dir" "agent-orchestrator" "APPROVED" "CLOSED" "orchestrator: workflow complete" "$task_id"; then
        failed=$((failed + 1))
        failed_lines+=("$task_id: transition APPROVED->CLOSED failed")
        record_worker_status "$worker_id" "$task_id" "FAILED" "failed closing task"
        continue
      fi
      "$RECORD_COMPLETED_CONTEXT_SCRIPT" "$task_dir" >/dev/null 2>&1 || true
      record_worker_status "$worker_id" "$task_id" "CLOSED" "workflow complete"
      record_worker_lifecycle "$worker_id" "$task_id" "EXPIRED" "RETIRED" "task completed; worker retired"
      advanced=$((advanced + 1))
      ;;
    *)
      ;;
  esac
  if [[ "$ONLY_ONE_TASK" == true && -z "$TARGET_TASK_ID" ]]; then
    break
  fi
done < <(find "$TASKS_ROOT" -mindepth 2 -maxdepth 2 -name meta.json -print0 | sort -z)

"$DASHBOARD_SCRIPT" "$TASKS_ROOT" "$ROOT/templates/coordination/orchestrator/dashboard.md" "$ROOT/templates/coordination/orchestrator/dashboard.json" >/dev/null
DENIED_PATH_REL="$(jq -r '.security.denied_events_path // "templates/coordination/security/acl_denied.ndjson"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/acl_denied.ndjson")"
DENIED_PATH="$ROOT/$DENIED_PATH_REL"
ACL_DENIED_COUNT=0
ACL_LAST_DENIED_AT=""
if [[ -f "$DENIED_PATH" ]]; then
  ACL_DENIED_COUNT="$(wc -l < "$DENIED_PATH" | tr -d '[:space:]')"
  ACL_LAST_DENIED_AT="$(tail -n 1 "$DENIED_PATH" | jq -r '.timestamp // ""' 2>/dev/null || true)"
fi

if [[ $failed -gt 0 ]]; then
  jq -cn \
    --arg status "partial" \
    --argjson processed "$processed" \
    --argjson advanced "$advanced" \
    --argjson failed "$failed" \
    --arg policy_mode "$POLICY_MODE" \
    --arg dispatch_role "$DISPATCH_ROLE" \
    --argjson acl_denied_count "$ACL_DENIED_COUNT" \
    --arg acl_last_denied_at "$ACL_LAST_DENIED_AT" \
    --arg sandbox_status "$([[ \"$SANDBOX_ENABLED\" == \"true\" ]] && echo enabled || echo disabled)" \
    --arg commit_guard_status "$([[ \"$COMMIT_GUARD_ENABLED\" == \"true\" ]] && echo enabled || echo disabled)" \
    --arg kb_import_confirm_required "$KB_CONFIRM_REQUIRED" \
    --arg kb_import_auto_enabled "$KB_AUTO_ENABLED" \
    --arg workspace_sync_sensitivity "$WS_SYNC_SENSITIVITY" \
    --argjson failures "$(printf '%s\n' "${failed_lines[@]-}" | jq -R . | jq -s .)" \
    '{status:$status,processed:$processed,advanced:$advanced,failed:$failed,policy_mode:$policy_mode,dispatch_role:$dispatch_role,sandbox_status:$sandbox_status,commit_guard_status:$commit_guard_status,kb_import_confirm_required:$kb_import_confirm_required,kb_import_auto_enabled:$kb_import_auto_enabled,workspace_sync_sensitivity:$workspace_sync_sensitivity,acl_denied_count:$acl_denied_count,acl_last_denied_at:$acl_last_denied_at,failures:$failures}'
  exit 1
fi

jq -cn \
  --arg status "ok" \
  --argjson processed "$processed" \
  --argjson advanced "$advanced" \
  --arg policy_mode "$POLICY_MODE" \
  --arg dispatch_role "$DISPATCH_ROLE" \
  --argjson acl_denied_count "$ACL_DENIED_COUNT" \
  --arg acl_last_denied_at "$ACL_LAST_DENIED_AT" \
  --arg sandbox_status "$([[ \"$SANDBOX_ENABLED\" == \"true\" ]] && echo enabled || echo disabled)" \
  --arg commit_guard_status "$([[ \"$COMMIT_GUARD_ENABLED\" == \"true\" ]] && echo enabled || echo disabled)" \
  --arg kb_import_confirm_required "$KB_CONFIRM_REQUIRED" \
  --arg kb_import_auto_enabled "$KB_AUTO_ENABLED" \
  --arg workspace_sync_sensitivity "$WS_SYNC_SENSITIVITY" \
  '{status:$status,processed:$processed,advanced:$advanced,policy_mode:$policy_mode,dispatch_role:$dispatch_role,sandbox_status:$sandbox_status,commit_guard_status:$commit_guard_status,kb_import_confirm_required:$kb_import_confirm_required,kb_import_auto_enabled:$kb_import_auto_enabled,workspace_sync_sensitivity:$workspace_sync_sensitivity,acl_denied_count:$acl_denied_count,acl_last_denied_at:$acl_last_denied_at}'
