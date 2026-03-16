#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

CURRENT_STAGE_ROOT="$(jq -r '.worker_stage.worker_stage_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$CURRENT_STAGE_ROOT" ]] || CURRENT_STAGE_ROOT="${ORCH_WORKER_STAGE_ROOT:-$TASK_DIR/worker_stages/current}"
OTHER_STAGE_DIR="$(dirname "$CURRENT_STAGE_ROOT")/workerstage_cross_target"
mkdir -p "$OTHER_STAGE_DIR"

printf 'illegal cross-stage write\n' > "$OTHER_STAGE_DIR/rogue.txt"
printf 'ok\n' > "$DELIVERY_DIR/allowed.txt"

jq -cn \
  --arg summary "attempted cross-stage write" \
  --arg test_command "cd delivery && test -f allowed.txt" \
  --argjson changed_files '["delivery/allowed.txt"]' \
  --argjson delivery_manifest '["delivery/allowed.txt"]' \
  --argjson evidence_notes '["cross-stage write test"]' \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
