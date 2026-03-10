#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Prepares the single-meta-input refinement path. This path skips the first-layer
# Meta split, but still materializes the required worker refinement artifacts.
# Inputs: task directory and the chosen worker id.
# Side effects: writes planner primary/checklist artifacts, creates a worker task file,
# updates lifecycle logs, and rewrites the task plan file with single-worker constraints.
# Failure model: exits non-zero on missing task metadata, strategy input, or file generation errors.

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task_dir> <worker_id>"
  exit 2
fi

TASK_DIR="$1"
WORKER_ID="$2"
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

TITLE="$(jq -r '.title // .summary_input.task_goal // .goal // "untitled"' "$STRATEGY")"
load_planner_strategy_summary "$STRATEGY"
RISK="$(jq -r '.risk_level // "MEDIUM"' "$STRATEGY")"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PRIMARY_ID="primary_${TASK_ID#task_}"
CHECKLIST_ID="CL_${TASK_ID#task_}"
SUBCHECKLIST_ID="SCL_${TASK_ID#task_}_001"
PLANNER_DECISION_JSON_INPUT="${PLANNER_DECISION_JSON:-}"
PLANNER_DECISION_CONTEXT_JSON_INPUT="${PLANNER_DECISION_CONTEXT_JSON:-{}}"
PLANNER_INITIAL_PARTITION_JSON_INPUT="${PLANNER_INITIAL_PARTITION_JSON:-}"
DEFAULT_INITIAL_PARTITION_JSON='{"strategy":"meta_single_unit","modules":[{"module_id":"meta_unit_001","module_title":"root_meta_unit","child_tasks":[]}]}'
INITIAL_PARTITION_JSON_FOR_WRITE="$PLANNER_INITIAL_PARTITION_JSON_INPUT"
if ! jq -e . >/dev/null 2>&1 <<<"$INITIAL_PARTITION_JSON_FOR_WRITE"; then
  INITIAL_PARTITION_JSON_FOR_WRITE="$DEFAULT_INITIAL_PARTITION_JSON"
fi
PLANNER_DECISION_RELEASE_POLICY_INPUT="${PLANNER_DECISION_RELEASE_POLICY:-immediate_first_wave}"
PLANNER_DECOMPOSITION_STRATEGY_INPUT="${PLANNER_DECISION_DECOMPOSITION_STRATEGY:-single_path}"
PLANNER_WORKER_REFINEMENT_SCOPE_INPUT="${PLANNER_WORKER_REFINEMENT_SCOPE:-single_meta_input}"
PLANNER_WORKER_REFINEMENT_STRATEGY_INPUT="${PLANNER_WORKER_REFINEMENT_STRATEGY:-linear_split_units_placeholder}"

PRIMARY_TEMPLATE_FILE="$ROOT/templates/coordination/planner/primary.example.md"
PRIMARY_FILE="$(resolve_planner_primary_path)"
CHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/planner/checklist.example.md"
CHECKLIST_FILE="$(resolve_planner_checklist_path)"
DEPENDENCY_SEMANTICS_PATH="$ROOT/templates/coordination/orchestrator/planner_dependency_semantics.json"
DEPENDENCY_DEFAULTS_PATH="$ROOT/templates/coordination/orchestrator/planner_dependency_defaults.json"
SUBCHECKLIST_TEMPLATE_FILE="$ROOT/templates/coordination/tasks/subchecklist.example.md"
SUBCHECKLIST_FILE="$(resolve_subchecklists_runtime_dir)/${SUBCHECKLIST_ID}.md"
WORKER_TASKS_TEMPLATE_FILE="$ROOT/templates/coordination/tasks/worker-task.example.md"
WORKER_TASKS_FILE="$(resolve_worker_tasks_runtime_dir)/${WORKER_ID}_tasks.md"
WORKER_LIFECYCLE_FILE="$ROOT/templates/coordination/worker_lifecycle/${WORKER_ID}_lifecycle.md"

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

# Materialize all runtime destinations before writing so later template expansion
# and file appends share a stable directory layout.
mkdir -p "$(dirname "$PRIMARY_FILE")" "$(dirname "$CHECKLIST_FILE")" "$(dirname "$SUBCHECKLIST_FILE")" "$(dirname "$WORKER_TASKS_FILE")" "$(dirname "$WORKER_LIFECYCLE_FILE")"

ensure_runtime_file_from_template "$PRIMARY_FILE" "$PRIMARY_TEMPLATE_FILE"

ensure_planner_checklist_file "$CHECKLIST_FILE" "$CHECKLIST_TEMPLATE_FILE"
ensure_runtime_file_from_template "$WORKER_TASKS_FILE" "$WORKER_TASKS_TEMPLATE_FILE"

if [[ ! -f "$WORKER_LIFECYCLE_FILE" ]]; then
  cat > "$WORKER_LIFECYCLE_FILE" <<'TABLE'
| timestamp | worker_task | owner_role | lifecycle_event | status | notes |
|---|---|---|---|---|---|
TABLE
fi

if ! grep -Fq "$PRIMARY_ID" "$PRIMARY_FILE"; then
  printf '| %s | %s | %s | %s | %s | P1 | STARTED | YES |\n' \
    "$PRIMARY_ID" "$TITLE" "$PLANNER_GOAL" "risk=$RISK; single-worker; strategy=$PLANNER_DECOMPOSITION_STRATEGY_INPUT; release=$PLANNER_DECISION_RELEASE_POLICY_INPUT" "delivery files + unittest pass" >> "$PRIMARY_FILE"
fi

if ! grep -Fq "$CHECKLIST_ID" "$CHECKLIST_FILE"; then
  printf '| %s | %s | planner | IN_PROGRESS |  | code+test prepared | task=%s |\n' \
    "$CHECKLIST_ID" "$TITLE" "$TASK_ID" >> "$CHECKLIST_FILE"
fi

ensure_runtime_file_from_template "$SUBCHECKLIST_FILE" "$SUBCHECKLIST_TEMPLATE_FILE"
cat > "$SUBCHECKLIST_FILE" <<TABLE
| subchecklist_id | checklist_item_id | title | status | verification_rule | notes |
|---|---|---|---|---|---|
| $SUBCHECKLIST_ID | $CHECKLIST_ID | $TITLE | READY | tester_result.json status PASS | generated_at=$NOW |
TABLE

if ! grep -Fq "$TASK_ID" "$WORKER_TASKS_FILE"; then
  printf '| %s | %s | %s | %s | %s | worker-delivery | ASSIGNED | P1 | 0 | prepared_at=%s |\n' \
    "$TASK_ID" "$PRIMARY_ID" "$CHECKLIST_ID" "$SUBCHECKLIST_ID" "$TITLE" "$NOW" >> "$WORKER_TASKS_FILE"
fi

if ! grep -Fq "$TASK_ID" "$WORKER_LIFECYCLE_FILE"; then
  printf '| %s | %s | planner-ops | CREATED | ACTIVE | planned assignment generated |\n' \
    "$NOW" "$TASK_ID" >> "$WORKER_LIFECYCLE_FILE"
fi

# Rewrite the task plan through a temp file so the plan never lands in a partially
# updated state if the transformation fails mid-stream.
PLAN_TMP="$(mktemp "$TASK_DIR/.plan.XXXXXX")"
awk -v title="$TITLE" '
  {
    if ($0 ~ /^- Scope:[[:space:]]*$/) {
      print "- Scope: " title
    } else if ($0 ~ /^- Constraints:[[:space:]]*$/) {
      print "- Constraints: single-worker deterministic pipeline"
    } else if ($0 ~ /^- Milestones:[[:space:]]*$/) {
      print "- Milestones: PLAN->ASSIGN->IMPLEMENT->TEST->CLOSE"
    } else {
      print
    }
  }
' "$TASK_DIR/plan.md" > "$PLAN_TMP"
mv "$PLAN_TMP" "$TASK_DIR/plan.md"

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
      decomposition_strategy: ($initial_partition.strategy // "meta_single_unit"),
      meta_unit_count: (($initial_partition.modules // []) | length),
      primary_principle: "functional_decoupling",
      decoupling_confidence: "low",
      decoupling_rationale: ["no strong functional boundary detected"]
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
    split_units_planned: 1,
    children: [],
    decision_context: $decision_context,
    initial_partition: $initial_partition,
    refinement_partition: {
      strategy: $refinement_strategy,
      input_scope: $refinement_scope,
      granularity: "temporary_refinement_granularity",
      component_candidates: (
        ($decision_context.worker_refinement.component_candidates // [])
        | if type == "array" then . else [] end
      ),
      leaf_units: [
        {
          leaf_id: "leaf_1",
          module_id: (($initial_partition.modules[0].module_id // "meta_unit_001")),
          module_title: (($initial_partition.modules[0].module_title // "root_meta_unit")),
          component_candidate: (
            (($decision_context.worker_refinement.component_candidates // [])
            | if type == "array" and length > 0 then .[0] else "implementation_unit" end)
          ),
          depends_on_component_candidates: [],
          depends_on_leaf_ids: [],
          stage_id: "stage_1",
          sequence: 1,
          total_units: 1,
          worker_task_id: $task_id,
          release_state: $release_policy
        }
      ],
      dependency_summary: {
        mode: $dependency_semantics.dependency_mode,
        roots: 1,
        blocked: 0,
        links: 0,
        cross_module_links: 0,
        note: $dependency_defaults.summary_note
      },
      backlog: []
    }
  }
  ' > "$split_plan_path"

jq \
  --argjson children '[]' \
  --arg aggregate_state "READY_FOR_REFINEMENT" \
  --argjson split_units_planned 1 \
  --arg now "$NOW" \
  '.children = $children | .aggregate_state = $aggregate_state | .split_units_planned = $split_units_planned | .updated_at = $now' \
  "$META" > "$META.tmp" && mv "$META.tmp" "$META"

echo "planner prepared: task_id=$TASK_ID worker_id=$WORKER_ID"
