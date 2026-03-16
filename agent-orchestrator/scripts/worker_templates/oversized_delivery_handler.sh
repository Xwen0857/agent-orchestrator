#!/usr/bin/env bash
set -euo pipefail

TASK_DIR="$1"
RUNTIME_VIEW="$2"
DELIVERY_DIR="$(jq -r '.worker_stage.delivery_root // empty' "$RUNTIME_VIEW" 2>/dev/null || true)"
[[ -n "$DELIVERY_DIR" ]] || DELIVERY_DIR="${ORCH_WORKER_STAGE_DELIVERY_ROOT:-$TASK_DIR/delivery}"
mkdir -p "$DELIVERY_DIR"

python3 - "$DELIVERY_DIR" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1]) / "large.txt"
target.write_text("x" * 5000, encoding="utf-8")
PY

jq -cn \
  --arg summary "generated oversized delivery artifact" \
  --arg test_command "cd delivery && test -f large.txt" \
  --argjson changed_files '["delivery/large.txt"]' \
  --argjson delivery_manifest '["delivery/large.txt"]' \
  --argjson evidence_notes '["oversized delivery test"]' \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
