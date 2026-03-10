#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Applies the multi-meta-input refinement path by expanding a first-layer Meta
# decomposition into worker-facing tasks plus planner artifacts.
# Inputs: task directory and an optional worker id prefix.
# Side effects: reads strategy/runtime config, writes planner state files and
# SplitPlan artifacts, and creates worker task assignments under the orchestrator
# state directory.
# Failure model: exits non-zero on missing task metadata, strategy input, or generation failures.

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
source "$ROOT/agent-orchestrator/scripts/planner_state_paths.sh"
source "$ROOT/agent-orchestrator/scripts/planner_strategy_summary.sh"
TASK_ID="$(jq -r '.id' "$META")"
STRATEGY="$TASK_DIR/${TASK_ID}.strategy.json"
if [[ ! -f "$STRATEGY" ]]; then
  echo "strategy missing: $STRATEGY"
  exit 1
fi

PROPS="$ROOT/templates/coordination/planner/properties.md"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
DEPENDENCY_SEMANTICS_PATH="$ROOT/templates/coordination/orchestrator/planner_dependency_semantics.json"
DEPENDENCY_DEFAULTS_PATH="$ROOT/templates/coordination/orchestrator/planner_dependency_defaults.json"
CREATE_TASK_SCRIPT="$ROOT/agent-orchestrator/scripts/create_task_from_strategy.sh"
PRIMARY_TEMPLATE_FILE="$ROOT/templates/coordination/planner/primary.example.md"
PRIMARY_FILE="$(resolve_planner_primary_path)"
CHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/planner/checklist.example.md"
CHECKLIST_FILE="$(resolve_planner_checklist_path)"
COMPLETED_CONTEXT_FILE="$ROOT/templates/coordination/tasks/completed_context.ndjson"

if [[ ! -f "$DEPENDENCY_SEMANTICS_PATH" ]]; then
  echo "planner dependency semantics missing: $DEPENDENCY_SEMANTICS_PATH"
  exit 1
fi
if [[ ! -f "$DEPENDENCY_DEFAULTS_PATH" ]]; then
  echo "planner dependency defaults missing: $DEPENDENCY_DEFAULTS_PATH"
  exit 1
fi
if ! jq -e '
  (.dependency_mode | type == "string" and length > 0) and
  (.summary_note | type == "string" and length > 0) and
  (.component_dependency_map | type == "object")
' "$DEPENDENCY_SEMANTICS_PATH" >/dev/null; then
  echo "invalid planner dependency semantics: $DEPENDENCY_SEMANTICS_PATH"
  exit 1
fi
if ! jq -e '
  (.dependency_mode | type == "string" and length > 0) and
  (.summary_note | type == "string" and length > 0) and
  (.fallback_dependency_summary | type == "object") and
  (.fallback_dependency_summary.roots | type == "number") and
  (.fallback_dependency_summary.blocked | type == "number") and
  (.fallback_dependency_summary.links | type == "number") and
  (.fallback_dependency_summary.cross_module_links | type == "number")
' "$DEPENDENCY_DEFAULTS_PATH" >/dev/null; then
  echo "invalid planner dependency defaults: $DEPENDENCY_DEFAULTS_PATH"
  exit 1
fi

# Pull strategy and related historical context before generating any new worker outputs
# so planner artifacts and worker tasks are derived from the same snapshot.
TITLE="$(jq -r '.title // .summary_input.task_goal // .goal // "untitled"' "$STRATEGY")"
load_planner_strategy_summary "$STRATEGY"
OWNER="$(jq -r '.owner // "planner-ops"' "$STRATEGY")"
RISK="$(jq -r '.risk_level // "MEDIUM"' "$STRATEGY")"
BUDGET_SECONDS="$(jq -r '.budget.max_execution_time_seconds // 3600' "$STRATEGY")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PRIMARY_ID="primary_${TASK_ID#task_}"
CHECKLIST_ID="CL_${TASK_ID#task_}"
PLANNER_DECISION_JSON_INPUT="${PLANNER_DECISION_JSON:-}"
PLANNER_DECISION_CONTEXT_JSON_INPUT="${PLANNER_DECISION_CONTEXT_JSON:-{}}"
PLANNER_INITIAL_PARTITION_JSON_INPUT="${PLANNER_INITIAL_PARTITION_JSON:-}"
DEFAULT_INITIAL_PARTITION_JSON='{"strategy":"meta_module_partition","modules":[{"module_id":"module_001","module_title":"module_1","child_tasks":[]},{"module_id":"module_002","module_title":"module_2","child_tasks":[]}]}'
INITIAL_PARTITION_JSON_FOR_WRITE="$PLANNER_INITIAL_PARTITION_JSON_INPUT"
if ! jq -e . >/dev/null 2>&1 <<<"$INITIAL_PARTITION_JSON_FOR_WRITE"; then
  INITIAL_PARTITION_JSON_FOR_WRITE="$DEFAULT_INITIAL_PARTITION_JSON"
fi
PLANNER_DECISION_RELEASE_POLICY_INPUT="${PLANNER_DECISION_RELEASE_POLICY:-immediate_first_wave}"
PLANNER_DECOMPOSITION_STRATEGY_INPUT="${PLANNER_DECISION_DECOMPOSITION_STRATEGY:-module_first}"
PLANNER_WORKER_REFINEMENT_SCOPE_INPUT="${PLANNER_WORKER_REFINEMENT_SCOPE:-multi_meta_input}"
PLANNER_WORKER_REFINEMENT_STRATEGY_INPUT="${PLANNER_WORKER_REFINEMENT_STRATEGY:-linear_split_units_placeholder}"

RELATED_COMPLETED_TASKS="$(python3 - "$TITLE" "$PLANNER_GOAL" "$COMPLETED_CONTEXT_FILE" <<'PY'
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

# Property helpers keep markdown-backed planner config optional instead of forcing
# every caller to pre-populate template files.
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

ensure_runtime_file_from_template "$PRIMARY_FILE" "$PRIMARY_TEMPLATE_FILE"
ensure_planner_checklist_file "$CHECKLIST_FILE" "$CHECKLIST_TEMPLATE_FILE"

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

EST_MINUTES="$(estimate_minutes_from_goal "$PLANNER_GOAL")"
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
    "$PRIMARY_ID" "$TITLE" "$PLANNER_GOAL" "risk=$RISK; split_units=$SPLIT_UNITS; related_completed=$RELATED_COMPLETED_TASKS" "delivery files + unittest pass" >> "$PRIMARY_FILE"
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
TASKS_ROOT="$(cd "$TASK_DIR/.." && pwd -P)"

for i in $(seq 1 "$SPLIT_UNITS"); do
  suffix="$(printf '%03d' "$i")"
  child_id="task_${TASK_ID#task_}_c${suffix}"
  child_title="${TITLE} [unit ${i}/${SPLIT_UNITS}]"
  child_goal="${TASK_GOAL} (subtask ${i}/${SPLIT_UNITS})"
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
if jq -e . >/dev/null 2>&1 <<<"$PLANNER_DECISION_CONTEXT_JSON_INPUT" && [[ "$PLANNER_DECISION_CONTEXT_JSON_INPUT" != "{}" ]]; then
  DECISION_CONTEXT_JSON="$(jq -c \
    --arg decision_source "$(jq -r '.decision_source // "manual_override"' <<<"${PLANNER_DECISION_JSON_INPUT:-{}}")" \
    --argjson initial_partition "$INITIAL_PARTITION_JSON_FOR_WRITE" \
    --arg refinement_scope "$PLANNER_WORKER_REFINEMENT_SCOPE_INPUT" \
    --arg refinement_strategy "$PLANNER_WORKER_REFINEMENT_STRATEGY_INPUT" \
    '
    .meta_decomposition = (.meta_decomposition // {
      decision_source: $decision_source,
      decomposition_strategy: ($initial_partition.strategy // "meta_module_partition"),
      meta_unit_count: (($initial_partition.modules // []) | length),
      primary_principle: "functional_decoupling",
      decoupling_confidence: "medium",
      decoupling_rationale: ["functional boundaries identified for multi-module planning"]
    })
    | .worker_refinement = (.worker_refinement // {
      required: true,
      refinement_strategy: $refinement_strategy,
      refinement_scope: $refinement_scope,
      primary_principle: "engineering_decoupling"
    })
    | .granularity_guardrails = (.granularity_guardrails // {
      mode: "soft",
      fragment_upper_bound: {
        max_meta_units: 4,
        max_leaf_units_per_meta: 8
      },
      fragment_lower_bound: {
        min_meaningful_meta_units: 1,
        min_meaningful_leaf_scope: "component_sized"
      },
      guardrail_triggered: false,
      guardrail_notes: []
    })
    | .initial_partition = (.initial_partition // $initial_partition)
    ' <<<"$PLANNER_DECISION_CONTEXT_JSON_INPUT")"
elif jq -e . >/dev/null 2>&1 <<<"$PLANNER_DECISION_JSON_INPUT"; then
  DECISION_CONTEXT_JSON="$(jq -c '{
    llm_role,
    llm_decision_used,
    token_priority_context,
    mcp_soft_boundary_signals,
    meta_decomposition,
    worker_refinement,
    granularity_guardrails,
    agent_contract_version
  }' <<<"$PLANNER_DECISION_JSON_INPUT")"
else
  DECISION_CONTEXT_JSON='{}'
fi
jq -n \
  --arg task_id "$TASK_ID" \
  --arg generated_at "$NOW" \
  --arg schema_version "planner-split-plan-v1" \
  --arg decomposition_strategy "$PLANNER_DECOMPOSITION_STRATEGY_INPUT" \
  --arg release_policy "$PLANNER_DECISION_RELEASE_POLICY_INPUT" \
  --argjson initial_partition "$INITIAL_PARTITION_JSON_FOR_WRITE" \
  --arg refinement_scope "$PLANNER_WORKER_REFINEMENT_SCOPE_INPUT" \
  --arg refinement_strategy "$PLANNER_WORKER_REFINEMENT_STRATEGY_INPUT" \
  --argjson logical_threads "$LOGICAL_THREADS" \
  --argjson reserved_threads "$RESERVED_THREADS" \
  --argjson effective_worker_threads "$EFFECTIVE_THREADS" \
  --argjson estimated_minutes "$EST_MINUTES" \
  --argjson split_units_planned "$SPLIT_UNITS" \
  --argjson units_raw "$UNITS_RAW" \
  --argjson units_max "$UNITS_MAX" \
  --argjson children "$CHILDREN_JSON" \
  --argjson decision_context "$DECISION_CONTEXT_JSON" \
  --argjson dependency_semantics "$(jq -c '.' "$DEPENDENCY_SEMANTICS_PATH")" \
  --argjson dependency_defaults "$(jq -c '.' "$DEPENDENCY_DEFAULTS_PATH")" \
  '
  {
    schema_version: $schema_version,
    task_id: $task_id,
    generated_at: $generated_at,
    planner_phase: "initial_plan",
    decomposition_strategy: $decomposition_strategy,
    release_policy: $release_policy,
    host: {
      logical_threads: $logical_threads,
      reserved_threads: $reserved_threads,
      effective_worker_threads: $effective_worker_threads
    },
    estimated_minutes: $estimated_minutes,
    split_units_planned: $split_units_planned,
    units_raw: $units_raw,
    units_max: $units_max,
    children: $children,
    decision_context: $decision_context,
    initial_partition: (
      $initial_partition
      | .modules = (
          ($initial_partition.modules // [])
          | if length > 0 then
              map(
                . + {
                  planned_leaf_count: $split_units_planned,
                  child_tasks: $children
                }
              )
            else
              [
                {
                  module_id: "module_001",
                  module_title: "default_logical_module",
                  rationale: "phase-1 placeholder wrapper around current linear split units",
                  planned_leaf_count: $split_units_planned,
                  child_tasks: $children
                }
              ]
            end
        )
    ),
    refinement_partition: (
      (($initial_partition.modules // [])
      | if length > 0 then . else [{ module_id: "module_001" }] end) as $modules
      | (($decision_context.worker_refinement.component_candidates // [])
        | if type == "array" and length > 0 then . else ["implementation_unit"] end) as $components
      | (($dependency_semantics.component_dependency_map // {})
        | if type == "object" then . else {} end) as $dependency_map
      | ([
          range(0; ($children | length)) as $idx
          | ($modules[($idx % ($modules | length))]) as $module
          | {
              leaf_id: ("leaf_" + (($idx + 1) | tostring)),
              module_id: (($module.module_id) // "module_001"),
              module_title: (($module.module_title) // "default_logical_module"),
              component_candidate: ($components[($idx % ($components | length))]),
              stage_id: ("stage_" + (($idx + 1) | tostring)),
              sequence: ($idx + 1),
              total_units: $split_units_planned,
              child_task_id: $children[$idx],
              release_state: $release_policy
            }
        ]) as $base_leafs
      | ([
          range(0; ($base_leafs | length)) as $idx
          | ($base_leafs[$idx]) as $leaf
          | ($dependency_map[$leaf.component_candidate]) as $dependency_component
          | (
              if ($dependency_component | type) == "string" and ($dependency_component | length) > 0 then
                [$dependency_component]
              else
                []
              end
            ) as $dependency_components
          | (
              if ($dependency_components | length) == 0 then
                []
              else
                [
                  range(0; $idx) as $prev
                  | $base_leafs[$prev]
                  | select(.component_candidate == $dependency_components[0])
                  | .leaf_id
                ]
              end
            ) as $matching_dependency_leafs
          | (
              if ($matching_dependency_leafs | length) > 0 then
                [($matching_dependency_leafs[-1])]
              else
                []
              end
            ) as $dependency_leaf_ids
          | (
              $leaf + {
                depends_on_component_candidates: $dependency_components,
                depends_on_leaf_ids: $dependency_leaf_ids
              }
            )
        ]) as $leaf_units
      | {
          strategy: $refinement_strategy,
          input_scope: $refinement_scope,
          granularity: "temporary_refinement_granularity",
          component_candidates: (
            ($decision_context.worker_refinement.component_candidates // [])
            | if type == "array" then . else [] end
          ),
          leaf_units: $leaf_units,
          dependency_summary: {
            mode: $dependency_semantics.dependency_mode,
            roots: ([$leaf_units[] | select((.depends_on_leaf_ids | length) == 0)] | length),
            blocked: ([$leaf_units[] | select((.depends_on_leaf_ids | length) > 0)] | length),
            links: ([$leaf_units[] | (.depends_on_leaf_ids | length)] | add // 0),
            cross_module_links: (
              [
                $leaf_units[] as $leaf
                | $leaf.depends_on_leaf_ids[]
                | {
                    dep: .,
                    leaf_module: $leaf.module_id
                  }
                | . as $edge
                | ($leaf_units[] | select(.leaf_id == $edge.dep) | .module_id) as $dep_module
                | select($dep_module != null and $dep_module != $edge.leaf_module)
              ] | length
            ),
            note: $dependency_defaults.summary_note
          },
          backlog: []
        }
    )
  }
  ' > "$split_plan_path"

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
