#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR/data"

TEST_MODE="$(jq -r '.implementation_topology.custom_overlay_layer.config.default_test_mode // .template_selector.implementation_topology.custom_overlay_layer.config.default_test_mode // ""' "$RUNTIME_VIEW" 2>/dev/null || true)"
DELIVERY_EXPECTATIONS="$(jq -r '(.implementation_topology.custom_overlay_layer.config.delivery_expectations // .template_selector.implementation_topology.custom_overlay_layer.config.delivery_expectations // []) | join(", ")' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$TEST_MODE" ]] || TEST_MODE="python_data_smoke"

cat > "$DELIVERY_DIR/data/sample_input.csv" <<'CSV'
name,value
alpha,1
beta,2
CSV

cat > "$DELIVERY_DIR/transform_data.py" <<'PY'
from __future__ import annotations

import csv
from pathlib import Path


def normalize_score(raw_value: str) -> int:
    return int(raw_value) * 10


def main() -> None:
    source = Path("data/sample_input.csv")
    target = Path("data/sample_output.csv")
    rows = []
    with source.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows.append({"name": row["name"], "value": str(normalize_score(row["value"]))})
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["name", "value"])
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
PY

cat > "$DELIVERY_DIR/RUNBOOK.md" <<MD
# Data Worker Runbook

## Delivery
- Input: \`data/sample_input.csv\`
- Transform: \`transform_data.py\`
- Output: \`data/sample_output.csv\`

## Validation
- test_mode: ${TEST_MODE}
- delivery_expectations: ${DELIVERY_EXPECTATIONS:-data_bundle}
- Run \`python3 transform_data.py\` and confirm output values were multiplied by 10
MD

jq -cn \
  --arg summary "generated python data processing delivery bundle" \
  --arg test_command "cd delivery && python3 transform_data.py && grep -q ',10' data/sample_output.csv && grep -q ',20' data/sample_output.csv" \
  --argjson changed_files '[
    "delivery/data/sample_input.csv",
    "delivery/transform_data.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson delivery_manifest '[
    "delivery/data/sample_input.csv",
    "delivery/transform_data.py",
    "delivery/RUNBOOK.md"
  ]' \
  --argjson evidence_notes "[\"test_mode=${TEST_MODE}\", \"delivery_expectations=${DELIVERY_EXPECTATIONS:-data_bundle}\"]" \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
