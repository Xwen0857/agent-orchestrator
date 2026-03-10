import {
  buildFallbackSplitPlan,
  extractPlannerDecision,
  extractSplitPlan,
  type PlannerDecision,
  type SplitPlan,
} from "./orchestrate-planner-contract.js";
import { asPlannerContractError, PlannerContractError } from "./orchestrate-planner-errors.js";
import { buildPlannerDependencyHints } from "./orchestrate-planner-hints-contract.js";

export type PlannerInitialPartitionProjection = {
  strategy: string;
  modules: number;
  expanded: boolean;
};

export type PlannerWorkerRefinementProjection = {
  required: boolean;
  scope: string;
  strategy: string;
  principle: string;
  componentCandidates: string[];
  rationale: string[];
};

export type PlannerDecouplingProjection = {
  principle: string;
  confidence: string;
  rationale: string[];
  guardrailTriggered: boolean;
  guardrailNotes: string[];
};

export type PlannerDependencyProjection = {
  plannerHintContractVersion: string;
};

export type PlannerContractErrorProjection = {
  code?: string;
  field?: string;
  detail?: string;
};

export type PlannerProjectionEnvelope = {
  planningDecision: PlannerDecision;
  splitPlan: SplitPlan;
  initialPartition: PlannerInitialPartitionProjection;
  workerRefinement: PlannerWorkerRefinementProjection;
  decoupling: PlannerDecouplingProjection;
  dependency: PlannerDependencyProjection;
  plannerContractError?: PlannerContractErrorProjection;
};

type PlannerProjectionInput = {
  planningDecisionRaw: unknown;
  splitPlanRaw: unknown;
};

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildFallbackPlannerDecision(): PlannerDecision {
  return extractPlannerDecision({
    decision_source: "manual_override",
    decision_reason: "planner_decision_fallback",
    decision_signals: {},
    meta_decomposition: {
      decision_source: "manual_override",
      decomposition_strategy: "meta_single_unit",
      meta_unit_count: 1,
      primary_principle: "functional_decoupling",
      decoupling_confidence: "low",
      decoupling_rationale: ["fallback_due_to_invalid_planner_decision_input"],
    },
    worker_refinement: {
      required: true,
      refinement_strategy: "linear_split_units_placeholder",
      refinement_scope: "single_meta_input",
      primary_principle: "engineering_decoupling",
      component_candidates: ["implementation_unit"],
      refinement_rationale: ["fallback_due_to_invalid_planner_decision_input"],
    },
    granularity_guardrails: {
      mode: "soft",
      fragment_upper_bound: {
        max_meta_units: 4,
        max_leaf_units_per_meta: 8,
      },
      fragment_lower_bound: {
        min_meaningful_meta_units: 1,
        min_meaningful_leaf_scope: "component_sized",
      },
      guardrail_triggered: false,
      guardrail_notes: [],
    },
  });
}

function safeExtractPlannerDecision(
  value: unknown,
): { decision: PlannerDecision; error?: PlannerContractErrorProjection } {
  try {
    return { decision: extractPlannerDecision(value) };
  } catch (error) {
    const plannerContractError = asPlannerContractError(error);
    const detail =
      plannerContractError?.detail ??
      (error instanceof Error ? error.message : String(error));
    return {
      decision: buildFallbackPlannerDecision(),
      error: {
        code: plannerContractError?.code ?? "TYPE_MISMATCH",
        field: plannerContractError?.field ?? "meta.planning_decision",
        detail,
      },
    };
  }
}

function safeExtractSplitPlan(
  value: unknown,
): { splitPlan: SplitPlan; error?: PlannerContractErrorProjection } {
  try {
    return { splitPlan: extractSplitPlan(value) };
  } catch (error) {
    const plannerContractError = asPlannerContractError(error);
    const detail =
      plannerContractError?.detail ??
      (error instanceof Error ? error.message : String(error));
    return {
      splitPlan: buildFallbackSplitPlan(),
      error: {
        code: plannerContractError?.code,
        field: plannerContractError?.field,
        detail,
      },
    };
  }
}

function deriveInitialPartition(splitPlan: SplitPlan): PlannerInitialPartitionProjection {
  const initialPartition = extractObject(splitPlan.initial_partition);
  const modules = Array.isArray(initialPartition.modules) ? initialPartition.modules.length : 0;
  const strategy = String(
    initialPartition.strategy ?? (modules > 1 ? "meta_module_partition" : "meta_single_unit"),
  );
  return {
    strategy,
    modules,
    expanded: modules > 1,
  };
}

function deriveWorkerRefinement(
  splitPlan: SplitPlan,
  planningDecision: PlannerDecision,
): PlannerWorkerRefinementProjection {
  const decisionRefinement = extractObject(planningDecision.worker_refinement);
  const splitRefinement = extractObject(extractObject(splitPlan.decision_context).worker_refinement);
  const initialPartition = extractObject(splitPlan.initial_partition);
  const initialModules = Array.isArray(initialPartition.modules) ? initialPartition.modules : [];
  const scope = String(
    decisionRefinement.refinement_scope ??
      splitRefinement.refinement_scope ??
      (initialModules.length > 1 ? "multi_meta_input" : "single_meta_input"),
  );
  return {
    required: decisionRefinement.required === true || splitRefinement.required === true || true,
    scope,
    strategy: String(
      decisionRefinement.refinement_strategy ??
        splitRefinement.refinement_strategy ??
        "linear_split_units_placeholder",
    ),
    principle: String(
      decisionRefinement.primary_principle ??
        splitRefinement.primary_principle ??
        "engineering_decoupling",
    ),
    componentCandidates: Array.isArray(decisionRefinement.component_candidates)
      ? decisionRefinement.component_candidates.map((entry) => String(entry))
      : Array.isArray(splitRefinement.component_candidates)
        ? splitRefinement.component_candidates.map((entry) => String(entry))
        : [],
    rationale: Array.isArray(decisionRefinement.refinement_rationale)
      ? decisionRefinement.refinement_rationale.map((entry) => String(entry))
      : Array.isArray(splitRefinement.refinement_rationale)
        ? splitRefinement.refinement_rationale.map((entry) => String(entry))
        : [],
  };
}

function deriveDecoupling(
  splitPlan: SplitPlan,
  planningDecision: PlannerDecision,
): PlannerDecouplingProjection {
  const decisionMeta = extractObject(planningDecision.meta_decomposition);
  const splitMeta = extractObject(extractObject(splitPlan.decision_context).meta_decomposition);
  const decisionGuardrails = extractObject(planningDecision.granularity_guardrails);
  const splitGuardrails = extractObject(extractObject(splitPlan.decision_context).granularity_guardrails);
  const guardrails = Object.keys(decisionGuardrails).length > 0 ? decisionGuardrails : splitGuardrails;
  const rationale = Array.isArray(decisionMeta.decoupling_rationale)
    ? decisionMeta.decoupling_rationale.map((entry) => String(entry))
    : Array.isArray(splitMeta.decoupling_rationale)
      ? splitMeta.decoupling_rationale.map((entry) => String(entry))
      : [];
  const guardrailNotes = Array.isArray(guardrails.guardrail_notes)
    ? guardrails.guardrail_notes.map((entry) => String(entry))
    : [];
  return {
    principle: String(
      decisionMeta.primary_principle ?? splitMeta.primary_principle ?? "functional_decoupling",
    ),
    confidence: String(
      decisionMeta.decoupling_confidence ?? splitMeta.decoupling_confidence ?? "low",
    ),
    rationale,
    guardrailTriggered: guardrails.guardrail_triggered === true,
    guardrailNotes,
  };
}

export function projectPlannerView(params: PlannerProjectionInput): PlannerProjectionEnvelope {
  const decisionResult = safeExtractPlannerDecision(params.planningDecisionRaw);
  const splitPlanResult = safeExtractSplitPlan(params.splitPlanRaw);
  const dependencyHints = buildPlannerDependencyHints(splitPlanResult.splitPlan);

  const error = decisionResult.error ?? splitPlanResult.error;

  return {
    planningDecision: decisionResult.decision,
    splitPlan: splitPlanResult.splitPlan,
    initialPartition: deriveInitialPartition(splitPlanResult.splitPlan),
    workerRefinement: deriveWorkerRefinement(splitPlanResult.splitPlan, decisionResult.decision),
    decoupling: deriveDecoupling(splitPlanResult.splitPlan, decisionResult.decision),
    dependency: {
      plannerHintContractVersion: dependencyHints.planner_hint_contract_version,
    },
    ...(error ? { plannerContractError: error } : {}),
  };
}

export function assertValidPlannerProjection(
  projection: PlannerProjectionEnvelope,
): PlannerProjectionEnvelope {
  if (!projection.splitPlan || !projection.planningDecision) {
    throw new PlannerContractError({
      code: "TYPE_MISMATCH",
      field: "planner_projection",
      detail: "projection missing split plan or planning decision",
    });
  }
  return projection;
}
