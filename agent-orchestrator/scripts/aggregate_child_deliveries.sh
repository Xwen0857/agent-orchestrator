#!/usr/bin/env bash
set -euo pipefail

# Collects delivery outputs from child tasks into one staged aggregate bundle for a parent run.
# Inputs: parent task dir, parent run root, and a JSON array of child task ids.
# Side effects: validates child delivery trees, writes an aggregate manifest, and populates
# `delivery_staging` under the parent run root when aggregation succeeds.
# Failure model: exits non-zero on invalid args, unreadable child state, collisions, or missing deliveries.

usage() {
  echo "usage: $0 --task-dir <parent_task_dir> --run-root <parent_run_root> --children-json <json_array>"
  exit 2
}

TASK_DIR=""
RUN_ROOT=""
CHILDREN_JSON=""

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
    --children-json)
      [[ $# -ge 2 ]] || usage
      CHILDREN_JSON="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" && -n "$RUN_ROOT" && -n "$CHILDREN_JSON" ]] || usage
[[ -f "$TASK_DIR/meta.json" ]] || { echo "meta missing: $TASK_DIR/meta.json"; exit 1; }
mkdir -p "$RUN_ROOT"

STAGING_ROOT="$RUN_ROOT/delivery_staging"
MANIFEST_PATH="$RUN_ROOT/delivery_staging_manifest.json"

# Delegate file enumeration, collision detection, manifest generation, and staged copy
# to Python so path handling and hashing remain easier to reason about than in pure shell.
python3 - "$TASK_DIR" "$RUN_ROOT" "$STAGING_ROOT" "$MANIFEST_PATH" "$CHILDREN_JSON" <<'PY'
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

task_dir = Path(sys.argv[1]).resolve()
run_root = Path(sys.argv[2]).resolve()
staging_root = Path(sys.argv[3]).resolve()
manifest_path = Path(sys.argv[4]).resolve()
children_raw = sys.argv[5]

try:
    children = json.loads(children_raw)
except Exception:
    print("invalid children json", file=sys.stderr)
    raise SystemExit(1)

if not isinstance(children, list) or not children:
    print("children must be a non-empty list", file=sys.stderr)
    raise SystemExit(1)

tasks_root = task_dir.parent
entries = []
collisions = []
seen = {}
errors = []

for child_id in children:
    if not isinstance(child_id, str) or not child_id:
        errors.append("invalid child id")
        continue
    child_meta = tasks_root / child_id / "meta.json"
    if not child_meta.exists():
        errors.append(f"child meta missing: {child_id}")
        continue
    try:
        child_doc = json.loads(child_meta.read_text(encoding="utf-8"))
    except Exception:
        errors.append(f"child meta unreadable: {child_id}")
        continue
    child_run_root = Path(str(child_doc.get("run_root") or "")).resolve() if child_doc.get("run_root") else None
    if not child_run_root or not child_run_root.exists():
        errors.append(f"child run_root missing: {child_id}")
        continue
    child_delivery = child_run_root / "delivery"
    if not child_delivery.exists() or not child_delivery.is_dir():
        errors.append(f"child delivery missing: {child_id}")
        continue
    files = [p for p in sorted(child_delivery.rglob("*")) if p.is_file()]
    if not files:
        errors.append(f"child delivery empty: {child_id}")
        continue
    for f in files:
        rel = f.relative_to(child_delivery).as_posix()
        stat = f.stat()
        h = hashlib.sha256()
        with f.open("rb") as fp:
            while True:
                chunk = fp.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
        row = {
            "path": rel,
            "source_child": child_id,
            "source_abs": str(f),
            "sha256": h.hexdigest(),
            "size": stat.st_size,
        }
        if rel in seen and seen[rel]["source_child"] != child_id:
            collisions.append(
                {
                    "path": rel,
                    "existing_child": seen[rel]["source_child"],
                    "incoming_child": child_id,
                }
            )
        else:
            seen[rel] = row
        entries.append(row)

manifest = {
    "schema_version": "aggregate-delivery-manifest-v1",
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "task_id": json.loads((task_dir / "meta.json").read_text(encoding="utf-8")).get("id", ""),
    "staging_root": str(staging_root),
    "files": [{"path": v["path"], "source_child": v["source_child"], "sha256": v["sha256"], "size": v["size"]} for v in seen.values()],
    "collisions": collisions,
    "errors": errors,
}

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

if errors or collisions:
    print(
        json.dumps(
            {
                "status": "failed",
                "manifest_path": str(manifest_path),
                "collision_count": len(collisions),
                "error_count": len(errors),
            }
        )
    )
    raise SystemExit(1)

if staging_root.exists():
    shutil.rmtree(staging_root)
staging_root.mkdir(parents=True, exist_ok=True)

for row in seen.values():
    src = Path(row["source_abs"])
    dst = staging_root / row["path"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

print(
    json.dumps(
        {
            "status": "ok",
            "manifest_path": str(manifest_path),
            "staging_root": str(staging_root),
            "file_count": len(seen),
            "collision_count": 0,
        }
    )
)
PY
