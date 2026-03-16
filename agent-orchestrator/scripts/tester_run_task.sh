#!/usr/bin/env bash
set -euo pipefail

# Runs Python unit tests from a task delivery directory and records the outcome
# in task-local evidence files.
# Inputs: task directory containing delivery artifacts.
# Side effects: appends to test.md and rewrites tester_result.json.
# Failure model: exits non-zero when delivery/tests are missing or tests fail.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
RUNTIME_VIEW="$TASK_DIR/worker_runtime_view.json"
if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

TASK_ID="$(jq -r '.id' "$META")"
DELIVERY_DIR="$TASK_DIR/delivery"
RESULT_JSON="$TASK_DIR/tester_result.json"
APPEND_SCRIPT="$(cd "$(dirname "$0")" && pwd -P)/append_task_event.sh"
EXPORT_RECORDS_PATH="$TASK_DIR/delivery.export-records.json"

append_event_nonfatal() {
  local action="$1"
  local reason="$2"
  if [[ -x "$APPEND_SCRIPT" ]]; then
    "$APPEND_SCRIPT" "$TASK_DIR" "tester-ephemeral" "op_tester_${TASK_ID}_${action}_$$" "$action" "$reason" "$(jq -r '.state // ""' "$META")" "$(jq -r '.state // ""' "$META")" >/dev/null 2>&1 || true
  fi
}

update_runtime_meta() {
  local jq_expr="${@: -1}"
  local -a jq_args=("${@:1:$#-1}")
  local tmp
  tmp="$(mktemp "$TASK_DIR/.meta.tester.XXXXXX.json")"
  jq "${jq_args[@]}" "$jq_expr" "$META" > "$tmp" && mv "$tmp" "$META"
}

update_export_record_status() {
  local consumption_status="$1"
  local archive_status="$2"
  [[ -f "$EXPORT_RECORDS_PATH" ]] || return 0
  local now tmp
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  tmp="$(mktemp "$TASK_DIR/.export-records.XXXXXX.json")"
  jq \
    --arg consumption_status "$consumption_status" \
    --arg archive_status "$archive_status" \
    --arg now "$now" \
    'map(
      .consumption_status = $consumption_status
      | .archive_status = $archive_status
      | .consumed_at = (if $consumption_status == "consumed" then ($now) else (.consumed_at // "") end)
      | .archived_at = (if $archive_status == "archived" then ($now) else (.archived_at // "") end)
      | .last_lifecycle_action = (if $archive_status == "archived" then "tester_archived" else "tester_consumed" end)
    )' \
    "$EXPORT_RECORDS_PATH" > "$tmp" && mv "$tmp" "$EXPORT_RECORDS_PATH"
}

resolve_archive_on_consume() {
  if [[ ! -f "$RUNTIME_VIEW" ]]; then
    printf 'true\n'
    return
  fi
  if jq -e '.lifecycle_governance.worker_stage_governance.export_policy.archive_on_tester_consume == false' "$RUNTIME_VIEW" >/dev/null 2>&1; then
    printf 'false\n'
  else
    printf 'true\n'
  fi
}

count_ndjson_matches() {
  local file_path="$1"
  local filter_expr="$2"
  if [[ ! -f "$file_path" ]]; then
    printf '0\n'
    return
  fi
  jq -s "$filter_expr | length" "$file_path" 2>/dev/null || printf '0\n'
}

recalculate_cluster_counters() {
  local mailbox_path="$1"
  local archive_path="$2"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local published acknowledged consumed archived
  published="$(count_ndjson_matches "$mailbox_path" 'map(select((.status // "published") == "published"))')"
  acknowledged="$(count_ndjson_matches "$mailbox_path" 'map(select((.status // "") == "acknowledged"))')"
  consumed="$(count_ndjson_matches "$archive_path" 'map(select((.consumed_at // "") != ""))')"
  archived="$(count_ndjson_matches "$archive_path" 'map(select((.status // "") == "archived"))')"
  update_runtime_meta \
    --argjson published "$published" \
    --argjson acknowledged "$acknowledged" \
    --argjson consumed "$consumed" \
    --argjson archived "$archived" \
    --arg now "$now" \
    '.task_cluster = (.task_cluster // {})
    | .task_cluster.mailbox_counters = (.task_cluster.mailbox_counters // {})
    | .task_cluster.mailbox_counters.published = $published
    | .task_cluster.mailbox_counters.acknowledged = $acknowledged
    | .task_cluster.mailbox_counters.consumed = $consumed
    | .task_cluster.mailbox_counters.archived = $archived
    | .task_cluster.updated_at = $now'
}

consume_cluster_mailbox() {
  [[ -f "$RUNTIME_VIEW" ]] || return 0
  local mailbox_path archive_path memberships_json now message_json message_id cluster_id role_type
  memberships_json="$(jq -c '.collaboration.memberships // []' "$RUNTIME_VIEW" 2>/dev/null || echo '[]')"
  mailbox_path="$(jq -r '.collaboration.mailbox_path // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
  archive_path="$(jq -r '.collaboration.archive_path // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
  cluster_id="$(jq -r '.collaboration.cluster_id // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
  role_type="$(jq -r '.dispatch.role_type // "tester-ephemeral"' "$RUNTIME_VIEW" 2>/dev/null || echo 'tester-ephemeral')"
  [[ -n "$mailbox_path" && -f "$mailbox_path" ]] || return 0
  [[ -n "$archive_path" ]] || return 0
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local tmp_mailbox
  tmp_mailbox="$(mktemp "$TASK_DIR/.mailbox.maint.XXXXXX.ndjson")"
  jq -c --arg now "$now" '
    if (.expires_at // "") != "" and .expires_at <= $now and (.status // "published") != "archived" then
      . + {status: "archived", archived_at: $now, expired_at: $now}
    else
      .
    end' "$mailbox_path" > "$tmp_mailbox"
  mv "$tmp_mailbox" "$mailbox_path"
  local expired_json
  expired_json="$(jq -c 'select((.expired_at // "") != "")' "$mailbox_path" 2>/dev/null || true)"
  if [[ -n "$expired_json" ]]; then
    printf '%s\n' "$expired_json" >> "$archive_path"
    tmp_mailbox="$(mktemp "$TASK_DIR/.mailbox.expired.XXXXXX.ndjson")"
    jq -c 'select((.expired_at // "") == "")' "$mailbox_path" > "$tmp_mailbox"
    mv "$tmp_mailbox" "$mailbox_path"
    update_export_record_status "available" "archived"
    update_runtime_meta --arg now "$now" '.task_cluster = (.task_cluster // {}) | .task_cluster.mailbox_last_expired_at = $now'
    recalculate_cluster_counters "$mailbox_path" "$archive_path"
    append_event_nonfatal "TASK_CLUSTER_MESSAGE_EXPIRED" "tester_archived_expired_message"
  fi
  message_json="$(jq -c --argjson memberships "$memberships_json" --arg role_type "$role_type" --arg task_id "$TASK_ID" '
    select((.status // "published") == "published" or (.status // "") == "acknowledged")
    | select((.message_type // "") == "partial_deliverable" or (.message_type // "") == "handoff_note")
    | select((.memberships // []) | any(. as $m | $memberships | index($m)))
    | select(((.target_role_types // []) | length) == 0 or ((.target_role_types // []) | index($role_type)))
    | select(((.target_worker_ids // []) | length) == 0 or ((.target_worker_ids // []) | index($task_id)))
    | .' "$mailbox_path" 2>/dev/null | head -n 1)"
  [[ -n "$message_json" ]] || return 0
  message_id="$(printf '%s' "$message_json" | jq -r '.message_id')"
  mkdir -p "$(dirname "$archive_path")"
  [[ -f "$archive_path" ]] || : > "$archive_path"
  local requires_ack status
  requires_ack="$(printf '%s' "$message_json" | jq -r '.requires_ack // false')"
  status="$(printf '%s' "$message_json" | jq -r '.status // "published"')"
  if [[ "$requires_ack" == "true" && "$status" != "acknowledged" ]]; then
    tmp_mailbox="$(mktemp "$TASK_DIR/.mailbox.ack.XXXXXX.ndjson")"
    jq -c --arg message_id "$message_id" --arg now "$now" --arg role_type "$role_type" '
      if .message_id == $message_id then
        . + {
          status: "acknowledged",
          acknowledged_at: $now,
          acknowledged_by: ((.acknowledged_by // []) + [$role_type] | unique)
        }
      else
        .
      end' "$mailbox_path" > "$tmp_mailbox"
    mv "$tmp_mailbox" "$mailbox_path"
    recalculate_cluster_counters "$mailbox_path" "$archive_path"
    append_event_nonfatal "TASK_CLUSTER_MESSAGE_ACKNOWLEDGED" "tester_acknowledged_partial_deliverable"
    return 0
  fi
  printf '%s\n' "$message_json" | jq -c --arg now "$now" --arg role_type "$role_type" '. + {
    acknowledged_at: (.acknowledged_at // $now),
    acknowledged_by: ((.acknowledged_by // []) + [$role_type] | unique),
    consumed_at: $now,
    archived_at: $now,
    consumer_role: $role_type,
    status: "archived"
  }' >> "$archive_path"
  tmp_mailbox="$(mktemp "$TASK_DIR/.mailbox.consume.XXXXXX.ndjson")"
  jq -c --arg message_id "$message_id" 'select(.message_id != $message_id)' "$mailbox_path" > "$tmp_mailbox"
  mv "$tmp_mailbox" "$mailbox_path"
  local archive_on_consume archive_status
  archive_on_consume="$(resolve_archive_on_consume)"
  archive_status="active"
  if [[ "$archive_on_consume" == "true" ]]; then
    archive_status="archived"
  fi
  update_export_record_status "consumed" "$archive_status"
  update_runtime_meta --arg cluster_id "$cluster_id" '.task_cluster = (.task_cluster // {}) | .task_cluster.cluster_id = (.task_cluster.cluster_id // $cluster_id)'
  recalculate_cluster_counters "$mailbox_path" "$archive_path"
  append_event_nonfatal "TASK_CLUSTER_MESSAGE_CONSUMED" "tester_consumed_partial_deliverable"
  append_event_nonfatal "TASK_CLUSTER_MESSAGE_ARCHIVED" "tester_archived_partial_deliverable"
}

if [[ ! -d "$DELIVERY_DIR" ]]; then
  echo "delivery directory missing for tester"
  {
    echo "- Commands: cd delivery && python3 -m unittest -q <test_files>"
    echo "- Result: FAIL"
    echo "- Evidence: delivery directory missing"
  } >> "$TASK_DIR/test.md"
  jq -n --arg task_id "$TASK_ID" --arg status "FAIL" --arg details "delivery directory missing" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  exit 1
fi

TEST_FILES=()
# Prefer unittest's common discovery naming first, then fall back to the
# alternate suffix used by some generated deliveries.
while IFS= read -r test_file; do
  TEST_FILES+=("$test_file")
done < <(find "$DELIVERY_DIR" -maxdepth 1 -type f -name "test*.py" -exec basename {} \; | sort)
if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  while IFS= read -r test_file; do
    TEST_FILES+=("$test_file")
  done < <(find "$DELIVERY_DIR" -maxdepth 1 -type f -name "*_test.py" -exec basename {} \; | sort)
fi
if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "no python test files found in delivery"
  {
    echo "- Commands: cd delivery && python3 -m unittest -q <test_files>"
    echo "- Result: FAIL"
    echo "- Evidence: no test files matching test*.py or *_test.py"
  } >> "$TASK_DIR/test.md"
  jq -n \
    --arg task_id "$TASK_ID" \
    --arg status "FAIL" \
    --arg details "no test files matching test*.py or *_test.py" \
    '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  exit 1
fi

CMD="cd delivery && python3 -m unittest -q ${TEST_FILES[*]}"
set +e
# Capture output without short-circuiting so we can always persist evidence.
OUT="$(cd "$DELIVERY_DIR" && python3 -m unittest -q "${TEST_FILES[@]}" 2>&1)"
CODE=$?
set -e

{
  echo "- Commands: $CMD"
  if [[ $CODE -eq 0 ]]; then
    echo "- Result: PASS"
  else
    echo "- Result: FAIL"
  fi
  echo "- Evidence: $OUT"
} >> "$TASK_DIR/test.md"

if [[ $CODE -eq 0 ]]; then
  consume_cluster_mailbox
  jq -n --arg task_id "$TASK_ID" --arg status "PASS" --arg details "$OUT" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
  echo "tester pass: $TASK_ID"
  exit 0
fi

jq -n --arg task_id "$TASK_ID" --arg status "FAIL" --arg details "$OUT" '{task_id:$task_id,status:$status,details:$details}' > "$RESULT_JSON"
echo "tester fail: $TASK_ID"
exit 1
