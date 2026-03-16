#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // .template_selector.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // .template_selector.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="infra_smoke"

cat > "$DELIVERY_DIR/infra-compose.yaml" <<'YAML'
services:
  example-service:
    image: alpine:3.20
    command: ["sh", "-c", "echo infra smoke"]
YAML

cat > "$DELIVERY_DIR/validate_infra.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
grep -q "services:" infra-compose.yaml
grep -q "image:" infra-compose.yaml
SH
chmod +x "$DELIVERY_DIR/validate_infra.sh"

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# Infra Worker Runbook

## Delivery
- Infra config: \`infra-compose.yaml\`
- Validation script: \`validate_infra.sh\`

## Validation
- test_mode: ${TEST_MODE}
- delivery_expectations: ${DELIVERY_EXPECTATIONS:-infra_bundle}
- Run \`./validate_infra.sh\`
MD

jq -cn \
  --arg summary "generated infra runtime configuration bundle" \
  --arg test_command "cd delivery && ./validate_infra.sh" \
  --argjson changed_files '[
    "delivery/infra-compose.yaml",
    "delivery/validate_infra.sh",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/infra-compose.yaml",
    "delivery/validate_infra.sh",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-infra_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
