#!/usr/bin/env bash
set -euo pipefail

# Builds a keeper inbox candidate by scanning a task run workspace for likely
# reusable text/code artifacts.
# Inputs: task id, run root, and optional file/byte limits.
# Side effects: writes a pending candidate JSON unless preview mode is enabled.
# Failure model: exits non-zero when required args are invalid or run_root is missing.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"

TASK_ID=""
RUN_ROOT=""
MAX_FILES=20
MAX_BYTES=10485760
PREVIEW=false

usage() {
  echo "usage: $0 --task-id <task_id> --run-root <path> [--max-files <n>] [--max-bytes <n>] [--preview]"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --run-root) RUN_ROOT="$2"; shift 2 ;;
    --max-files) MAX_FILES="$2"; shift 2 ;;
    --max-bytes) MAX_BYTES="$2"; shift 2 ;;
    --preview) PREVIEW=true; shift ;;
    *) usage ;;
  esac
done

[[ -n "$TASK_ID" && -n "$RUN_ROOT" ]] || usage
[[ -d "$RUN_ROOT" ]] || { echo "run_root not found"; exit 1; }

PENDING_DIR="$ROOT/knowledge-base/inbox/pending"
mkdir -p "$PENDING_DIR"

# Python performs the bounded recursive scan and emits a summary payload that
# can be previewed or persisted unchanged.
python3 - "$TASK_ID" "$RUN_ROOT" "$MAX_FILES" "$MAX_BYTES" "$PREVIEW" "$PENDING_DIR" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

task_id, run_root, max_files, max_bytes, preview, pending_dir = sys.argv[1:7]
run_root = Path(run_root).resolve()
max_files = int(max_files)
max_bytes = int(max_bytes)
preview = preview.lower() == "true"
pending_dir = Path(pending_dir)

allow_ext = {".md", ".txt", ".py", ".js", ".ts", ".json", ".yaml", ".yml", ".toml", ".sh"}
scan_roots = [run_root / "delivery", run_root / "workspace"]

files = []
total = 0
for root in scan_roots:
    if not root.exists():
        continue
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in allow_ext:
            continue
        size = p.stat().st_size
        if len(files) >= max_files:
            break
        if total + size > max_bytes:
            continue
        rel = p.relative_to(run_root).as_posix()
        files.append({"path": rel, "size": size})
        total += size

payload = {
    "candidate_id": f"cand_ws_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{os.getpid()}",
    "task_id": task_id,
    "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": "workspace-import",
    "run_root": str(run_root),
    "file_count": len(files),
    "total_bytes": total,
    "files": files,
    "status": "PENDING",
}

if not preview:
    name = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + f"-ws-import-{task_id}.json"
    out = pending_dir / name
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    payload["pending_file"] = str(out)

print(json.dumps(payload))
PY
