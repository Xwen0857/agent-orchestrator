#!/usr/bin/env bash
set -euo pipefail

# Hashes the current task artifacts and records one sealing event in the task log.
# Inputs: task directory and operation id.
# Side effects: computes file hashes and appends one `TASK_HASH_SEAL` event through
# `append_task_event.sh`.
# Failure model: exits non-zero if required task files are missing or hashing/appending fails.

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task_dir> <operation_id>"
  exit 2
fi

TASK_DIR="$1"
OP_ID="$2"
APPEND_SCRIPT="$(dirname "$0")/append_task_event.sh"

meta_hash="$(shasum -a 256 "$TASK_DIR/meta.json" | awk '{print $1}')"
plan_hash="$(shasum -a 256 "$TASK_DIR/plan.md" | awk '{print $1}')"
work_hash="$(shasum -a 256 "$TASK_DIR/work.md" | awk '{print $1}')"
test_hash="$(shasum -a 256 "$TASK_DIR/test.md" | awk '{print $1}')"
audit_hash="$(shasum -a 256 "$TASK_DIR/audit.md" | awk '{print $1}')"
log_tip="$(tail -n 1 "$TASK_DIR/log.ndjson" | jq -r '.hash_self // ""')"

# Seal material captures both content hashes and the current log tip so the snapshot
# can be tied back to a specific audit-chain position.
seal_material="meta=$meta_hash plan=$plan_hash work=$work_hash test=$test_hash audit=$audit_hash log_tip=$log_tip"
seal_hash="$(printf "%s" "$seal_material" | shasum -a 256 | awk '{print $1}')"

"$APPEND_SCRIPT" "$TASK_DIR" "agent-orchestrator" "$OP_ID" "TASK_HASH_SEAL" "task_hash=$seal_hash $seal_material"
echo "task snapshot sealed: $seal_hash"
