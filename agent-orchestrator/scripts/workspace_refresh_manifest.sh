#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the manifest snapshot for a task run root and reports file-level
# changes since the prior snapshot.
# Inputs: run root and optional snapshot id.
# Side effects: rewrites manifest.lock.json.
# Failure model: exits non-zero on invalid usage or Python runtime errors.

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <run_root> [snapshot_id]"
  exit 2
fi

RUN_ROOT="$1"
SNAPSHOT_ID="${2:-snap_$(date -u +%Y%m%d%H%M%S)}"
MANIFEST="$RUN_ROOT/manifest.lock.json"

mkdir -p "$RUN_ROOT"

# Python handles recursive hashing and diffing so the shell wrapper can keep a
# stable JSON interface.
python3 - "$RUN_ROOT" "$MANIFEST" "$SNAPSHOT_ID" <<'PY'
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

run_root = Path(sys.argv[1]).resolve()
manifest_path = Path(sys.argv[2]).resolve()
snapshot_id = sys.argv[3]

exclude = {
    "manifest.lock.json",
    "env_build_report.json",
    "build_manifest.json",
    "workspace_change_report.json",
}

files = {}
for p in sorted(run_root.rglob("*")):
    if p.is_dir():
        continue
    rel = p.relative_to(run_root).as_posix()
    if rel in exclude:
        continue
    if rel.startswith("env/") or rel.startswith(".cache/"):
        continue
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    files[rel] = {"sha256": h.hexdigest(), "size": p.stat().st_size}

prev = {}
if manifest_path.exists():
    try:
        prev = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        prev = {}
prev_files = (prev or {}).get("files") or {}

changed = 0
changed_files = []
for k, v in files.items():
    if k not in prev_files:
        changed += 1
        changed_files.append({"path": k, "change": "added"})
    elif prev_files[k].get("sha256") != v.get("sha256"):
        changed += 1
        changed_files.append({"path": k, "change": "modified"})
for k in prev_files.keys():
    if k not in files:
        changed += 1
        changed_files.append({"path": k, "change": "deleted"})

out = {
    "schema_version": "workspace-manifest-v1",
    "snapshot_id": snapshot_id,
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "file_count": len(files),
    "changed_count": changed,
    "changed_files": changed_files,
    "files": files,
}
manifest_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "ok", "manifest": str(manifest_path), "file_count": len(files), "changed_count": changed, "changed_files": changed_files, "snapshot_id": snapshot_id}))
PY
