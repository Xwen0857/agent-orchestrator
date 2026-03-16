#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // .template_selector.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // .template_selector.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="automation_smoke"

cat > "$DELIVERY_DIR/automation_cli.py" <<'PY'
from __future__ import annotations

import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a simple automation target")
    parser.add_argument("target", nargs="?", default="default")
    args = parser.parse_args()
    target = args.target
    print(f"automation target={target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# Script Automation Runbook

## Delivery
- CLI script: \`automation_cli.py\`

## Validation
- test_mode: ${TEST_MODE}
- delivery_expectations: ${DELIVERY_EXPECTATIONS:-automation_bundle}
- Run \`python3 automation_cli.py demo\`
MD

jq -cn \
  --arg summary "generated python automation cli bundle" \
  --arg test_command "cd delivery && python3 automation_cli.py demo | grep -q 'automation target=demo'" \
  --argjson changed_files '[
    "delivery/automation_cli.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/automation_cli.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-automation_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
