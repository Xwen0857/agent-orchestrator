#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TEMPLATE_ROOT="$ROOT/agent-orchestrator/scripts"
TASK_DIR="$1"
META="$TASK_DIR/meta.json"
RUNTIME_VIEW="$TASK_DIR/worker_runtime_view.json"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi
if [[ ! -f "$RUNTIME_VIEW" ]]; then
  echo "worker runtime view missing: $RUNTIME_VIEW"
  exit 1
fi
if ! jq -e '
  .schema_version == "worker-runtime-view-v1" and
  (.selected_template | type == "object") and
  (.lifecycle_governance | type == "object") and
  (.template_selector | type == "object") and
  (.template_selector.implementation_topology | type == "object")
' "$RUNTIME_VIEW" >/dev/null 2>&1; then
  echo "invalid worker runtime view: $RUNTIME_VIEW"
  exit 1
fi

TASK_ID="$(jq -r '.id // ""' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing in meta"; exit 1; }

LATEST_AMENDMENT="$(jq -r '.latest_requirement_amendment // ""' "$META" 2>/dev/null || true)"
HANDLER_ERROR=""
HANDLER_RESULT_JSON=""
HANDLER_SUMMARY=""
HANDLER_CHANGED_FILES=""
HANDLER_TEST_COMMAND=""
HANDLER_DELIVERY_MANIFEST=""
HANDLER_EVIDENCE_NOTES=""
WORKSPACE_STATS_JSON='{"bytes_used":0,"file_count":0,"max_single_file_bytes":0}'
EXPORTED_ATTACHMENTS_JSON='[]'
EXPORTED_EXPORT_RECORDS_JSON='[]'
EXPORTED_COUNT=0
LAST_FAULT_CLASS=""
WORKER_STAGE_OVERFLOW_STATUS="ok"
WORKER_STAGE_ISOLATION_MODE="wrapper_enforced"
WORKER_STAGE_RUNTIME_CLASS="default_shell"
WORKER_STAGE_ALLOWED_EXECUTION_MODE="local_threads"
CUSTOM_RUNTIME_GATE_STATUS="not_applicable"
CUSTOM_CAPABILITY_GATE_REASON=""
WORKER_STAGE_LAST_EXPORT_STATUS="not_run"
WORKER_STAGE_LAST_EXPORT_MANIFEST_CLASS="(none)"
WORKER_STAGE_RETENTION_RESULT_JSON='{}'
WORKER_STAGE_LAST_CLEANUP_AT=""
WORKER_STAGE_LAST_RETAINED_ARTIFACT_IDS_JSON='[]'
WORKER_STAGE_ARCHIVE_READY="false"
WORKER_STAGE_RECLAIM_READY="false"
WORKER_STAGE_PURGE_READY="false"
WORKER_STAGE_RETENTION_DECISION=""
TASK_SCOPE_SNAPSHOT=""
CURRENT_STATUS="failure"
DELIVERY_EXPORT_RECORDS_PATH=""

normalize_template_id() {
  printf '%s' "$1" | tr -c '[:alnum:]_-' '_'
}

normalize_relative_path() {
  python3 - "$1" <<'PY'
import os
import posixpath
import sys

raw = sys.argv[1].strip().replace("\\", "/")
normalized = posixpath.normpath(raw)
if normalized in ("", "."):
    print("")
elif normalized.startswith("../") or normalized == ".." or normalized.startswith("/"):
    print("")
else:
    print(normalized)
PY
}

json_stringify_array() {
  python3 - <<'PY'
import json
import sys
print(json.dumps(sys.stdin.read().splitlines()))
PY
}

update_meta_json() {
  local filter="${!#}"
  local tmp
  tmp="$(mktemp "$TASK_DIR/.meta.worker.XXXXXX.json")"
  jq "${@:1:$(($# - 1))}" "$filter" "$META" > "$tmp"
  mv "$tmp" "$META"
}

write_json_atomic() {
  local target_path="$1"
  local payload="$2"
  local tmp
  mkdir -p "$(dirname "$target_path")"
  tmp="$(mktemp "$TASK_DIR/.json.write.XXXXXX")"
  printf '%s\n' "$payload" > "$tmp"
  mv "$tmp" "$target_path"
}

append_worker_evidence() {
  local action="$1"
  local changed="$2"
  local manifest="$3"
  local notes="$4"
  {
    echo "- Latest action: $action"
    echo "- Changed files: $changed"
    if [[ -n "$manifest" ]]; then
      echo "- Delivery manifest: $manifest"
    fi
    if [[ -n "$notes" ]]; then
      echo "- Evidence notes: $notes"
    fi
    echo "- Evidence: worker template executed through runtime-selected handler"
    if [[ -n "$LATEST_AMENDMENT" ]]; then
      echo "- Amendment applied: $LATEST_AMENDMENT"
    fi
  } >> "$TASK_DIR/work.md"
}

append_test_command() {
  local cmd="$1"
  if [[ -z "$cmd" ]]; then
    return
  fi
  if ! grep -Fq "$cmd" "$TASK_DIR/test.md" 2>/dev/null; then
    {
      echo "- Commands: $cmd"
      echo "- Evidence: test command prepared by selected worker template"
    } >> "$TASK_DIR/test.md"
  fi
}

report_convergence() {
  local convergence_class="$1"
  local confidence="$2"
  local progress_delta="$3"
  local remaining="$4"
  local reclaim_reason="$5"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  update_meta_json \
    --arg convergence_class "$convergence_class" \
    --argjson confidence "$confidence" \
    --argjson progress_delta "$progress_delta" \
    --arg remaining "$remaining" \
    --arg reclaim_reason "$reclaim_reason" \
    --arg now "$now" \
    '
      .worker_convergence = ((.worker_convergence // {}) + {
        convergence_class: $convergence_class,
        convergence_confidence: $confidence,
        progress_delta: $progress_delta,
        remaining_work_estimate: $remaining,
        reclaim_reason: $reclaim_reason,
        reported_at: $now
      })
      | .updated_at = $now
    '
}

record_workerstage_observability() {
  local bytes_used="$1"
  local file_count="$2"
  local overflow_status="$3"
  local exported_count="$4"
  local fault_class="$5"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  update_meta_json \
    --arg worker_stage_id "$WORKER_STAGE_ID" \
    --arg worker_stage_root "$WORKER_STAGE_ROOT" \
    --arg worker_stage_profile "$WORKER_STAGE_PROFILE" \
    --arg worker_stage_isolation_mode "$WORKER_STAGE_ISOLATION_MODE" \
    --arg worker_stage_runtime_class "$WORKER_STAGE_RUNTIME_CLASS" \
    --arg worker_stage_allowed_execution_mode "$WORKER_STAGE_ALLOWED_EXECUTION_MODE" \
    --arg worker_stage_overflow_policy "$WORKER_STAGE_OVERFLOW_POLICY" \
    --arg worker_stage_retention_policy "$WORKER_STAGE_RETENTION_POLICY" \
    --arg worker_stage_overflow_status "$overflow_status" \
    --arg worker_stage_last_export_status "$WORKER_STAGE_LAST_EXPORT_STATUS" \
    --arg worker_stage_last_export_manifest_class "$WORKER_STAGE_LAST_EXPORT_MANIFEST_CLASS" \
    --arg worker_stage_last_fault_class "$fault_class" \
    --arg worker_stage_last_cleanup_at "$WORKER_STAGE_LAST_CLEANUP_AT" \
    --arg cluster_root "$CLUSTER_ROOT" \
    --arg custom_runtime_gate_status "$CUSTOM_RUNTIME_GATE_STATUS" \
    --arg custom_capability_gate_reason "$CUSTOM_CAPABILITY_GATE_REASON" \
    --arg worker_stage_archive_ready "$WORKER_STAGE_ARCHIVE_READY" \
    --arg worker_stage_reclaim_ready "$WORKER_STAGE_RECLAIM_READY" \
    --arg worker_stage_purge_ready "$WORKER_STAGE_PURGE_READY" \
    --arg worker_stage_retention_decision "$WORKER_STAGE_RETENTION_DECISION" \
    --argjson worker_stage_max_bytes "$MAX_WORKER_STAGE_BYTES" \
    --argjson worker_stage_max_file_count "$MAX_WORKER_STAGE_FILE_COUNT" \
    --argjson worker_stage_max_single_file_bytes "$MAX_WORKER_STAGE_SINGLE_FILE_BYTES" \
    --argjson worker_stage_bytes_used "$bytes_used" \
    --argjson worker_stage_file_count "$file_count" \
    --argjson worker_stage_exported_artifact_count "$exported_count" \
    --argjson worker_stage_retention_result "$WORKER_STAGE_RETENTION_RESULT_JSON" \
    --argjson worker_stage_last_retained_artifact_ids "$WORKER_STAGE_LAST_RETAINED_ARTIFACT_IDS_JSON" \
    --arg now "$now" \
    '
      .worker_runtime = ((.worker_runtime // {}) + {
        custom_runtime_gate_status: $custom_runtime_gate_status,
        custom_capability_gate_reason: $custom_capability_gate_reason
      })
      | .worker_stage = ((.worker_stage // {}) + {
        worker_stage_id: $worker_stage_id,
        worker_stage_root: $worker_stage_root,
        worker_stage_profile: $worker_stage_profile,
        stage_isolation_mode: $worker_stage_isolation_mode,
        stage_runtime_class: $worker_stage_runtime_class,
        allowed_execution_mode: $worker_stage_allowed_execution_mode,
        allocation: ((.worker_stage.allocation // {}) + {
          worker_stage_max_bytes: $worker_stage_max_bytes,
          worker_stage_max_file_count: $worker_stage_max_file_count,
          worker_stage_max_single_file_bytes: $worker_stage_max_single_file_bytes,
          worker_stage_overflow_policy: $worker_stage_overflow_policy,
          worker_stage_bytes_used: $worker_stage_bytes_used,
          worker_stage_file_count: $worker_stage_file_count,
          worker_stage_overflow_status: $worker_stage_overflow_status
        }),
        retention: ((.worker_stage.retention // {}) + {
          worker_stage_retention_policy: $worker_stage_retention_policy,
          worker_stage_exported_artifact_count: $worker_stage_exported_artifact_count,
          worker_stage_last_export_status: $worker_stage_last_export_status,
          worker_stage_last_export_manifest_class: $worker_stage_last_export_manifest_class,
          worker_stage_last_fault_class: $worker_stage_last_fault_class,
          worker_stage_retention_result: $worker_stage_retention_result,
          worker_stage_last_cleanup_at: $worker_stage_last_cleanup_at,
          worker_stage_last_retained_artifact_ids: $worker_stage_last_retained_artifact_ids,
          worker_stage_archive_ready: ($worker_stage_archive_ready == "true"),
          worker_stage_reclaim_ready: ($worker_stage_reclaim_ready == "true"),
          worker_stage_purge_ready: ($worker_stage_purge_ready == "true"),
          worker_stage_retention_decision: $worker_stage_retention_decision
        })
      })
      | .runtime_worker_control = ((.runtime_worker_control // {}) + {
          archive_ready: ($worker_stage_archive_ready == "true"),
          reclaim_ready: ($worker_stage_reclaim_ready == "true"),
          purge_ready: ($worker_stage_purge_ready == "true"),
          retention_decision: $worker_stage_retention_decision
        })
      | .task_cluster = ((.task_cluster // {}) + {
          cluster_root: $cluster_root,
          workspace_root: (.task_cluster.workspace_root // $cluster_root)
        })
      | .updated_at = $now
    '
}

publish_cluster_message() {
  local message_type="$1"
  local target_role_types_json="$2"
  local summary="$3"
  local attachments_json="${4:-[]}"
  local now message_id mailbox_path archive_path
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  message_id="msg_${TASK_ID}_$(date -u +%Y%m%d%H%M%S)"
  mailbox_path="$(jq -r '.collaboration.mailbox_path // ""' "$RUNTIME_VIEW")"
  archive_path="$(jq -r '.collaboration.archive_path // ""' "$RUNTIME_VIEW")"
  [[ -n "$mailbox_path" ]] || return 0
  mkdir -p "$(dirname "$mailbox_path")"
  if [[ -n "$archive_path" ]]; then
    mkdir -p "$(dirname "$archive_path")"
    : > "$archive_path"
  fi
  jq -cn \
    --arg schema_version "task-cluster-message-v1" \
    --arg message_id "$message_id" \
    --arg task_id "$TASK_ID" \
    --arg message_type "$message_type" \
    --arg status "published" \
    --arg published_at "$now" \
    --arg summary "$summary" \
    --arg from_role_type "$(jq -r '.dispatch.role_type // "worker-delivery"' "$RUNTIME_VIEW")" \
    --argjson memberships "$(jq '.collaboration.memberships // []' "$RUNTIME_VIEW")" \
    --argjson target_role_types "$target_role_types_json" \
    --argjson attachments "$attachments_json" \
    '{
      schema_version: $schema_version,
      message_id: $message_id,
      task_id: $task_id,
      from_role_type: $from_role_type,
      message_type: $message_type,
      status: $status,
      summary: $summary,
      memberships: $memberships,
      target_role_types: $target_role_types,
      target_worker_ids: [],
      requires_ack: false,
      acknowledged_by: [],
      published_at: $published_at,
      expires_at: "",
      archive_policy: "manual_consume_then_archive",
      attachments: $attachments
    }' >> "$mailbox_path"
  printf '\n' >> "$mailbox_path"

  update_meta_json \
    --arg message_type "$message_type" \
    --arg now "$now" \
    --arg cluster_root "$CLUSTER_ROOT" \
    '
      .task_cluster = ((.task_cluster // {}) + {
        cluster_root: $cluster_root,
        workspace_root: (.task_cluster.workspace_root // $cluster_root),
        mailbox_path: (.task_cluster.mailbox_path // ""),
        archive_path: (.task_cluster.archive_path // "")
      })
      | .task_cluster.mailbox_counters = ((.task_cluster.mailbox_counters // {}) + {
          published: ((.task_cluster.mailbox_counters.published // 0) + 1),
          acknowledged: (.task_cluster.mailbox_counters.acknowledged // 0),
          consumed: (.task_cluster.mailbox_counters.consumed // 0),
          archived: (.task_cluster.mailbox_counters.archived // 0)
        })
      | .task_cluster.last_published_message_type = $message_type
      | .task_cluster.updated_at = $now
      | .updated_at = $now
    '
}

record_template_summary() {
  update_meta_json \
    --arg template_id "$SELECTED_TEMPLATE" \
    --arg template_origin "$TEMPLATE_ORIGIN" \
    --arg template_source_id "$TEMPLATE_SOURCE_ID" \
    --arg template_version "$TEMPLATE_VERSION" \
    --arg registration_source "$REGISTRATION_SOURCE" \
    --arg delivery_mode "$DELIVERY_MODE" \
    --arg template_kind "$TEMPLATE_KIND" \
    --arg governance_policy_id "$GOVERNANCE_POLICY_ID" \
    --arg result_contract_version "$REQUIRED_RESULT_CONTRACT_VERSION" \
    --arg default_message_type "$DEFAULT_MESSAGE_TYPE" \
    --arg worker_stage_id "$WORKER_STAGE_ID" \
    --arg worker_stage_root "$WORKER_STAGE_ROOT" \
    --arg worker_stage_profile "$WORKER_STAGE_PROFILE" \
    --arg worker_stage_isolation_mode "$WORKER_STAGE_ISOLATION_MODE" \
    --arg worker_stage_runtime_class "$WORKER_STAGE_RUNTIME_CLASS" \
    --arg worker_stage_allowed_execution_mode "$WORKER_STAGE_ALLOWED_EXECUTION_MODE" \
    --arg worker_stage_overflow_policy "$WORKER_STAGE_OVERFLOW_POLICY" \
    --arg worker_stage_retention_policy "$WORKER_STAGE_RETENTION_POLICY" \
    --arg cluster_root "$CLUSTER_ROOT" \
    --arg custom_runtime_gate_status "$CUSTOM_RUNTIME_GATE_STATUS" \
    --argjson worker_stage_max_bytes "$MAX_WORKER_STAGE_BYTES" \
    --argjson worker_stage_max_file_count "$MAX_WORKER_STAGE_FILE_COUNT" \
    --argjson worker_stage_max_single_file_bytes "$MAX_WORKER_STAGE_SINGLE_FILE_BYTES" \
    --argjson allowed_template_origins "$ALLOWED_TEMPLATE_ORIGINS_JSON" \
    --argjson custom_registration_required "$CUSTOM_REGISTRATION_REQUIRED_JSON" \
    --argjson default_target_role_types "$MAILBOX_TARGET_ROLE_TYPES_JSON" \
    '
      .worker_runtime = ((.worker_runtime // {}) + {
        selected_template_id: $template_id,
        selected_template_origin: $template_origin,
        selected_template_source_id: $template_source_id,
        template_version: $template_version,
        registration_source: $registration_source,
        delivery_mode: $delivery_mode,
        template_kind: $template_kind,
        governance_policy_id: $governance_policy_id,
        result_contract_version: $result_contract_version,
        allowed_template_origins: $allowed_template_origins,
        custom_registration_required: $custom_registration_required,
        default_message_type: $default_message_type,
        default_target_role_types: $default_target_role_types,
        runtime_view_path: "worker_runtime_view.json",
        cluster_root: $cluster_root,
        custom_runtime_gate_status: $custom_runtime_gate_status
      })
      | .worker_stage = ((.worker_stage // {}) + {
        worker_stage_id: $worker_stage_id,
        worker_stage_root: $worker_stage_root,
        worker_stage_profile: $worker_stage_profile,
        stage_isolation_mode: $worker_stage_isolation_mode,
        stage_runtime_class: $worker_stage_runtime_class,
        allowed_execution_mode: $worker_stage_allowed_execution_mode,
        allocation: ((.worker_stage.allocation // {}) + {
          worker_stage_max_bytes: $worker_stage_max_bytes,
          worker_stage_max_file_count: $worker_stage_max_file_count,
          worker_stage_max_single_file_bytes: $worker_stage_max_single_file_bytes,
          worker_stage_overflow_policy: $worker_stage_overflow_policy
        }),
        retention: ((.worker_stage.retention // {}) + {
          worker_stage_retention_policy: $worker_stage_retention_policy
        })
      })
      | .task_cluster = ((.task_cluster // {}) + {
          cluster_root: $cluster_root,
          workspace_root: (.task_cluster.workspace_root // $cluster_root)
        })
    '
}

run_handler() {
  local handler_path="$1"
  local output
  set +e
  output="$(
    cd "$WORKER_STAGE_RUNTIME_ROOT" && \
      ORCH_WORKER_STAGE_ID="$WORKER_STAGE_ID" \
      ORCH_WORKER_STAGE_ROOT="$WORKER_STAGE_ROOT" \
      ORCH_WORKER_STAGE_INPUTS_ROOT="$WORKER_STAGE_INPUTS_ROOT" \
      ORCH_WORKER_STAGE_RUNTIME_ROOT="$WORKER_STAGE_RUNTIME_ROOT" \
      ORCH_WORKER_STAGE_SCRATCH_ROOT="$WORKER_STAGE_SCRATCH_ROOT" \
      ORCH_WORKER_STAGE_DELIVERY_ROOT="$WORKER_STAGE_DELIVERY_ROOT" \
      ORCH_WORKER_STAGE_RUNTIME_CLASS="$WORKER_STAGE_RUNTIME_CLASS" \
      ORCH_WORKER_STAGE_ALLOWED_EXECUTION_MODE="$WORKER_STAGE_ALLOWED_EXECUTION_MODE" \
      "$handler_path" "$TASK_DIR" "$RUNTIME_VIEW" 2>&1
  )"
  local status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    HANDLER_ERROR="$output"
    return 1
  fi
  if ! printf '%s' "$output" | jq -e --arg required_schema_version "$REQUIRED_RESULT_CONTRACT_VERSION" '
    type == "object" and
    .schema_version == $required_schema_version and
    (.summary | type == "string") and
    (.test_command | type == "string") and
    (.changed_files | type == "array") and
    (.delivery_manifest | type == "array") and
    (.evidence_notes | type == "array")
  ' >/dev/null 2>&1; then
    HANDLER_ERROR="handler returned invalid json"
    return 1
  fi
  HANDLER_RESULT_JSON="$output"
  HANDLER_SUMMARY="$(printf '%s' "$output" | jq -r '.summary // ""')"
  HANDLER_CHANGED_FILES="$(printf '%s' "$output" | jq -r '(.changed_files // []) | join(", ")')"
  HANDLER_TEST_COMMAND="$(printf '%s' "$output" | jq -r '.test_command // ""')"
  HANDLER_DELIVERY_MANIFEST="$(printf '%s' "$output" | jq -r '(.delivery_manifest // []) | map(if type=="string" then . else (.path // "") end) | join(", ")')"
  HANDLER_EVIDENCE_NOTES="$(printf '%s' "$output" | jq -r '(.evidence_notes // []) | join(" | ")')"
  HANDLER_ERROR=""
}

prepare_workerstage_execution_shape() {
  mkdir -p "$WORKER_STAGE_DELIVERY_ROOT" "$WORKER_STAGE_SCRATCH_ROOT" "$WORKER_STAGE_INPUTS_ROOT" "$WORKER_STAGE_RUNTIME_ROOT"
  cp "$RUNTIME_VIEW" "$WORKER_STAGE_INPUTS_ROOT/worker_runtime_view.json"
  cp "$META" "$WORKER_STAGE_INPUTS_ROOT/meta.json"
  if [[ -f "$TASK_DIR/${TASK_ID}.strategy.json" ]]; then
    cp "$TASK_DIR/${TASK_ID}.strategy.json" "$WORKER_STAGE_INPUTS_ROOT/${TASK_ID}.strategy.json"
  fi
  chmod -R a-w "$WORKER_STAGE_INPUTS_ROOT" 2>/dev/null || true
}

compute_workspace_stats() {
  local root="$1"
  python3 - "$root" <<'PY'
import json
import os
import sys

root = sys.argv[1]
bytes_used = 0
file_count = 0
max_single = 0
if os.path.isdir(root):
    for base, _, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            bytes_used += size
            file_count += 1
            max_single = max(max_single, size)
print(json.dumps({
    "bytes_used": bytes_used,
    "file_count": file_count,
    "max_single_file_bytes": max_single,
}))
PY
}

capture_task_scope_snapshot() {
  local output_path="$1"
  python3 - "$TASK_DIR" "$WORKER_STAGE_ROOT" "$output_path" <<'PY'
import json
import os
import sys

task_dir, allowed_root, output_path = sys.argv[1:4]
task_dir = os.path.realpath(task_dir)
allowed_root = os.path.realpath(allowed_root)
snapshot = {}
for base, _, files in os.walk(task_dir):
    for name in files:
        path = os.path.realpath(os.path.join(base, name))
        if path.startswith(allowed_root + os.sep):
            continue
        rel = os.path.relpath(path, task_dir)
        try:
            st = os.stat(path)
        except OSError:
            continue
        snapshot[rel] = [st.st_size, int(st.st_mtime_ns)]
with open(output_path, "w", encoding="utf-8") as fh:
    json.dump(snapshot, fh, sort_keys=True)
PY
}

detect_forbidden_writes() {
  local baseline="$1"
  python3 - "$TASK_DIR" "$WORKER_STAGE_ROOT" "$baseline" <<'PY'
import json
import os
import sys

task_dir, allowed_root, baseline_path = sys.argv[1:4]
task_dir = os.path.realpath(task_dir)
allowed_root = os.path.realpath(allowed_root)
with open(baseline_path, "r", encoding="utf-8") as fh:
    baseline = json.load(fh)
current = {}
for base, _, files in os.walk(task_dir):
    for name in files:
        path = os.path.realpath(os.path.join(base, name))
        if path.startswith(allowed_root + os.sep):
            continue
        rel = os.path.relpath(path, task_dir)
        try:
            st = os.stat(path)
        except OSError:
            continue
        current[rel] = [st.st_size, int(st.st_mtime_ns)]
changes = sorted(rel for rel, info in current.items() if baseline.get(rel) != info)
removed = sorted(rel for rel in baseline.keys() if rel not in current)
violations = changes + removed
print(json.dumps(violations))
PY
}

build_retention_result_json() {
  local retention_decision="$1"
  local cleaned_paths_json="$2"
  local retained_paths_json="$3"
  jq -cn \
    --arg retention_decision "$retention_decision" \
    --argjson cleaned_paths "$cleaned_paths_json" \
    --argjson retained_paths "$retained_paths_json" \
    '{
      retention_decision: $retention_decision,
      cleaned_paths: $cleaned_paths,
      retained_paths: $retained_paths
    }'
}

file_mime_type() {
  local target="$1"
  file --mime-type -b "$target" 2>/dev/null || echo "application/octet-stream"
}

ensure_text_artifact() {
  local target="$1"
  if [[ ! -s "$target" ]]; then
    return 0
  fi
  LC_ALL=C grep -Iq . "$target"
}

validate_handler_evidence() {
  local result_json="$1"
  local role_layer="$2"
  local changed_count evidence_count
  changed_count="$(jq '(.changed_files // []) | length' <<<"$result_json")"
  evidence_count="$(jq '(.evidence_notes // []) | length' <<<"$result_json")"
  if [[ "$REQUIRE_EVIDENCE_SUMMARY" == "true" ]] && [[ "$(jq -r '.summary // ""' <<<"$result_json")" == "" ]]; then
    echo "missing summary"
    return 1
  fi
  if [[ "$REQUIRE_EVIDENCE_TEST_COMMAND" == "true" ]] && [[ "$(jq -r '.test_command // ""' <<<"$result_json")" == "" ]]; then
    if [[ "$ALLOW_MISSING_TEST_COMMAND_WITH_REASON" == "true" ]] && (( evidence_count > 0 )); then
      :
    else
      echo "missing test_command"
      return 1
    fi
  fi
  if [[ "$REQUIRE_EVIDENCE_CHANGED_FILES" == "true" ]] && (( changed_count == 0 )); then
    echo "missing changed_files"
    return 1
  fi
  if [[ "$REQUIRE_EVIDENCE_NOTES" == "true" ]] && (( evidence_count == 0 )); then
    echo "missing evidence_notes"
    return 1
  fi
  if [[ "$REQUIRE_EVIDENCE_RUNBOOK" == "true" ]]; then
    if ! jq -e '(.delivery_manifest // []) | any(if type=="string" then . == "delivery/RUNBOOK.md" else (.path // "") == "delivery/RUNBOOK.md" end)' <<<"$result_json" >/dev/null 2>&1; then
      echo "missing delivery/RUNBOOK.md"
      return 1
    fi
  fi
  return 0
}

record_fault_action_summary() {
  local fault_class="$1"
  local action="none"
  local retryable="false"
  local requires_rebuild="false"
  case "$fault_class" in
    worker_stage_exhausted)
      action="rebuild"
      requires_rebuild="true"
      ;;
    worker_stage_forbidden_write|worker_stage_attachment_policy_violation|worker_stage_export_manifest_invalid|worker_stage_binary_artifact_disallowed)
      action="block"
      ;;
    *)
      action="none"
      ;;
  esac
  update_meta_json \
    --arg action "$action" \
    --argjson retryable "$retryable" \
    --argjson requires_rebuild "$requires_rebuild" \
    '.runtime_worker_control = ((.runtime_worker_control // {}) + {
      last_worker_fault_action: $action,
      worker_fault_retryable: $retryable,
      worker_fault_requires_rebuild: $requires_rebuild
    })'
}

clear_fault_action_summary() {
  update_meta_json '
    .runtime_worker_control = ((.runtime_worker_control // {}) + {
      last_worker_fault_action: "none",
      worker_fault_retryable: false,
      worker_fault_requires_rebuild: false
    })'
}

record_fault_and_exit() {
  local fault_class="$1"
  local message="$2"
  local convergence_remaining="$3"
  local reclaim_reason="$4"
  LAST_FAULT_CLASS="$fault_class"
  WORKER_STAGE_OVERFLOW_STATUS="$fault_class"
  local bytes_used file_count
  bytes_used="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.bytes_used // 0')"
  file_count="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.file_count // 0')"
  append_worker_evidence "$message" "none" "" "$fault_class"
  report_convergence "stalled" "0.1" "0" "$convergence_remaining" "$reclaim_reason"
  cleanup_workerstage
  record_fault_action_summary "$fault_class"
  record_workerstage_observability "$bytes_used" "$file_count" "$WORKER_STAGE_OVERFLOW_STATUS" "$EXPORTED_COUNT" "$fault_class"
  echo "$message"
  exit 1
}

export_delivery_artifacts() {
  local manifest_json="$1"
  local attachments_json='[]'
  local export_records_json='[]'
  local count=0
  WORKER_STAGE_LAST_EXPORT_MANIFEST_CLASS="delivery_manifest"
  WORKER_STAGE_LAST_EXPORT_STATUS="exported"
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    local rel_path raw_path source_path rel_export_path dest_path size digest mime_type
    raw_path="$(printf '%s' "$item" | jq -r 'if type=="string" then . else (.path // "") end')"
    rel_path="$(normalize_relative_path "$raw_path")"
    [[ -n "$rel_path" ]] || record_fault_and_exit "worker_stage_export_manifest_invalid" "delivery manifest contains invalid path" "invalid_delivery_manifest" "runtime_capability_insufficient"
    if [[ "$rel_path" != delivery/* ]]; then
      record_fault_and_exit "worker_stage_export_manifest_invalid" "delivery manifest path must remain under delivery/" "invalid_delivery_manifest" "runtime_capability_insufficient"
    fi
    rel_export_path="${rel_path#delivery/}"
    source_path="$WORKER_STAGE_DELIVERY_ROOT/$rel_export_path"
    [[ -f "$source_path" ]] || record_fault_and_exit "worker_stage_export_manifest_invalid" "delivery manifest path missing from execution workspace: $rel_path" "invalid_delivery_manifest" "runtime_capability_insufficient"
    size="$(wc -c < "$source_path" | tr -d ' ')"
    if (( size > MAX_WORKER_STAGE_SINGLE_FILE_BYTES )); then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "worker_stage_exhausted" "delivery artifact exceeds max_single_file_bytes: $rel_path" "workspace_budget_exceeded" "runtime_capability_insufficient"
    fi
    if [[ "$ALLOW_BINARY_ARTIFACTS" != "true" ]] && ! ensure_text_artifact "$source_path"; then
      record_fault_and_exit "worker_stage_binary_artifact_disallowed" "binary artifact blocked by workspace governance: $rel_path" "binary_artifact_disallowed" "runtime_capability_insufficient"
    fi
    mime_type="$(file_mime_type "$source_path")"
    if [[ "$ALLOW_EXPORTED_ATTACHMENT_REFERENCES" != "true" ]]; then
      record_fault_and_exit "worker_stage_attachment_policy_violation" "mailbox attachment references are disabled by governance" "mailbox_attachment_policy_violation" "runtime_capability_insufficient"
    fi
    if (( size > MAX_ATTACHMENT_BYTES )); then
      record_fault_and_exit "worker_stage_attachment_policy_violation" "artifact exceeds mailbox attachment size limit: $rel_path" "mailbox_attachment_policy_violation" "runtime_capability_insufficient"
    fi
    if [[ "$mime_type" != text/* ]] && ! jq -e --arg mime_type "$mime_type" '.[] | select(. == $mime_type)' <<<"$ALLOWED_ATTACHMENT_TYPES_JSON" >/dev/null 2>&1; then
      record_fault_and_exit "worker_stage_attachment_policy_violation" "artifact type blocked by mailbox attachment policy: $rel_path ($mime_type)" "mailbox_attachment_policy_violation" "runtime_capability_insufficient"
    fi
    dest_path="$AUTHORITY_DELIVERY_DIR/$rel_export_path"
    mkdir -p "$(dirname "$dest_path")"
    cp "$source_path" "$dest_path"
    digest="$(shasum -a 256 "$dest_path" | awk '{print $1}')"
    attachments_json="$(
      jq -cn \
        --argjson current "$attachments_json" \
        --arg artifact_id "artifact_${WORKER_STAGE_ID}_$count" \
        --arg exported_path "delivery/$rel_export_path" \
        --arg digest "$digest" \
        --arg mime_type "$mime_type" \
        --arg export_class "delivery_manifest" \
        --argjson size "$size" \
        '$current + [{
          artifact_id: $artifact_id,
          exported_path: $exported_path,
          size_bytes: $size,
          digest_sha256: $digest,
          artifact_type: $mime_type,
          export_class: $export_class
        }]'
    )"
    export_records_json="$(
      jq -cn \
        --argjson current "$export_records_json" \
        --arg artifact_id "artifact_${WORKER_STAGE_ID}_$count" \
        --arg path "delivery/$rel_export_path" \
        --arg artifact_type "$mime_type" \
        --arg digest_sha256 "$digest" \
        --arg export_class "delivery_manifest" \
        --arg exported_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --argjson size_bytes "$size" \
        '$current + [{
          artifact_id: $artifact_id,
          path: $path,
          artifact_type: $artifact_type,
          size_bytes: $size_bytes,
          digest_sha256: $digest_sha256,
          export_class: $export_class,
          exported_at: $exported_at,
          consumption_status: "available",
          archive_status: "active",
          retention_status: "retained",
          archive_manifest_path: "",
          consumed_at: "",
          archived_at: "",
          purged_at: "",
          last_lifecycle_action: "exported"
        }]'
    )"
    count=$((count + 1))
  done < <(printf '%s' "$manifest_json" | jq -c '.[]')
  EXPORTED_ATTACHMENTS_JSON="$attachments_json"
  EXPORTED_EXPORT_RECORDS_JSON="$export_records_json"
  EXPORTED_COUNT="$count"
  WORKER_STAGE_LAST_RETAINED_ARTIFACT_IDS_JSON="$(jq -c 'map(.artifact_id)' <<<"$export_records_json")"
  write_json_atomic "$DELIVERY_EXPORT_RECORDS_PATH" "$export_records_json"
}

update_export_records_lifecycle() {
  local archive_status="$1"
  local retention_status="$2"
  local action="$3"
  local archive_manifest_path="${4:-}"
  local purge_now="${5:-false}"
  [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]] || return 0
  local now tmp
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  tmp="$(mktemp "$TASK_DIR/.export.lifecycle.XXXXXX.json")"
  jq \
    --arg archive_status "$archive_status" \
    --arg retention_status "$retention_status" \
    --arg action "$action" \
    --arg archive_manifest_path "$archive_manifest_path" \
    --arg now "$now" \
    --arg purge_now "$purge_now" \
    'map(
      .archive_status = $archive_status
      | .retention_status = $retention_status
      | .archive_manifest_path = (if $archive_manifest_path == "" then (.archive_manifest_path // "") else $archive_manifest_path end)
      | .archived_at = (if $archive_status == "archived" then $now else (.archived_at // "") end)
      | .purged_at = (if $purge_now == "true" then $now else (.purged_at // "") end)
      | .last_lifecycle_action = $action
    )' \
    "$DELIVERY_EXPORT_RECORDS_PATH" > "$tmp" && mv "$tmp" "$DELIVERY_EXPORT_RECORDS_PATH"
}

write_archive_manifest() {
  local manifest_path="$1"
  [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]] || return 1
  local payload
  payload="$(
    jq -cn \
      --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      --arg task_id "$TASK_ID" \
      --arg worker_stage_id "$WORKER_STAGE_ID" \
      --argjson artifacts "$(cat "$DELIVERY_EXPORT_RECORDS_PATH")" \
      '{
        schema_version: "worker-stage-archive-manifest-v1",
        generated_at: $generated_at,
        task_id: $task_id,
        worker_stage_id: $worker_stage_id,
        artifacts: $artifacts
      }'
  )"
  write_json_atomic "$manifest_path" "$payload"
}

archive_exported_artifacts() {
  [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]] || return 0
  local archive_root="$TASK_DIR/delivery.archive"
  local manifest_path="$archive_root/archive-manifest.json"
  local item artifact_path rel_path archive_path
  mkdir -p "$archive_root"
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    rel_path="$(printf '%s' "$item" | jq -r '.path // ""')"
    artifact_path="$TASK_DIR/$rel_path"
    [[ -f "$artifact_path" ]] || continue
    archive_path="$archive_root/${rel_path#delivery/}"
    mkdir -p "$(dirname "$archive_path")"
    cp "$artifact_path" "$archive_path"
  done < <(jq -c '.[]' "$DELIVERY_EXPORT_RECORDS_PATH")
  write_archive_manifest "$manifest_path"
  update_export_records_lifecycle "archived" "retained" "archived" "delivery.archive/archive-manifest.json" "false"
  WORKER_STAGE_ARCHIVE_READY="true"
}

purge_exported_artifacts_if_needed() {
  [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]] || return 0
  if [[ "$PURGE_ARTIFACTS_AFTER_ARCHIVE" != "true" ]]; then
    return 0
  fi
  local item rel_path artifact_path
  while IFS= read -r item; do
    [[ -n "$item" ]] || continue
    rel_path="$(printf '%s' "$item" | jq -r '.path // ""')"
    artifact_path="$TASK_DIR/$rel_path"
    rm -f "$artifact_path"
  done < <(jq -c '.[]' "$DELIVERY_EXPORT_RECORDS_PATH")
  update_export_records_lifecycle "archived" "archived_only" "purged_after_archive" "delivery.archive/archive-manifest.json" "true"
  WORKER_STAGE_PURGE_READY="true"
}

cleanup_workerstage() {
  local retention_decision cleaned_paths_json retained_paths_json now
  if [[ ! -d "$WORKER_STAGE_ROOT" ]]; then
    WORKER_STAGE_RETENTION_RESULT_JSON="$(build_retention_result_json "not_run" "[]" "[\"work.md\",\"test.md\",\"delivery/\",\"delivery.export-records.json\"]")"
    return
  fi
  chmod -R u+w "$WORKER_STAGE_ROOT" 2>/dev/null || true
  cleaned_paths_json='[]'
  retained_paths_json='["work.md","test.md","delivery/"]'
  if [[ "$CURRENT_STATUS" == "success" ]]; then
    retention_decision="$SUCCESS_CLEANUP_RULE"
    if [[ "$RETAIN_ON_SUCCESS" != "true" ]] && [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]]; then
      archive_exported_artifacts
      purge_exported_artifacts_if_needed
    fi
    if [[ "$retention_decision" == "retain_delivery_only" || "$PURGE_ON_SUCCESS" == "true" ]]; then
      rm -rf "$WORKER_STAGE_SCRATCH_ROOT" "$WORKER_STAGE_INPUTS_ROOT" "$WORKER_STAGE_RUNTIME_ROOT"
      cleaned_paths_json='["worker_stage/scratch","worker_stage/inputs","worker_stage/runtime"]'
    elif [[ "$retention_decision" == "purge_all" ]]; then
      rm -rf "$WORKER_STAGE_ROOT"
      cleaned_paths_json='["worker_stage/root"]'
      retained_paths_json='["work.md","test.md"]'
    elif [[ "$retention_decision" == "retain_all" ]]; then
      retained_paths_json='["work.md","test.md","delivery/","worker_stage/scratch","worker_stage/inputs","worker_stage/runtime"]'
    elif [[ "$retention_decision" == "retain_evidence_bundle" ]]; then
      rm -rf "$WORKER_STAGE_INPUTS_ROOT"
      cleaned_paths_json='["worker_stage/inputs"]'
      retained_paths_json='["work.md","test.md","delivery/","worker_stage/scratch","worker_stage/runtime"]'
    fi
    if [[ "$RETAIN_EXPORT_RECORDS_WHEN_STAGE_PURGED" == "true" && -f "$DELIVERY_EXPORT_RECORDS_PATH" ]]; then
      retained_paths_json="$(jq -cn --argjson current "$retained_paths_json" '$current + ["delivery.export-records.json"]')"
    elif [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]]; then
      rm -f "$DELIVERY_EXPORT_RECORDS_PATH"
      cleaned_paths_json="$(jq -cn --argjson current "$cleaned_paths_json" '$current + ["delivery.export-records.json"]')"
    fi
  else
    retention_decision="$FAILURE_CLEANUP_RULE"
    if [[ "$ARCHIVE_FAILED_EXPORT_EVIDENCE" == "true" ]] && [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]]; then
      archive_exported_artifacts
      purge_exported_artifacts_if_needed
    fi
    if [[ "$retention_decision" == "purge_all" || "$PURGE_ON_FAILURE" == "true" ]]; then
      rm -rf "$WORKER_STAGE_ROOT"
      cleaned_paths_json='["worker_stage/root"]'
      retained_paths_json='["work.md","test.md","fault_summary"]'
    elif [[ "$retention_decision" == "retain_delivery_only" ]]; then
      rm -rf "$WORKER_STAGE_SCRATCH_ROOT" "$WORKER_STAGE_INPUTS_ROOT" "$WORKER_STAGE_RUNTIME_ROOT"
      cleaned_paths_json='["worker_stage/scratch","worker_stage/inputs","worker_stage/runtime"]'
      retained_paths_json='["work.md","test.md","delivery/","fault_summary"]'
    elif [[ "$retention_decision" == "retain_evidence_bundle" ]]; then
      rm -rf "$WORKER_STAGE_INPUTS_ROOT"
      cleaned_paths_json='["worker_stage/inputs"]'
      retained_paths_json='["work.md","test.md","delivery/","fault_summary","worker_stage/scratch","worker_stage/runtime"]'
    elif [[ "$retention_decision" == "retain_all" ]]; then
      retained_paths_json='["work.md","test.md","delivery/","fault_summary","worker_stage/scratch","worker_stage/inputs","worker_stage/runtime"]'
    fi
    if [[ -f "$DELIVERY_EXPORT_RECORDS_PATH" ]]; then
      if [[ "$ARCHIVE_FAILED_EXPORT_EVIDENCE" == "true" || "$RETAIN_ON_FAILURE" == "true" || "$RETAIN_EXPORT_RECORDS_WHEN_STAGE_PURGED" == "true" ]]; then
        retained_paths_json="$(jq -cn --argjson current "$retained_paths_json" '$current + ["delivery.export-records.json"]')"
      else
        rm -f "$DELIVERY_EXPORT_RECORDS_PATH"
        cleaned_paths_json="$(jq -cn --argjson current "$cleaned_paths_json" '$current + ["delivery.export-records.json"]')"
      fi
    fi
  fi
  if [[ "$retention_decision" == "purge_all" ]]; then
    WORKER_STAGE_RECLAIM_READY="true"
  fi
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  WORKER_STAGE_LAST_CLEANUP_AT="$now"
  WORKER_STAGE_RETENTION_DECISION="$retention_decision"
  WORKER_STAGE_RETENTION_RESULT_JSON="$(build_retention_result_json "$retention_decision" "$cleaned_paths_json" "$retained_paths_json")"
}

SELECTED_TEMPLATE="$(jq -r '.selected_template.template_id // ""' "$RUNTIME_VIEW")"
TEMPLATE_ORIGIN="$(jq -r '.selected_template.template_origin // "builtin"' "$RUNTIME_VIEW")"
TEMPLATE_SOURCE_ID="$(jq -r '.selected_template.template_source_id // ""' "$RUNTIME_VIEW")"
TEMPLATE_VERSION="$(jq -r '.selected_template.template_version // ""' "$RUNTIME_VIEW")"
REGISTRATION_SOURCE="$(jq -r '.selected_template.registration_source // ""' "$RUNTIME_VIEW")"
DELIVERY_MODE="$(jq -r '.selected_template.delivery_mode // "unsupported_placeholder"' "$RUNTIME_VIEW")"
TEMPLATE_KIND="$(jq -r '.selected_template.template_kind // "placeholder"' "$RUNTIME_VIEW")"
DEFAULT_MESSAGE_TYPE="$(jq -r '.selected_template.default_message_type // "partial_deliverable"' "$RUNTIME_VIEW")"
HANDLER_SCRIPT_REL="$(jq -r '.selected_template.handler_script // ""' "$RUNTIME_VIEW")"
GOVERNANCE_POLICY_ID="$(jq -r '.lifecycle_governance.policy_id // ""' "$RUNTIME_VIEW")"
REQUIRED_RESULT_CONTRACT_VERSION="$(jq -r '.lifecycle_governance.result_governance.required_result_contract_version // "worker-template-result-contract-v1"' "$RUNTIME_VIEW")"
ALLOWED_TEMPLATE_ORIGINS_JSON="$(jq -c '.lifecycle_governance.template_governance.allowed_template_origins // []' "$RUNTIME_VIEW")"
CUSTOM_REGISTRATION_REQUIRED_JSON="$(jq -c '.lifecycle_governance.template_governance.require_enabled_custom_registration == true' "$RUNTIME_VIEW")"
SELECTED_CUSTOM_REGISTRATION_ENABLED="$(jq -r '.lifecycle_governance.template_governance.selected_custom_registration_enabled // false' "$RUNTIME_VIEW")"
MAILBOX_TARGET_ROLE_TYPES_JSON="$(jq -c '.lifecycle_governance.mailbox_governance.default_target_role_types // []' "$RUNTIME_VIEW")"
MAILBOX_MESSAGE_TYPE="$(jq -r '.lifecycle_governance.mailbox_governance.default_message_type // .selected_template.default_message_type // "partial_deliverable"' "$RUNTIME_VIEW")"
IMPLEMENTATION_ROLE_LAYER="$(jq -r '.implementation_topology.role_layer // "backend"' "$RUNTIME_VIEW")"
WORKER_STAGE_ID="$(jq -r '.worker_stage.worker_stage_id // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_ID" ]] || WORKER_STAGE_ID="workerstage_${TASK_ID}_$(jq -r '.dispatch.dispatch_seq // 1' "$RUNTIME_VIEW")"
WORKER_STAGE_ROOT="$(jq -r '.worker_stage.worker_stage_root // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_ROOT" ]] || WORKER_STAGE_ROOT="$TASK_DIR/worker_stages/$WORKER_STAGE_ID"
WORKER_STAGE_SCRATCH_ROOT="$(jq -r '.worker_stage.scratch_root // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_SCRATCH_ROOT" ]] || WORKER_STAGE_SCRATCH_ROOT="$WORKER_STAGE_ROOT/scratch"
WORKER_STAGE_DELIVERY_ROOT="$(jq -r '.worker_stage.delivery_root // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_DELIVERY_ROOT" ]] || WORKER_STAGE_DELIVERY_ROOT="$WORKER_STAGE_ROOT/delivery"
WORKER_STAGE_INPUTS_ROOT="$(jq -r '.worker_stage.inputs_root // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_INPUTS_ROOT" ]] || WORKER_STAGE_INPUTS_ROOT="$WORKER_STAGE_ROOT/inputs"
WORKER_STAGE_RUNTIME_ROOT="$(jq -r '.worker_stage.runtime_root // ""' "$RUNTIME_VIEW")"
[[ -n "$WORKER_STAGE_RUNTIME_ROOT" ]] || WORKER_STAGE_RUNTIME_ROOT="$WORKER_STAGE_ROOT/runtime"
WORKER_STAGE_PROFILE="$(jq -r '.worker_stage.worker_stage_profile // .lifecycle_governance.worker_stage_governance.worker_stage_profile // "normal"' "$RUNTIME_VIEW")"
WORKER_STAGE_ISOLATION_MODE="$(jq -r '.worker_stage.stage_isolation_mode // .lifecycle_governance.worker_stage_governance.stage_isolation_mode // "wrapper_enforced"' "$RUNTIME_VIEW")"
WORKER_STAGE_RUNTIME_CLASS="$(jq -r '.worker_stage.stage_runtime_class // .lifecycle_governance.worker_stage_governance.stage_runtime_class // "default_shell"' "$RUNTIME_VIEW")"
WORKER_STAGE_ALLOWED_EXECUTION_MODE="$(jq -r '.worker_stage.allowed_execution_mode // .lifecycle_governance.worker_stage_governance.allowed_execution_mode // .dispatch.mode // "local_threads"' "$RUNTIME_VIEW")"
MAX_WORKER_STAGE_BYTES="$(jq -r '.lifecycle_governance.worker_stage_governance.worker_stage_max_bytes // .worker_stage.allocation.worker_stage_max_bytes // 1000000' "$RUNTIME_VIEW")"
MAX_WORKER_STAGE_FILE_COUNT="$(jq -r '.lifecycle_governance.worker_stage_governance.worker_stage_max_file_count // .worker_stage.allocation.worker_stage_max_file_count // 128' "$RUNTIME_VIEW")"
MAX_WORKER_STAGE_SINGLE_FILE_BYTES="$(jq -r '.lifecycle_governance.worker_stage_governance.worker_stage_max_single_file_bytes // .worker_stage.allocation.worker_stage_max_single_file_bytes // 256000' "$RUNTIME_VIEW")"
ALLOW_BINARY_ARTIFACTS="$(jq -r '.lifecycle_governance.worker_stage_governance.allow_binary_artifacts // .worker_stage.allocation.allow_binary_artifacts // false' "$RUNTIME_VIEW")"
WORKER_STAGE_OVERFLOW_POLICY="$(jq -r '.lifecycle_governance.worker_stage_governance.worker_stage_overflow_policy // .worker_stage.allocation.worker_stage_overflow_policy // "block_write"' "$RUNTIME_VIEW")"
WORKER_STAGE_RETENTION_POLICY="$(jq -r '.lifecycle_governance.worker_stage_governance.worker_stage_retention_policy // .worker_stage.retention.worker_stage_retention_policy // "retain_delivery_only"' "$RUNTIME_VIEW")"
SUCCESS_CLEANUP_RULE="$(jq -r '.lifecycle_governance.worker_stage_governance.success_cleanup_rule // .worker_stage.retention.success_cleanup_rule // "retain_delivery_only"' "$RUNTIME_VIEW")"
FAILURE_CLEANUP_RULE="$(jq -r '.lifecycle_governance.worker_stage_governance.failure_cleanup_rule // .worker_stage.retention.failure_cleanup_rule // "retain_evidence_bundle"' "$RUNTIME_VIEW")"
PURGE_ON_SUCCESS="$(jq -r 'if .lifecycle_governance.worker_stage_governance.purge_on_success == true or .worker_stage.retention.purge_on_success == true then "true" elif .lifecycle_governance.worker_stage_governance.purge_on_success == false or .worker_stage.retention.purge_on_success == false then "false" else "true" end' "$RUNTIME_VIEW")"
PURGE_ON_FAILURE="$(jq -r 'if .lifecycle_governance.worker_stage_governance.purge_on_failure == true or .worker_stage.retention.purge_on_failure == true then "true" elif .lifecycle_governance.worker_stage_governance.purge_on_failure == false or .worker_stage.retention.purge_on_failure == false then "false" else "false" end' "$RUNTIME_VIEW")"
RETAIN_ON_SUCCESS="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.retain_on_success == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.retain_on_success == false then "false" else "true" end' "$RUNTIME_VIEW")"
RETAIN_ON_FAILURE="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.retain_on_failure == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.retain_on_failure == false then "false" else "true" end' "$RUNTIME_VIEW")"
ARCHIVE_ON_TESTER_CONSUME="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.archive_on_tester_consume == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.archive_on_tester_consume == false then "false" else "true" end' "$RUNTIME_VIEW")"
ARCHIVE_FAILED_EXPORT_EVIDENCE="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.archive_failed_export_evidence == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.archive_failed_export_evidence == false then "false" else "true" end' "$RUNTIME_VIEW")"
RETAIN_EXPORT_RECORDS_WHEN_STAGE_PURGED="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.retain_export_records_when_stage_purged == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.retain_export_records_when_stage_purged == false then "false" else "true" end' "$RUNTIME_VIEW")"
PURGE_ARTIFACTS_AFTER_ARCHIVE="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.purge_artifacts_after_archive == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.purge_artifacts_after_archive == false then "false" else "false" end' "$RUNTIME_VIEW")"
RETAIN_ARCHIVE_MANIFEST="$(jq -r 'if .lifecycle_governance.worker_stage_governance.export_policy.retain_archive_manifest == true then "true" elif .lifecycle_governance.worker_stage_governance.export_policy.retain_archive_manifest == false then "false" else "true" end' "$RUNTIME_VIEW")"
ALLOW_EXPORTED_ATTACHMENT_REFERENCES="$(jq -r 'if .lifecycle_governance.worker_stage_governance.mailbox_attachment_policy.allow_exported_artifact_references == true then "true" elif .lifecycle_governance.worker_stage_governance.mailbox_attachment_policy.allow_exported_artifact_references == false then "false" else "true" end' "$RUNTIME_VIEW")"
MAX_ATTACHMENT_BYTES="$(jq -r '.lifecycle_governance.worker_stage_governance.mailbox_attachment_policy.max_attachment_bytes // 5000000' "$RUNTIME_VIEW")"
ALLOWED_ATTACHMENT_TYPES_JSON="$(jq -c '.lifecycle_governance.worker_stage_governance.mailbox_attachment_policy.allowed_artifact_types // ["text/plain","text/markdown","application/json","application/x-python"]' "$RUNTIME_VIEW")"
EVIDENCE_PROFILE="$(jq -r '.lifecycle_governance.evidence_governance.evidence_profile // "backend_profile"' "$RUNTIME_VIEW")"
REQUIRE_EVIDENCE_SUMMARY="$(jq -r 'if .lifecycle_governance.evidence_governance.require_summary == true then "true" elif .lifecycle_governance.evidence_governance.require_summary == false then "false" else "true" end' "$RUNTIME_VIEW")"
REQUIRE_EVIDENCE_TEST_COMMAND="$(jq -r 'if .lifecycle_governance.evidence_governance.require_test_command == true then "true" elif .lifecycle_governance.evidence_governance.require_test_command == false then "false" else "true" end' "$RUNTIME_VIEW")"
REQUIRE_EVIDENCE_CHANGED_FILES="$(jq -r 'if .lifecycle_governance.evidence_governance.require_changed_files == true then "true" elif .lifecycle_governance.evidence_governance.require_changed_files == false then "false" else "true" end' "$RUNTIME_VIEW")"
REQUIRE_EVIDENCE_NOTES="$(jq -r 'if .lifecycle_governance.evidence_governance.require_evidence_notes == true then "true" elif .lifecycle_governance.evidence_governance.require_evidence_notes == false then "false" else "true" end' "$RUNTIME_VIEW")"
REQUIRE_EVIDENCE_RUNBOOK="$(jq -r 'if .lifecycle_governance.evidence_governance.require_runbook == true then "true" elif .lifecycle_governance.evidence_governance.require_runbook == false then "false" else "false" end' "$RUNTIME_VIEW")"
ALLOW_MISSING_TEST_COMMAND_WITH_REASON="$(jq -r 'if .lifecycle_governance.evidence_governance.allow_missing_test_command_with_reason == true then "true" elif .lifecycle_governance.evidence_governance.allow_missing_test_command_with_reason == false then "false" else "false" end' "$RUNTIME_VIEW")"
CLUSTER_ROOT="$(jq -r '.collaboration.cluster_root // .collaboration.workspace_root // ""' "$RUNTIME_VIEW")"
CUSTOM_RUNTIME_GATE_STATUS="$(jq -r '.lifecycle_governance.template_governance.selected_custom_runtime_gate_status // "not_applicable"' "$RUNTIME_VIEW")"
CUSTOM_CAPABILITY_GATE_REASON="$(jq -r '.lifecycle_governance.template_governance.selected_custom_capability_gate_reason // ""' "$RUNTIME_VIEW")"
AUTHORITY_DELIVERY_DIR="$TASK_DIR/delivery"
DELIVERY_EXPORT_RECORDS_PATH="$TASK_DIR/delivery.export-records.json"

prepare_workerstage_execution_shape
mkdir -p "$AUTHORITY_DELIVERY_DIR"

if ! jq -e --arg origin "$TEMPLATE_ORIGIN" '.lifecycle_governance.template_governance.allowed_template_origins // [] | index($origin) != null' "$RUNTIME_VIEW" >/dev/null 2>&1; then
  WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
  record_fault_and_exit "template_origin_rejected" "template origin rejected by lifecycle governance: $TEMPLATE_ORIGIN" "template_origin_rejected" "runtime_capability_insufficient"
fi

if [[ "$TEMPLATE_ORIGIN" == "custom" ]] && jq -e '.lifecycle_governance.template_governance.require_enabled_custom_registration == true' "$RUNTIME_VIEW" >/dev/null 2>&1; then
  if [[ "$SELECTED_CUSTOM_REGISTRATION_ENABLED" != "true" ]]; then
    WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
    record_fault_and_exit "custom_template_disabled" "custom template registration is not enabled for template: $SELECTED_TEMPLATE" "custom_template_registration_disabled" "runtime_capability_insufficient"
  fi
fi

if [[ "$TEMPLATE_ORIGIN" == "custom" ]] && [[ "$(jq -r '.lifecycle_governance.template_governance.selected_custom_runtime_gate_status // "not_applicable"' "$RUNTIME_VIEW")" == "blocked" ]]; then
  WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
  record_fault_and_exit "custom_template_runtime_gate_blocked" "custom template capability is blocked by lifecycle governance: $SELECTED_TEMPLATE (${CUSTOM_CAPABILITY_GATE_REASON:-runtime_gate_blocked})" "custom_template_runtime_gate_blocked" "runtime_capability_insufficient"
fi

if [[ "$WORKER_STAGE_ISOLATION_MODE" == "containerized" ]]; then
  WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
  record_fault_and_exit "custom_template_runtime_gate_blocked" "containerized workerStage remains reserved in current runtime: $SELECTED_TEMPLATE" "containerized_reserved" "runtime_capability_insufficient"
fi

if ! jq -e '
  (.template_selector.implementation_topology.custom_overlay_layer.overlay_fields // []) as $overlay_fields
  | (.lifecycle_governance.overlay_governance.allowed_overlay_fields // []) as $allowed_fields
  | (($overlay_fields | map(select(($allowed_fields | index(.)) == null)) | length) == 0)
' "$RUNTIME_VIEW" >/dev/null 2>&1; then
  WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
  record_fault_and_exit "overlay_field_rejected" "overlay fields rejected by lifecycle governance for template: $SELECTED_TEMPLATE" "overlay_field_rejected" "runtime_capability_insufficient"
fi

if [[ -z "$SELECTED_TEMPLATE" ]]; then
  SELECTED_TEMPLATE="$(jq -r '.worker_runtime.selected_template_id // ""' "$META" 2>/dev/null || true)"
fi

SELECTED_TEMPLATE="$(normalize_template_id "$SELECTED_TEMPLATE")"
record_template_summary
record_workerstage_observability 0 0 "ok" 0 ""
TASK_SCOPE_SNAPSHOT="$(mktemp -t worker_scope_snapshot)"
capture_task_scope_snapshot "$TASK_SCOPE_SNAPSHOT"

case "$DELIVERY_MODE:$TEMPLATE_KIND" in
  deterministic_python_bundle:concrete)
    if [[ -z "$HANDLER_SCRIPT_REL" ]]; then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "template_handler_missing" "handler missing for template: $SELECTED_TEMPLATE" "template_handler_missing" "runtime_capability_insufficient"
    fi
    HANDLER_PATH="$TEMPLATE_ROOT/$HANDLER_SCRIPT_REL"
    if [[ ! -x "$HANDLER_PATH" ]]; then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "template_handler_missing" "handler not executable for template: $SELECTED_TEMPLATE" "template_handler_missing" "runtime_capability_insufficient"
    fi
    if ! run_handler "$HANDLER_PATH"; then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "template_handler_failed" "handler execution failed for template: $SELECTED_TEMPLATE (${HANDLER_ERROR:-unknown_error})" "template_handler_failed" "runtime_capability_insufficient"
    fi
    FORBIDDEN_WRITES_JSON="$(detect_forbidden_writes "$TASK_SCOPE_SNAPSHOT")"
    if [[ "$(jq 'length' <<<"$FORBIDDEN_WRITES_JSON")" != "0" ]]; then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "worker_stage_forbidden_write" "worker wrote outside execution workspace: $(jq -r 'join(", ")' <<<"$FORBIDDEN_WRITES_JSON")" "forbidden_write_scope" "runtime_capability_insufficient"
    fi
    WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
    BYTES_USED="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.bytes_used // 0')"
    FILE_COUNT="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.file_count // 0')"
    MAX_FILE_BYTES_USED="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.max_single_file_bytes // 0')"
    if (( BYTES_USED > MAX_WORKER_STAGE_BYTES || FILE_COUNT > MAX_WORKER_STAGE_FILE_COUNT || MAX_FILE_BYTES_USED > MAX_WORKER_STAGE_SINGLE_FILE_BYTES )); then
      if [[ "$WORKER_STAGE_OVERFLOW_POLICY" == "truncate_temp_only" ]]; then
        rm -rf "$WORKER_STAGE_SCRATCH_ROOT"
        WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
        BYTES_USED="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.bytes_used // 0')"
        FILE_COUNT="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.file_count // 0')"
        MAX_FILE_BYTES_USED="$(printf '%s' "$WORKSPACE_STATS_JSON" | jq -r '.max_single_file_bytes // 0')"
      fi
      if (( BYTES_USED > MAX_WORKER_STAGE_BYTES || FILE_COUNT > MAX_WORKER_STAGE_FILE_COUNT || MAX_FILE_BYTES_USED > MAX_WORKER_STAGE_SINGLE_FILE_BYTES )); then
        record_fault_and_exit "worker_stage_exhausted" "execution workspace exceeded governance budget" "workspace_budget_exceeded" "runtime_capability_insufficient"
      fi
    fi
    export_delivery_artifacts "$(printf '%s' "$HANDLER_RESULT_JSON" | jq -c '.delivery_manifest // []')"
    if ! evidence_error="$(validate_handler_evidence "$HANDLER_RESULT_JSON" "$IMPLEMENTATION_ROLE_LAYER")"; then
      WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
      record_fault_and_exit "worker_template_evidence_invalid" "handler evidence validation failed for template: $SELECTED_TEMPLATE (${evidence_error:-invalid_evidence})" "invalid_evidence" "runtime_capability_insufficient"
    fi
    append_worker_evidence \
      "${HANDLER_SUMMARY:-executed $SELECTED_TEMPLATE}" \
      "${HANDLER_CHANGED_FILES:-delivery/}" \
      "${HANDLER_DELIVERY_MANIFEST:-delivery/}" \
      "${HANDLER_EVIDENCE_NOTES:-}"
    append_test_command "${HANDLER_TEST_COMMAND:-}"
    publish_cluster_message \
      "${MAILBOX_MESSAGE_TYPE:-$DEFAULT_MESSAGE_TYPE}" \
      "$MAILBOX_TARGET_ROLE_TYPES_JSON" \
      "${HANDLER_SUMMARY:-worker template $SELECTED_TEMPLATE produced delivery bundle}" \
      "$EXPORTED_ATTACHMENTS_JSON"
    report_convergence "partial_deliverable" "0.9" "1" "handoff_to_tester" ""
    CURRENT_STATUS="success"
    cleanup_workerstage
    clear_fault_action_summary
    record_workerstage_observability "$BYTES_USED" "$FILE_COUNT" "ok" "$EXPORTED_COUNT" ""
    echo "worker delivered task with template: $SELECTED_TEMPLATE ($TASK_ID)"
    exit 0
    ;;
  unsupported_placeholder:placeholder)
    WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
    record_fault_and_exit "template_not_implemented" "unsupported placeholder template: $SELECTED_TEMPLATE" "template_not_implemented" "runtime_capability_insufficient"
    ;;
  *)
    WORKSPACE_STATS_JSON="$(compute_workspace_stats "$WORKER_STAGE_ROOT")"
    record_fault_and_exit "template_resolution_failed" "unknown worker template mode/kind: $DELIVERY_MODE/$TEMPLATE_KIND" "template_resolution_failed" "runtime_capability_insufficient"
    ;;
esac
