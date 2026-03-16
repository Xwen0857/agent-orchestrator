#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Applies the first-layer initial partition and second-layer worker refinement
# contract from a PlannerDecisionEnvelope. planner_entry
# remains focused on decision output while this wrapper owns the decision-apply path.

if [[ $# -lt 4 ]]; then
  echo "usage: $0 <task_dir> <decision_json> <worker_id> <op_base>"
  exit 2
fi

TASK_DIR="$1"
DECISION_INPUT_JSON="$2"
WORKER_ID="$3"
OP_BASE="$4"

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
APPEND_SCRIPT="$ROOT/agent-orchestrator/scripts/append_task_event.sh"
PLANNER_SINGLE_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_single_worker.sh"
PLANNER_MULTI_SCRIPT="$ROOT/agent-orchestrator/scripts/planner_prepare_workers.sh"

if [[ ! -x "$APPEND_SCRIPT" || ! -x "$PLANNER_SINGLE_SCRIPT" || ! -x "$PLANNER_MULTI_SCRIPT" ]]; then
  echo "planner apply dependencies missing"
  exit 1
fi

META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta.json missing: $META"; exit 1; }
TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing in meta"; exit 1; }

jq -e . >/dev/null 2>&1 <<<"$DECISION_INPUT_JSON" || { echo "invalid decision json"; exit 1; }
if ! jq -e '.planner_decision? and .apply_contract? and (.apply_contract.initial_partition? or .initial_partition?)' >/dev/null 2>&1 <<<"$DECISION_INPUT_JSON"; then
  echo "planner_apply_decision now requires planner-decision envelope with initial_partition"
  exit 1
fi

DECISION_ENVELOPE_JSON="$DECISION_INPUT_JSON"
DECISION_JSON="$(jq -c '.planner_decision' <<<"$DECISION_ENVELOPE_JSON")"
INITIAL_PARTITION_JSON="$(jq -c '.apply_contract.initial_partition // .initial_partition' <<<"$DECISION_ENVELOPE_JSON")"
MODULE_COUNT="$(jq -r 'if (.modules | type) == "array" then (.modules | length) else 0 end' <<<"$INITIAL_PARTITION_JSON")"
if [[ ! "$MODULE_COUNT" =~ ^[0-9]+$ ]] || [[ "$MODULE_COUNT" -lt 1 ]]; then
  echo "initial_partition.modules must contain at least one meta unit"
  exit 1
fi
INITIAL_PARTITION_STRATEGY="$(jq -r '.strategy // "(none)"' <<<"$INITIAL_PARTITION_JSON")"
if [[ "$INITIAL_PARTITION_STRATEGY" == "meta_single_unit" && "$MODULE_COUNT" -gt 1 ]]; then
  echo "initial_partition strategy mismatch: meta_single_unit requires one module"
  exit 1
fi
if [[ "$INITIAL_PARTITION_STRATEGY" == "meta_module_partition" && "$MODULE_COUNT" -lt 2 ]]; then
  echo "initial_partition strategy mismatch: meta_module_partition requires multiple modules"
  exit 1
fi
REFINEMENT_SCOPE="$(jq -r '.apply_contract.worker_refinement.refinement_scope // .planner_decision.worker_refinement.refinement_scope // empty' <<<"$DECISION_ENVELOPE_JSON")"
if [[ -z "$REFINEMENT_SCOPE" ]]; then
  if [[ "$MODULE_COUNT" -gt 1 ]]; then
    REFINEMENT_SCOPE="multi_meta_input"
  else
    REFINEMENT_SCOPE="single_meta_input"
  fi
fi
REFINEMENT_STRATEGY="$(jq -r '.apply_contract.worker_refinement.refinement_strategy // .planner_decision.worker_refinement.refinement_strategy // "linear_split_units_placeholder"' <<<"$DECISION_ENVELOPE_JSON")"
DECOMPOSITION_STRATEGY="$(jq -r '.apply_contract.decomposition_strategy // .planner_decision.decomposition_strategy // "(none)"' <<<"$DECISION_ENVELOPE_JSON")"
RELEASE_POLICY="$(jq -r '.apply_contract.release_policy // .planner_decision.release_policy // "immediate_first_wave"' <<<"$DECISION_ENVELOPE_JSON")"
EXECUTION_TARGET="$(jq -r '.execution_target // "local_threads"' <<<"$DECISION_ENVELOPE_JSON")"
EFFECTIVE_PLANNING_TOKENS="$(jq -r '.token_priority_context.effective_planning_tokens // 0' <<<"$DECISION_JSON")"
MCP_MODE="$(jq -r '.mcp_soft_boundary_signals.mode // "(none)"' <<<"$DECISION_JSON")"
GUARDRAIL_TRIGGERED="$(jq -r '.granularity_guardrails.guardrail_triggered // false' <<<"$DECISION_JSON")"
DECISION_CONTEXT_JSON="$(jq -c --argjson initial_partition "$INITIAL_PARTITION_JSON" --argjson meta_unit_count "$MODULE_COUNT" '{
  llm_role,
  llm_decision_used,
  token_priority_context,
  mcp_soft_boundary_signals,
  meta_decomposition: (.meta_decomposition // {
    decision_source: (.decision_source // "manual_override"),
    decomposition_strategy: ($initial_partition.strategy // "meta_single_unit"),
    meta_unit_count: $meta_unit_count,
    primary_principle: "functional_decoupling",
    decoupling_confidence: "low",
    decoupling_rationale: ["decomposition summary inferred from initial partition"]
  }),
  worker_refinement: (.worker_refinement // {
    required: true,
    refinement_strategy: "linear_split_units_placeholder",
    refinement_scope: (if $meta_unit_count > 1 then "multi_meta_input" else "single_meta_input" end),
    primary_principle: "engineering_decoupling"
  }),
  granularity_guardrails,
  initial_partition: $initial_partition,
  agent_contract_version
}' <<<"$DECISION_JSON")"
REASON_SUMMARY="meta_units=${MODULE_COUNT} initial_partition_strategy=${INITIAL_PARTITION_STRATEGY} refinement_scope=${REFINEMENT_SCOPE} refinement_strategy=${REFINEMENT_STRATEGY} release=${RELEASE_POLICY} planner_tokens=${EFFECTIVE_PLANNING_TOKENS} mcp_mode=${MCP_MODE} guardrail_triggered=${GUARDRAIL_TRIGGERED} execution_target=${EXECUTION_TARGET}"

export PLANNER_DECISION_JSON="$DECISION_JSON"
export PLANNER_DECISION_ENVELOPE_JSON="$DECISION_ENVELOPE_JSON"
export PLANNER_DECISION_CONTEXT_JSON="$DECISION_CONTEXT_JSON"
export PLANNER_INITIAL_PARTITION_JSON="$INITIAL_PARTITION_JSON"
export PLANNER_DECISION_RELEASE_POLICY="$RELEASE_POLICY"
export PLANNER_DECISION_DECOMPOSITION_STRATEGY="$DECOMPOSITION_STRATEGY"
export PLANNER_WORKER_REFINEMENT_SCOPE="$REFINEMENT_SCOPE"
export PLANNER_WORKER_REFINEMENT_STRATEGY="$REFINEMENT_STRATEGY"

printf '%s\n' "$DECISION_ENVELOPE_JSON" > "$TASK_DIR/planner_decision.json"

case "$REFINEMENT_SCOPE" in
  multi_meta_input)
    PLANNER_FORCE_MIN_SPLIT_UNITS=2 "$PLANNER_MULTI_SCRIPT" "$TASK_DIR" "$WORKER_ID" >/dev/null
    APPLY_PATH="multi_meta_input"
    APPLY_EVENT="PLANNER_MULTI_PREPARED"
    APPLY_OP_SUFFIX="_multi"
    ;;
  single_meta_input)
    "$PLANNER_SINGLE_SCRIPT" "$TASK_DIR" "$WORKER_ID" >/dev/null
    APPLY_PATH="single_meta_input"
    APPLY_EVENT="PLANNER_SINGLE_PREPARED"
    APPLY_OP_SUFFIX="_single"
    ;;
  *)
    echo "unsupported refinement_scope: $REFINEMENT_SCOPE"
    exit 1
    ;;
esac

SPLIT_PLAN_PATH="$TASK_DIR/split_plan.json"
DEPENDENCY_ROOTS=0
DEPENDENCY_BLOCKED=0
if [[ -f "$SPLIT_PLAN_PATH" ]]; then
  DEPENDENCY_ROOTS="$(jq -r '.refinement_partition.dependency_summary.roots // 0' "$SPLIT_PLAN_PATH" 2>/dev/null || echo 0)"
  DEPENDENCY_BLOCKED="$(jq -r '.refinement_partition.dependency_summary.blocked // 0' "$SPLIT_PLAN_PATH" 2>/dev/null || echo 0)"
fi
REASON_SUMMARY="${REASON_SUMMARY} dependency_roots=${DEPENDENCY_ROOTS} dependency_blocked=${DEPENDENCY_BLOCKED}"
"$APPEND_SCRIPT" "$TASK_DIR" "planner-core" "${OP_BASE}${APPLY_OP_SUFFIX}" "$APPLY_EVENT" "$REASON_SUMMARY" "CREATED" "CREATED" >/dev/null

jq -cn \
  --arg task_id "$TASK_ID" \
  --argjson initial_meta_units "$MODULE_COUNT" \
  --arg initial_partition_strategy "$INITIAL_PARTITION_STRATEGY" \
  --arg refinement_scope "$REFINEMENT_SCOPE" \
  --arg apply_path "$APPLY_PATH" \
  --arg decomposition_strategy "$DECOMPOSITION_STRATEGY" \
  --arg release_policy "$RELEASE_POLICY" \
  --argjson dependency_roots "$DEPENDENCY_ROOTS" \
  --argjson dependency_blocked "$DEPENDENCY_BLOCKED" \
  '{task_id:$task_id,initial_meta_units:$initial_meta_units,initial_partition_strategy:$initial_partition_strategy,refinement_scope:$refinement_scope,apply_path:$apply_path,decomposition_strategy:$decomposition_strategy,release_policy:$release_policy,dependency_roots:$dependency_roots,dependency_blocked:$dependency_blocked,apply_status:"prepared"}'
