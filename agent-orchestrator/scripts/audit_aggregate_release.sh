#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --task-dir <parent_task_dir> --run-root <parent_run_root>"
  exit 2
}

TASK_DIR=""
RUN_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-dir)
      [[ $# -ge 2 ]] || usage
      TASK_DIR="$2"
      shift 2
      ;;
    --run-root)
      [[ $# -ge 2 ]] || usage
      RUN_ROOT="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" && -n "$RUN_ROOT" ]] || usage
[[ -f "$TASK_DIR/meta.json" ]] || { echo "meta missing: $TASK_DIR/meta.json"; exit 1; }

MANIFEST_PATH="$RUN_ROOT/delivery_staging_manifest.json"
STAGING_ROOT="$RUN_ROOT/delivery_staging"
AUDIT_PATH="$TASK_DIR/aggregate_audit.json"

python3 - "$TASK_DIR" "$RUN_ROOT" "$MANIFEST_PATH" "$STAGING_ROOT" "$AUDIT_PATH" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

task_dir = Path(sys.argv[1]).resolve()
run_root = Path(sys.argv[2]).resolve()
manifest_path = Path(sys.argv[3]).resolve()
staging_root = Path(sys.argv[4]).resolve()
audit_path = Path(sys.argv[5]).resolve()

reasons = []
checks = []

if not manifest_path.exists():
    reasons.append("manifest_missing")
if not staging_root.exists():
    reasons.append("staging_missing")

manifest = {}
if manifest_path.exists():
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        reasons.append("manifest_unreadable")

files = manifest.get("files", []) if isinstance(manifest, dict) else []
collisions = manifest.get("collisions", []) if isinstance(manifest, dict) else []
if collisions:
    reasons.append("manifest_collisions_present")
checks.append({"name": "collision_empty", "ok": len(collisions) == 0, "detail": f"collisions={len(collisions)}"})

if not isinstance(files, list):
    reasons.append("manifest_files_invalid")
    files = []

# Check manifest file list vs actual staging files
actual_files = []
if staging_root.exists():
    actual_files = [p.relative_to(staging_root).as_posix() for p in sorted(staging_root.rglob("*")) if p.is_file()]
expected_files = [str((row or {}).get("path") or "") for row in files]
expected_set = {p for p in expected_files if p}
actual_set = set(actual_files)
if expected_set != actual_set:
    reasons.append("manifest_staging_mismatch")
checks.append({"name": "manifest_matches_staging", "ok": expected_set == actual_set, "detail": f"expected={len(expected_set)} actual={len(actual_set)}"})

# Check hash/size integrity
integrity_ok = True
for row in files:
    if not isinstance(row, dict):
        integrity_ok = False
        continue
    rel = str(row.get("path") or "")
    expected_sha = str(row.get("sha256") or "")
    expected_size = int(row.get("size") or 0)
    fp = staging_root / rel
    if not fp.exists():
        integrity_ok = False
        continue
    h = hashlib.sha256()
    with fp.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    if h.hexdigest() != expected_sha or fp.stat().st_size != expected_size:
        integrity_ok = False
checks.append({"name": "integrity_hash_size", "ok": integrity_ok})
if not integrity_ok:
    reasons.append("integrity_failed")

# Rule-based entrypoint/interface consistency checks
entrypoint_names = {"main.py", "app.py", "server.py", "index.js", "index.ts"}
entrypoint_hits = [p for p in actual_files if Path(p).name in entrypoint_names and "/" not in p]
if len(entrypoint_hits) > 1:
    reasons.append("entrypoint_conflict_multiple_top_level")
checks.append({"name": "entrypoint_conflict", "ok": len(entrypoint_hits) <= 1, "detail": ",".join(entrypoint_hits)})

interface_hits = [p for p in actual_files if Path(p).name == "interface.json"]
if len(interface_hits) > 1:
    reasons.append("interface_conflict_multiple")
checks.append({"name": "interface_conflict", "ok": len(interface_hits) <= 1, "detail": ",".join(interface_hits)})

status = "PASS" if not reasons else "FAIL"
doc = {
    "schema_version": "aggregate-audit-v1",
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "task_id": json.loads((task_dir / "meta.json").read_text(encoding="utf-8")).get("id", ""),
    "run_root": str(run_root),
    "manifest_path": str(manifest_path),
    "staging_root": str(staging_root),
    "status": status,
    "checks": checks,
    "reasons": reasons,
}
audit_path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": status, "audit_path": str(audit_path), "reasons": reasons}))
if status != "PASS":
    raise SystemExit(1)
PY

