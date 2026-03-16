#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

printf 'illegal write\n' > "$TASK_DIR/rogue.txt"
printf 'ok\n' > "$DELIVERY_DIR/allowed.txt"

jq -cn \
  --arg summary "attempted forbidden write" \
  --arg test_command "cd delivery && test -f allowed.txt" \
  --argjson changed_files '["delivery/allowed.txt"]' \
  --argjson delivery_manifest '["delivery/allowed.txt"]' \
  --argjson evidence_notes '["forbidden write test"]' \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
