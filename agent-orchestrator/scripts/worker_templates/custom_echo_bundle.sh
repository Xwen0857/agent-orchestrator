#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

SOURCE_ID="$(jq -r '.selected_template.template_source_id // "custom:unknown"' "$RUNTIME_VIEW")"
TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="custom_echo_check"

cat > "$DELIVERY_DIR/custom_delivery.txt" <<TXT
custom worker template delivered bundle
template_source_id=${SOURCE_ID}
TXT

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# Custom Worker Template Runbook

## Delivery
- File: \`custom_delivery.txt\`
- Template source: \`${SOURCE_ID}\`

## Validation
- test_mode: ${TEST_MODE}
- Check that \`custom_delivery.txt\` includes the template source id
MD

jq -cn \
  --arg summary "executed custom worker template bundle" \
  --arg test_command "cd delivery && grep -q \"template_source_id=${SOURCE_ID}\" custom_delivery.txt" \
  --argjson changed_files '[
    "delivery/custom_delivery.txt",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/custom_delivery.txt",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-custom_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
