#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta missing"; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASK_ID="$(jq -r '.id // ""' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing"; exit 1; }

STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
WORK_MD="$TASK_DIR/work.md"
RESULT_JSON="$TASK_DIR/tester_result.json"

INDEX_FILE="$ROOT/templates/coordination/tasks/completed_context.ndjson"
LATEST_FILE="$ROOT/templates/coordination/tasks/completed_context.latest.json"
mkdir -p "$(dirname "$INDEX_FILE")"

python3 - "$ROOT" "$TASK_DIR" "$META" "$STRATEGY" "$WORK_MD" "$RESULT_JSON" "$INDEX_FILE" "$LATEST_FILE" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
task_dir = Path(sys.argv[2]).resolve()
meta_path = Path(sys.argv[3]).resolve()
strategy_path = Path(sys.argv[4]).resolve()
work_md_path = Path(sys.argv[5]).resolve()
result_path = Path(sys.argv[6]).resolve()
index_file = Path(sys.argv[7]).resolve()
latest_file = Path(sys.argv[8]).resolve()

meta = json.loads(meta_path.read_text(encoding="utf-8"))
strategy = {}
if strategy_path.exists():
    try:
        strategy = json.loads(strategy_path.read_text(encoding="utf-8"))
    except Exception:
        strategy = {}

run_root = Path(str(meta.get("run_root") or "")).resolve() if meta.get("run_root") else None
manifest = {}
if run_root:
    manifest_path = run_root / "manifest.lock.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

latest_action = ""
if work_md_path.exists():
    for line in work_md_path.read_text(encoding="utf-8").splitlines():
        if line.strip().lower().startswith("- latest action:"):
            latest_action = line.split(":", 1)[1].strip()

tester_status = ""
tester_details = ""
if result_path.exists():
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
        tester_status = str(result.get("status") or "")
        tester_details = str(result.get("details") or "")
    except Exception:
        pass

delivery_files = []
delivery_dir = task_dir / "delivery"
if delivery_dir.exists():
    for p in sorted(delivery_dir.rglob("*")):
        if p.is_file():
            delivery_files.append(str(p.relative_to(task_dir).as_posix()))

changed_files = []
for row in manifest.get("changed_files", []) if isinstance(manifest, dict) else []:
    if not isinstance(row, dict):
        continue
    rel = str(row.get("path") or "")
    change = str(row.get("change") or "")
    if rel:
        changed_files.append({"path": rel, "change": change})

task_id = str(meta.get("id") or "")
goal = str(strategy.get("goal") or "")
title = str(strategy.get("title") or goal or task_id)

record = {
    "task_id": task_id,
    "parent_task_id": str(meta.get("parent_task_id") or ""),
    "title": title,
    "goal": goal,
    "state": str(meta.get("state") or ""),
    "risk_level": str(meta.get("risk_level") or ""),
    "project_id": str(meta.get("project_id") or "prj_default"),
    "run_root": str(meta.get("run_root") or ""),
    "workspace_root": str(meta.get("workspace_root") or ""),
    "closed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "latest_action": latest_action,
    "tester_status": tester_status,
    "tester_details": tester_details,
    "delivery_files": delivery_files[:50],
    "changed_files": changed_files[:100],
    "knowledge_refs": list(meta.get("knowledge_refs") or []),
}

rows = []
if index_file.exists():
    for line in index_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if str(row.get("task_id") or "") == task_id:
            continue
        rows.append(row)
rows.append(record)

index_file.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
latest_file.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "ok", "task_id": task_id, "index": str(index_file), "count": len(rows)}))
PY

