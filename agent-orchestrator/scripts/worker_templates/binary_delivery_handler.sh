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

target = Path(sys.argv[1]) / "bundle.bin"
target.write_bytes(b"\x00\xff\x00\xff")
PY

jq -cn \
  --arg summary "generated binary delivery artifact" \
  --arg test_command "cd delivery && test -f bundle.bin" \
  --argjson changed_files '["delivery/bundle.bin"]' \
  --argjson delivery_manifest '["delivery/bundle.bin"]' \
  --argjson evidence_notes '["binary delivery test"]' \
  '{schema_version:"worker-template-result-contract-v1", summary:$summary, test_command:$test_command, changed_files:$changed_files, delivery_manifest:$delivery_manifest, evidence_notes:$evidence_notes}'
