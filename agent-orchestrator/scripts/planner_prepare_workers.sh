#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir> [worker_prefix]"
  exit 2
fi

TASK_DIR="$1"
WORKER_PREFIX="${2:-worker}"
META="$TASK_DIR/meta.json"
if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
TASK_ID="$(jq -r '.id' "$META")"
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
if [[ ! -f "$STRATEGY" ]]; then
  echo "strategy missing: $STRATEGY"
  exit 1
fi

PROPS="$ROOT/templates/coordination/planner/properties.md"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
CREATE_TASK_SCRIPT="$ROOT/agent-orchestrator/scripts/create_task_from_strategy.sh"
PRIMARY_FILE="$ROOT/templates/coordination/planner/primary.md"
CHECKLIST_FILE="$ROOT/templates/coordination/planner/checklist.md"
COMPLETED_CONTEXT_FILE="$ROOT/templates/coordination/tasks/completed_context.ndjson"

TITLE="$(jq -r '.title // .goal // "untitled"' "$STRATEGY")"
GOAL="$(jq -r '.goal // ""' "$STRATEGY")"
OWNER="$(jq -r '.owner // "planner-ops"' "$STRATEGY")"
RISK="$(jq -r '.risk_level // "MEDIUM"' "$STRATEGY")"
BUDGET_SECONDS="$(jq -r '.budget.max_execution_time_seconds // 3600' "$STRATEGY")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PRIMARY_ID="primary_${TASK_ID#task_}"
CHECKLIST_ID="CL_${TASK_ID#task_}"

RELATED_COMPLETED_TASKS="$(python3 - "$TITLE" "$GOAL" "$COMPLETED_CONTEXT_FILE" <<'PY'
import json
import re
import sys
from pathlib import Path

title = sys.argv[1]
goal = sys.argv[2]
ctx_file = Path(sys.argv[3])

if not ctx_file.exists():
    print("(none)")
    raise SystemExit

def tokens(text: str):
    return {t for t in re.split(r"[^a-zA-Z0-9\u4e00-\u9fff]+", (text or "").lower()) if len(t) >= 3}

q = tokens(title + " " + goal)
if not q:
    print("(none)")
    raise SystemExit

rows = []
for line in ctx_file.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
    except Exception:
        continue
    text = f"{row.get('title','')} {row.get('goal','')}"
    r = tokens(text)
    if not r:
        continue
    overlap = len(q & r)
    if overlap <= 0:
        continue
    rows.append((overlap, row))

rows.sort(key=lambda x: x[0], reverse=True)
top = []
for _, row in rows[:3]:
    top.append(f"{row.get('task_id','')}|{row.get('title','')}|tester={row.get('tester_status','')}")

print("; ".join(top) if top else "(none)")
PY
)"

mkdir -p "$(dirname "$PRIMARY_FILE")" "$(dirname "$CHECKLIST_FILE")"

get_prop() {
  local key="$1"
  local fallback="$2"
  if [[ -f "$PROPS" ]]; then
    local line value
    line="$(awk -v k="$key" '$0 ~ "^- " k ":" { print; exit }' "$PROPS" 2>/dev/null || true)"
    if [[ -n "$line" ]]; then
      value="${line#- ${key}:}"
      value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
      if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return
      fi
    fi
  fi
  printf '%s\n' "$fallback"
}

as_float() {
  local value="$1"
  local fallback="$2"
  awk -v v="$value" -v fb="$fallback" 'BEGIN { if (v ~ /^-?[0-9]+(\.[0-9]+)?$/) print v; else print fb; }'
}

as_pos_int() {
  local value="$1"
  local fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -gt 0 ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

detect_logical_threads() {
  local detected=""
  if command -v sysctl >/dev/null 2>&1; then
    detected="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
  fi
  if [[ -z "$detected" ]] && command -v getconf >/dev/null 2>&1; then
    detected="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  if [[ -z "$detected" ]] && command -v nproc >/dev/null 2>&1; then
    detected="$(nproc 2>/dev/null || true)"
  fi
  as_pos_int "${detected:-}" 4
}

estimate_minutes_from_goal() {
  local goal="$1"
  local minutes=""
  if [[ "$goal" =~ ([0-9]{1,4})[[:space:]]*分钟 ]]; then
    minutes="${BASH_REMATCH[1]}"
  elif [[ "$goal" =~ ([0-9]{1,3})[[:space:]]*(小时|h|hour|hours) ]]; then
    minutes="$(( ${BASH_REMATCH[1]} * 60 ))"
  fi
  if [[ -n "$minutes" ]]; then
    printf '%s\n' "$minutes"
    return
  fi
  local from_budget
  from_budget="$(( (BUDGET_SECONDS + 59) / 60 ))"
  if [[ "$from_budget" -le 0 ]]; then
    from_budget=120
  fi
  printf '%s\n' "$from_budget"
}

ceil_div() {
  local a="$1"
  local b="$2"
  echo $(( (a + b - 1) / b ))
}

if [[ ! -f "$PRIMARY_FILE" ]]; then
  cat > "$PRIMARY_FILE" <<'TABLE'
| primary_id | title | scope | constraints | acceptance_criteria | priority | status | start_signal |
|---|---|---|---|---|---|---|---|
TABLE
fi
if [[ ! -f "$CHECKLIST_FILE" ]]; then
  cat > "$CHECKLIST_FILE" <<'TABLE'
| checklist_item_id | title | owner_role | status | depends_on | acceptance | notes |
|---|---|---|---|---|---|---|
TABLE
fi

THREAD_RESERVE_RATIO="$(as_float "$(get_prop thread_reserve_ratio 0.25)" 0.25)"
SPLIT_TARGET_MIN="$(as_pos_int "$(get_prop split_target_minutes_min 45)" 45)"
SPLIT_TARGET_MAX="$(as_pos_int "$(get_prop split_target_minutes_max 90)" 90)"
OVERSUB_RATIO="$(as_float "$(get_prop split_max_oversubscription_ratio 1.5)" 1.5)"
MIN_SPLIT_UNITS="$(as_pos_int "$(get_prop min_split_units_per_task 1)" 1)"
MAX_SPLIT_UNITS_PROP="$(get_prop max_split_units_per_task auto)"

LOGICAL_THREADS="$(detect_logical_threads)"
RESERVED_THREADS="$(awk -v l="$LOGICAL_THREADS" -v r="$THREAD_RESERVE_RATIO" 'BEGIN {v=int((l*r)+0.999999); if (v<1) v=1; print v;}')"
EFFECTIVE_THREADS="$(( LOGICAL_THREADS - RESERVED_THREADS ))"
if [[ "$EFFECTIVE_THREADS" -lt 1 ]]; then
  EFFECTIVE_THREADS=1
fi

EST_MINUTES="$(estimate_minutes_from_goal "$GOAL")"
TARGET_MID=$(( (SPLIT_TARGET_MIN + SPLIT_TARGET_MAX) / 2 ))
if [[ "$TARGET_MID" -lt 1 ]]; then
  TARGET_MID=60
fi
UNITS_RAW="$(ceil_div "$EST_MINUTES" "$TARGET_MID")"

UNITS_MAX_AUTO="$(awk -v e="$EFFECTIVE_THREADS" -v r="$OVERSUB_RATIO" 'BEGIN {v=int((e*r)+0.999999); if (v<1) v=1; print v;}')"
if [[ "$MAX_SPLIT_UNITS_PROP" =~ ^[0-9]+$ ]] && [[ "$MAX_SPLIT_UNITS_PROP" -gt 0 ]]; then
  UNITS_MAX="$MAX_SPLIT_UNITS_PROP"
else
  UNITS_MAX="$UNITS_MAX_AUTO"
fi

SPLIT_UNITS="$UNITS_RAW"
if [[ "$SPLIT_UNITS" -lt "$MIN_SPLIT_UNITS" ]]; then
  SPLIT_UNITS="$MIN_SPLIT_UNITS"
fi
if [[ "$SPLIT_UNITS" -gt "$UNITS_MAX" ]]; then
  SPLIT_UNITS="$UNITS_MAX"
fi
if [[ "$SPLIT_UNITS" -lt 1 ]]; then
  SPLIT_UNITS=1
fi

if [[ "${PLANNER_FORCE_MIN_SPLIT_UNITS:-}" =~ ^[0-9]+$ ]] && [[ "${PLANNER_FORCE_MIN_SPLIT_UNITS:-0}" -gt "$SPLIT_UNITS" ]]; then
  SPLIT_UNITS="$PLANNER_FORCE_MIN_SPLIT_UNITS"
fi

if ! grep -Fq "$PRIMARY_ID" "$PRIMARY_FILE"; then
  printf '| %s | %s | %s | %s | %s | P1 | STARTED | YES |\n' \
    "$PRIMARY_ID" "$TITLE" "$GOAL" "risk=$RISK; split_units=$SPLIT_UNITS; related_completed=$RELATED_COMPLETED_TASKS" "delivery files + unittest pass" >> "$PRIMARY_FILE"
fi

if ! grep -Fq "$CHECKLIST_ID" "$CHECKLIST_FILE"; then
  printf '| %s | %s | planner | IN_PROGRESS |  | split+delivery prepared | task=%s split_units=%s |\n' \
    "$CHECKLIST_ID" "$TITLE" "$TASK_ID" "$SPLIT_UNITS" >> "$CHECKLIST_FILE"
fi

if [[ -f "$TASK_DIR/plan.md" ]] && ! grep -Fq "Related completed tasks:" "$TASK_DIR/plan.md"; then
  {
    echo ""
    echo "- Related completed tasks: $RELATED_COMPLETED_TASKS"
  } >> "$TASK_DIR/plan.md"
fi

CHILDREN_JSON='[]'
TASKS_ROOT="$(cd "$ROOT/templates/coordination/tasks/task_folders" && pwd -P)"
PARENT_REL="templates/coordination/tasks/task_folders/${TASK_ID}"

for i in $(seq 1 "$SPLIT_UNITS"); do
  suffix="$(printf '%03d' "$i")"
  child_id="task_${TASK_ID#task_}_c${suffix}"
  child_title="${TITLE} [unit ${i}/${SPLIT_UNITS}]"
  child_goal="${GOAL} (subtask ${i}/${SPLIT_UNITS})"
  child_budget_seconds="$(( (BUDGET_SECONDS + SPLIT_UNITS - 1) / SPLIT_UNITS ))"
  strategy_tmp="$(mktemp "$TASK_DIR/.child_strategy.XXXXXX.json")"
  jq -n \
    --arg task_id "$child_id" \
    --arg title "$child_title" \
    --arg goal "$child_goal" \
    --arg owner "$OWNER" \
    --arg risk_level "$RISK" \
    --argjson max_token_cost 50000 \
    --argjson max_execution_time_seconds "$child_budget_seconds" \
    '{task_id:$task_id,title:$title,goal:$goal,owner:$owner,risk_level:$risk_level,budget:{max_token_cost:$max_token_cost,max_execution_time_seconds:$max_execution_time_seconds}}' > "$strategy_tmp"

  "$CREATE_TASK_SCRIPT" "$strategy_tmp" "$TASKS_ROOT" >/dev/null
  rm -f "$strategy_tmp"

  child_dir="$TASKS_ROOT/$child_id"
  child_meta="$child_dir/meta.json"
  child_work="$child_dir/work.md"
  child_plan="$child_dir/plan.md"

  jq --arg parent "$TASK_ID" --arg unit "$i" --arg units "$SPLIT_UNITS" \
    --arg now "$NOW" \
    '.parents = (([ $parent ] + (.parents // [])) | unique) | .parent_task_id = $parent | .split_unit = ($unit|tonumber) | .split_units_total = ($units|tonumber) | .updated_at = $now' \
    "$child_meta" > "$child_meta.tmp" && mv "$child_meta.tmp" "$child_meta"

  {
    echo ""
    echo "- Latest action: child task created by planner split"
    echo "- Changed files: plan.md"
    echo "- Parent task: $TASK_ID"
  } >> "$child_work"

  if ! grep -Fq "Parent task:" "$child_plan"; then
    {
      echo ""
      echo "- Parent task: $TASK_ID"
      echo "- Split unit: $i/$SPLIT_UNITS"
    } >> "$child_plan"
  fi

  CHILDREN_JSON="$(jq -cn --argjson arr "$CHILDREN_JSON" --arg child "$child_id" '$arr + [$child]')"
done

split_plan_path="$TASK_DIR/split_plan.json"
jq -n \
  --arg task_id "$TASK_ID" \
  --arg generated_at "$NOW" \
  --argjson logical_threads "$LOGICAL_THREADS" \
  --argjson reserved_threads "$RESERVED_THREADS" \
  --argjson effective_worker_threads "$EFFECTIVE_THREADS" \
  --argjson estimated_minutes "$EST_MINUTES" \
  --argjson split_units_planned "$SPLIT_UNITS" \
  --argjson units_raw "$UNITS_RAW" \
  --argjson units_max "$UNITS_MAX" \
  --argjson children "$CHILDREN_JSON" \
  '{task_id:$task_id,generated_at:$generated_at,host:{logical_threads:$logical_threads,reserved_threads:$reserved_threads,effective_worker_threads:$effective_worker_threads},estimated_minutes:$estimated_minutes,split_units_planned:$split_units_planned,units_raw:$units_raw,units_max:$units_max,children:$children}' > "$split_plan_path"

jq \
  --argjson children "$CHILDREN_JSON" \
  --arg aggregate_state "WAITING_CHILDREN" \
  --argjson split_units_planned "$SPLIT_UNITS" \
  --arg now "$NOW" \
  '.children = $children | .aggregate_state = $aggregate_state | .split_units_planned = $split_units_planned | .updated_at = $now' \
  "$META" > "$META.tmp" && mv "$META.tmp" "$META"

if [[ -f "$RUNTIME_CONFIG" ]]; then
  tmp_runtime="$(mktemp "$TASK_DIR/.runtime.XXXXXX.json")"
  jq \
    --argjson logical "$LOGICAL_THREADS" \
    --argjson reserved "$RESERVED_THREADS" \
    --argjson effective "$EFFECTIVE_THREADS" \
    --argjson max_parallel "$EFFECTIVE_THREADS" \
    --argjson max_tasks "$UNITS_MAX" \
    '.host.logical_threads = $logical | .host.reserved_threads = $reserved | .host.effective_worker_threads = $effective | .local_threads.max_parallel = $max_parallel | .local_threads.max_tasks_per_tick = $max_tasks' \
    "$RUNTIME_CONFIG" > "$tmp_runtime" && mv "$tmp_runtime" "$RUNTIME_CONFIG"
fi

echo "planner prepared workers: task_id=$TASK_ID split_units=$SPLIT_UNITS effective_threads=$EFFECTIVE_THREADS"
