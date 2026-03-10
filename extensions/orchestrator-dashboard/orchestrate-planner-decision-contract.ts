import {
  extractObject,
  normalizeBoolean,
  normalizeDecouplingConfidence,
  normalizeDecisionSource,
  normalizeDecompositionStrategy,
  normalizeMetaDecompositionStrategy,
  normalizeNumber,
  normalizePlannerPhase,
  normalizeRefinementScope,
  normalizeReleasePolicy,
} from "./orchestrate-planner-contract-normalize.js";
import { buildDefaultPlannerGranularityGuardrails } from "./orchestrate-planner-policy-contract.js";
import { requireInitialPartition } from "./orchestrate-planner-split-plan-contract.js";
import type {
  PlannerDecision,
  PlannerDecisionEnvelope,
  PlannerGranularityGuardrails,
  PlannerMcpSoftBoundarySignals,
  PlannerMetaDecomposition,
  PlannerTokenPriorityContext,
  PlannerWorkerRefinement,
} from "./orchestrate-planner-contract.js";
import { PlannerContractError } from "./orchestrate-planner-errors.js";

function requireMetaDecomposition(value: unknown): PlannerMetaDecomposition {
  const raw = extractObject(value);
  if (Object.keys(raw).length === 0) {
    throw new PlannerContractError({
      code: "MISSING_FIELD",
      field: "planner_decision.meta_decomposition",
    });
  }
  const rationale = Array.isArray(raw.decoupling_rationale)
    ? raw.decoupling_rationale.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return {
    decision_source: normalizeDecisionSource(raw.decision_source),
    decomposition_strategy: normalizeMetaDecompositionStrategy(raw.decomposition_strategy),
    meta_unit_count: Math.floor(normalizeNumber(raw.meta_unit_count, 1, 1)),
    primary_principle: "functional_decoupling",
    decoupling_confidence: normalizeDecouplingConfidence(raw.decoupling_confidence),
    decoupling_rationale: rationale,
  };
}

function requireWorkerRefinement(value: unknown): PlannerWorkerRefinement {
  const raw = extractObject(value);
  if (Object.keys(raw).length === 0) {
    throw new PlannerContractError({
      code: "MISSING_FIELD",
      field: "planner_decision.worker_refinement",
    });
  }
  const componentCandidates = Array.isArray(raw.component_candidates)
    ? raw.component_candidates.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const rationale = Array.isArray(raw.refinement_rationale)
    ? raw.refinement_rationale.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return {
    required: true,
    refinement_strategy: "linear_split_units_placeholder",
    refinement_scope: normalizeRefinementScope(raw.refinement_scope),
    primary_principle: "engineering_decoupling",
    ...(componentCandidates.length > 0
      ? { component_candidates: componentCandidates }
      : {}),
    ...(rationale.length > 0 ? { refinement_rationale: rationale } : {}),
  };
}

function extractPlannerGranularityGuardrails(
  value: unknown,
): PlannerGranularityGuardrails | undefined {
  const raw = extractObject(value);
  if (Object.keys(raw).length === 0) {
    return undefined;
  }
  const defaults = buildDefaultPlannerGranularityGuardrails();
  const upper = extractObject(raw.fragment_upper_bound);
  const lower = extractObject(raw.fragment_lower_bound);
  const notes = Array.isArray(raw.guardrail_notes)
    ? raw.guardrail_notes.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return {
    mode: "soft",
    fragment_upper_bound: {
      max_meta_units: Math.floor(
        normalizeNumber(upper.max_meta_units, defaults.fragment_upper_bound.max_meta_units, 1),
      ),
      max_leaf_units_per_meta: Math.floor(
        normalizeNumber(
          upper.max_leaf_units_per_meta,
          defaults.fragment_upper_bound.max_leaf_units_per_meta,
          1,
        ),
      ),
    },
    fragment_lower_bound: {
      min_meaningful_meta_units: Math.floor(
        normalizeNumber(
          lower.min_meaningful_meta_units,
          defaults.fragment_lower_bound.min_meaningful_meta_units,
          1,
        ),
      ),
      min_meaningful_leaf_scope: "component_sized",
    },
    guardrail_triggered: normalizeBoolean(raw.guardrail_triggered, false),
    guardrail_notes: notes,
  };
}

function extractTokenPriorityContext(value: unknown): PlannerTokenPriorityContext | undefined {
  const raw = extractObject(value);
  if (Object.keys(raw).length === 0) {
    return undefined;
  }
  return {
    tier: "highest",
    reserved_ratio: normalizeNumber(raw.reserved_ratio, 0.35, 0),
    min_planning_tokens: Math.floor(normalizeNumber(raw.min_planning_tokens, 1200, 1)),
    max_planning_tokens: Math.floor(normalizeNumber(raw.max_planning_tokens, 6000, 1)),
    inline_override_applied: normalizeBoolean(raw.inline_override_applied, false),
    effective_planning_tokens: Math.floor(normalizeNumber(raw.effective_planning_tokens, 1200, 1)),
  };
}

function extractMcpSoftBoundarySignals(
  value: unknown,
): PlannerMcpSoftBoundarySignals | undefined {
  const raw = extractObject(value);
  if (Object.keys(raw).length === 0) {
    return undefined;
  }
  return {
    mode: "bias_plan",
    isolation_enabled: normalizeBoolean(raw.isolation_enabled, false),
    orchestrator_profile_name: String(raw.orchestrator_profile_name ?? ""),
    project_profile_name: String(raw.project_profile_name ?? ""),
    orchestrator_mcp_dir: String(raw.orchestrator_mcp_dir ?? ""),
    project_mcp_dir: String(raw.project_mcp_dir ?? ""),
    orchestrator_namespace_read_only: normalizeBoolean(raw.orchestrator_namespace_read_only, false),
    project_namespace_read_only: normalizeBoolean(raw.project_namespace_read_only, false),
  };
}

export function extractPlannerDecision(value: unknown): PlannerDecision {
  const raw = extractObject(value);
  const decisionSource = normalizeDecisionSource(raw.decision_source);
  const metaDecomposition = requireMetaDecomposition(raw.meta_decomposition);
  const workerRefinement = requireWorkerRefinement(raw.worker_refinement);

  return {
    decision_source: decisionSource,
    decision_reason: String(raw.decision_reason ?? ""),
    decision_signals: extractObject(raw.decision_signals),
    planner_phase: normalizePlannerPhase(raw.planner_phase),
    decomposition_strategy: normalizeDecompositionStrategy(raw.decomposition_strategy),
    release_policy: normalizeReleasePolicy(raw.release_policy),
    request_authority:
      raw.request_authority === "task_local_strategy_meta" ? "task_local_strategy_meta" : undefined,
    llm_role: raw.llm_role === "primary" ? "primary" : undefined,
    llm_decision_used:
      typeof raw.llm_decision_used === "boolean" ? raw.llm_decision_used : undefined,
    token_priority_context: extractTokenPriorityContext(raw.token_priority_context),
    mcp_soft_boundary_signals: extractMcpSoftBoundarySignals(raw.mcp_soft_boundary_signals),
    meta_decomposition: metaDecomposition,
    worker_refinement: workerRefinement,
    granularity_guardrails:
      extractPlannerGranularityGuardrails(raw.granularity_guardrails) ??
      buildDefaultPlannerGranularityGuardrails(),
    agent_contract_version:
      raw.agent_contract_version === "planner-core-v2" ? "planner-core-v2" : undefined,
  };
}

function buildDecisionSplitPlanSummary(
  decision: PlannerDecision,
  splitPlan?: Record<string, unknown>,
): Record<string, unknown> {
  const raw = extractObject(splitPlan);
  const summary: Record<string, unknown> = {
    planner_phase: decision.planner_phase ?? "initial_plan",
    decomposition_strategy: decision.decomposition_strategy ?? "(none)",
    release_policy: decision.release_policy ?? "immediate_first_wave",
  };
  if (raw.split_units_planned !== undefined) {
    summary.split_units_planned = raw.split_units_planned;
  }
  if (raw.children !== undefined) {
    summary.children = raw.children;
  }
  return summary;
}

export function extractPlannerDecisionEnvelope(value: unknown): PlannerDecisionEnvelope {
  const raw = extractObject(value);
  const embedded = extractObject(raw.planner_decision);
  const decisionSource = Object.keys(embedded).length > 0 ? embedded : raw;
  const decision = extractPlannerDecision(decisionSource);
  const initialPartition = requireInitialPartition(
    raw.initial_partition ??
      extractObject(raw.apply_contract).initial_partition,
  );
  const taskId = String(raw.task_id ?? extractObject(raw.task).task_id ?? "");
  const requestId =
    typeof raw.request_id === "string" && raw.request_id.trim()
      ? raw.request_id
      : `planner_request_${taskId || "unknown"}`;
  return {
    schema_version: "planner-decision-v1",
    decision_id:
      typeof raw.decision_id === "string" && raw.decision_id.trim()
        ? raw.decision_id
        : `planner_decision_${taskId || "unknown"}`,
    request_id: requestId,
    task_id: taskId,
    planner_decision: decision,
    initial_partition: initialPartition,
    split_plan_summary: buildDecisionSplitPlanSummary(
      decision,
      Object.keys(extractObject(raw.split_plan_summary)).length > 0
        ? extractObject(raw.split_plan_summary)
        : undefined,
    ),
    apply_contract: {
      initial_partition: requireInitialPartition(
        extractObject(raw.apply_contract).initial_partition ?? initialPartition,
      ),
      worker_refinement: requireWorkerRefinement(
        extractObject(raw.apply_contract).worker_refinement ?? decision.worker_refinement,
      ),
      decomposition_strategy: String(
        extractObject(raw.apply_contract).decomposition_strategy ??
          decision.decomposition_strategy ??
          "(none)",
      ),
      release_policy: String(
        extractObject(raw.apply_contract).release_policy ?? decision.release_policy ?? "immediate_first_wave",
      ),
    },
    execution_target:
      raw.execution_target === "container" ||
      raw.execution_target === "distributed" ||
      raw.execution_target === "local_threads"
        ? raw.execution_target
        : "local_threads",
    compat: {
      agent_contract_version:
        extractObject(raw.compat).agent_contract_version === "planner-core-v2" ||
        decision.agent_contract_version === "planner-core-v2"
          ? "planner-core-v2"
          : undefined,
    },
  };
}
