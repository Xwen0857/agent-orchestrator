#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Applies one planner-facing amendment payload to an existing task's structured inputs.
# Inputs: `--task-dir` plus either `--effective-patch` or `--batch`.
# Side effects: merges the payload into task strategy/meta files and appends a task event.
# Failure model: exits non-zero on invalid args, missing task artifacts, or malformed JSON payloads.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASK_DIR=""
BATCH_PATH=""
EFFECTIVE_PATCH_PATH=""
EXPECTED_APPLYING_VERSION="0"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"

usage() {
  echo "usage: $0 --task-dir <task_dir> [--batch <batch_json>] [--effective-patch <effective_patch_json>] [--expected-applying-version <version>]"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-dir)
      [[ $# -ge 2 ]] || usage
      TASK_DIR="$2"
      shift 2
      ;;
    --batch)
      [[ $# -ge 2 ]] || usage
      BATCH_PATH="$2"
      shift 2
      ;;
    --effective-patch)
      [[ $# -ge 2 ]] || usage
      EFFECTIVE_PATCH_PATH="$2"
      shift 2
      ;;
    --expected-applying-version)
      [[ $# -ge 2 ]] || usage
      EXPECTED_APPLYING_VERSION="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$TASK_DIR" ]] || usage
[[ -n "$BATCH_PATH" || -n "$EFFECTIVE_PATCH_PATH" ]] || usage

if [[ "$TASK_DIR" != /* ]]; then
  TASK_DIR="$ROOT/$TASK_DIR"
fi
if [[ -n "$BATCH_PATH" && "$BATCH_PATH" != /* ]]; then
  BATCH_PATH="$ROOT/$BATCH_PATH"
fi
if [[ -n "$EFFECTIVE_PATCH_PATH" && "$EFFECTIVE_PATCH_PATH" != /* ]]; then
  EFFECTIVE_PATCH_PATH="$ROOT/$EFFECTIVE_PATCH_PATH"
fi

TASK_DIR="$(cd "$TASK_DIR" && pwd -P)"
if [[ -n "$BATCH_PATH" ]]; then
  BATCH_PATH="$(cd "$(dirname "$BATCH_PATH")" && pwd -P)/$(basename "$BATCH_PATH")"
fi
if [[ -n "$EFFECTIVE_PATCH_PATH" ]]; then
  EFFECTIVE_PATCH_PATH="$(cd "$(dirname "$EFFECTIVE_PATCH_PATH")" && pwd -P)/$(basename "$EFFECTIVE_PATCH_PATH")"
fi

META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta.json missing: $META"; exit 1; }
if [[ -n "$BATCH_PATH" && ! -f "$BATCH_PATH" ]]; then
  echo "batch json missing: $BATCH_PATH"
  exit 1
fi
if [[ -n "$EFFECTIVE_PATCH_PATH" && ! -f "$EFFECTIVE_PATCH_PATH" ]]; then
  echo "effective patch json missing: $EFFECTIVE_PATCH_PATH"
  exit 1
fi
[[ -x "$APPEND_SCRIPT" ]] || { echo "append_task_event dependency missing"; exit 1; }

TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing in meta"; exit 1; }
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
[[ -f "$STRATEGY" ]] || { echo "strategy missing: $STRATEGY"; exit 1; }

WATERMARK_PATH=""
if [[ -n "$EFFECTIVE_PATCH_PATH" && "$EFFECTIVE_PATCH_PATH" == *.effective-patch.v2.json ]]; then
  WATERMARK_PATH="${EFFECTIVE_PATCH_PATH%.effective-patch.v2.json}.watermark.v2.json"
fi

python3 - "$STRATEGY" "$META" "$BATCH_PATH" "$EFFECTIVE_PATCH_PATH" "$WATERMARK_PATH" "$EXPECTED_APPLYING_VERSION" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

strategy_path = Path(sys.argv[1])
meta_path = Path(sys.argv[2])
batch_path = Path(sys.argv[3]) if sys.argv[3] else None
effective_patch_path = Path(sys.argv[4]) if sys.argv[4] else None
watermark_path = Path(sys.argv[5]) if sys.argv[5] else None
expected_applying_version = int(sys.argv[6] or "0")

strategy = json.loads(strategy_path.read_text(encoding="utf-8"))
meta = json.loads(meta_path.read_text(encoding="utf-8"))
batch = (
    json.loads(batch_path.read_text(encoding="utf-8"))
    if batch_path and batch_path.exists()
    else None
)
effective_patch = (
    json.loads(effective_patch_path.read_text(encoding="utf-8"))
    if effective_patch_path and effective_patch_path.exists()
    else None
)
merged = (
    (effective_patch or {}).get("effective_patch")
    if isinstance(effective_patch, dict)
    else None
)
if not isinstance(merged, dict):
    merged = (batch or {}).get("merged_changes") if isinstance(batch, dict) else None
if not isinstance(merged, dict):
    raise RuntimeError("missing amendment payload: neither effective_patch nor batch merged_changes is available")

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()

def unique_append(base: list[object], additions: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in base:
        text = clean_text(item)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    for item in additions:
        text = clean_text(item)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result

def parse_workspace(value: str) -> str:
    match = re.search(r"workspace[_\s-]*root\s*[:=]\s*([A-Za-z0-9._/\-]+)", value, re.IGNORECASE)
    return match.group(1).strip() if match else ""

def parse_budget(value: str):
    match = re.search(r"budget\s*[:=]\s*([0-9]+)\s*,\s*([0-9]+)", value, re.IGNORECASE)
    if not match:
        return None
    token_cost = max(1, int(match.group(1)))
    execution_seconds = max(1, int(match.group(2)))
    return token_cost, execution_seconds

summary_input = strategy.get("summary_input")
if not isinstance(summary_input, dict):
    summary_input = {}
strategy["summary_input"] = summary_input

impact_rank = 0
impact = "soft"
worker_policy = "continue"
scope_summary: list[str] = []

def escalate(rank: int, next_impact: str, next_policy: str, scope_name: str) -> None:
    global impact_rank, impact, worker_policy
    scope_summary.append(scope_name)
    if rank > impact_rank:
        impact_rank = rank
        impact = next_impact
        worker_policy = next_policy

task_goal_patch = merged.get("task_goal_patch")
if isinstance(task_goal_patch, dict):
    task_goal = clean_text(task_goal_patch.get("value"))
    if task_goal:
        escalate(2, "hard", "pause_and_require_replan", "goal")
        summary_input["task_goal"] = task_goal
        strategy["goal"] = task_goal
        strategy["raw_request"] = task_goal
        if not clean_text(strategy.get("title")):
            strategy["title"] = task_goal[:72]

for field, key in (
    ("constraints_patch", "constraints"),
    ("deliverables_patch", "deliverables"),
    ("notes_patch", "notes"),
):
    patches = merged.get(field)
    values = []
    if isinstance(patches, list):
        for patch in patches:
            if isinstance(patch, dict):
                values.append(clean_text(patch.get("value")))
    if values:
        if key == "deliverables":
            escalate(1, "refresh_required", "revalidate_then_resume", "deliverables")
        elif key == "constraints":
            escalate(0, "soft", "continue", "constraints")
        elif key == "notes":
            escalate(0, "soft", "continue", "notes")
    summary_input[key] = unique_append(summary_input.get(key) or [], values)

workspace_patch = merged.get("workspace_patch")
workspace_root = ""
if isinstance(workspace_patch, dict):
    workspace_root = parse_workspace(clean_text(workspace_patch.get("value")))
    if workspace_root:
        escalate(1, "refresh_required", "revalidate_then_resume", "workspace")
        workspace = strategy.get("workspace")
        if not isinstance(workspace, dict):
            workspace = {}
        workspace["workspace_root"] = workspace_root
        project_id = clean_text(workspace.get("project_id")) or clean_text(meta.get("project_id")) or "prj_default"
        workspace["project_id"] = project_id
        workspace["source"] = clean_text(workspace.get("source")) or "run_flag"
        strategy["workspace"] = workspace
        meta["workspace_root_hint"] = workspace_root
        meta["workspace_root"] = workspace_root

budget_patch = merged.get("budget_patch")
parsed_budget = None
if isinstance(budget_patch, dict):
    parsed_budget = parse_budget(clean_text(budget_patch.get("value")))
if parsed_budget:
    escalate(1, "refresh_required", "revalidate_then_resume", "budget")
    budget = strategy.get("budget")
    if not isinstance(budget, dict):
        budget = {}
    budget["max_token_cost"], budget["max_execution_time_seconds"] = parsed_budget
    strategy["budget"] = budget
    meta_budget = meta.get("budget")
    if not isinstance(meta_budget, dict):
        meta_budget = {}
    meta_budget["max_token_cost"], meta_budget["max_execution_time_seconds"] = parsed_budget
    meta["budget"] = meta_budget

now = now_iso()
planner_replan = meta.get("planner_replan")
if not isinstance(planner_replan, dict):
    planner_replan = {}
planner_replan["status"] = "queued"
planner_replan["requested_at"] = now
planner_replan["impact"] = impact
planner_replan["worker_policy"] = worker_policy
planner_replan["scope_summary"] = sorted(set(scope_summary))
if batch_path:
    planner_replan["latest_amendment_batch_path"] = str(batch_path)
if effective_patch_path:
    planner_replan["latest_effective_patch_path"] = str(effective_patch_path)
meta["planner_replan"] = planner_replan
meta["updated_at"] = now
meta["workspace_user_change_seq"] = int(meta.get("workspace_user_change_seq") or 0) + 1

strategy["updated_at"] = now
strategy_path.write_text(json.dumps(strategy, indent=2) + "\n", encoding="utf-8")
meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

if watermark_path and watermark_path.exists():
    watermark = json.loads(watermark_path.read_text(encoding="utf-8"))
    applying_version = int(watermark.get("applying_version") or 0)
    consumed_version = int(watermark.get("consumed_version") or 0)
    head_version = int(watermark.get("head_version") or 0)
    if expected_applying_version > 0 and applying_version != expected_applying_version:
        raise RuntimeError(
            f"expected applying_version={expected_applying_version}, actual={applying_version}"
        )
    next_consumed = max(consumed_version, applying_version, head_version, expected_applying_version)
    watermark["consumed_version"] = next_consumed
    watermark["applying_version"] = next_consumed
    watermark["updated_at"] = now
    watermark_path.write_text(json.dumps(watermark, indent=2) + "\n", encoding="utf-8")
elif expected_applying_version > 0:
    raise RuntimeError("expected applying version provided but watermark file missing")
PY

OPERATION_ID="op_amend_$(date -u +"%Y%m%d%H%M%S")_$$"
"$APPEND_SCRIPT" \
  "$TASK_DIR" \
  "planner-bridge" \
  "$OPERATION_ID" \
  "PLANNER_AMENDMENT_BATCH_APPLIED" \
  "planner_amendment_batch_applied"

echo "planner amendment batch applied: task_id=$TASK_ID batch=$BATCH_PATH"
