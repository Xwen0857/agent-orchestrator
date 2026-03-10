import type {
  PlannerDecouplingConfidence,
  PlannerDecisionSource,
  PlannerDecompositionStrategy,
  PlannerExecutionTarget,
  PlannerMetaDecompositionStrategy,
  PlannerPhase,
  PlannerRefinementScope,
  PlannerReleasePolicy,
} from "./orchestrate-planner-contract.js";

export function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeDecisionSource(value: unknown): PlannerDecisionSource {
  return value === "planner_llm" || value === "planner_rules_fallback" ? value : "manual_override";
}

export function normalizePlannerPhase(value: unknown): PlannerPhase | undefined {
  return value === "initial_plan" || value === "replan" ? value : undefined;
}

export function normalizeDecompositionStrategy(
  value: unknown,
): PlannerDecompositionStrategy | undefined {
  return value === "single_path" || value === "module_first" ? value : undefined;
}

export function normalizeReleasePolicy(value: unknown): PlannerReleasePolicy | undefined {
  return value === "immediate_first_wave" || value === "rolling_followup" ? value : undefined;
}

export function normalizeMetaDecompositionStrategy(value: unknown): PlannerMetaDecompositionStrategy {
  return value === "meta_module_partition" ? "meta_module_partition" : "meta_single_unit";
}

export function normalizeRefinementScope(value: unknown): PlannerRefinementScope {
  return value === "multi_meta_input" ? "multi_meta_input" : "single_meta_input";
}

export function normalizeDecouplingConfidence(value: unknown): PlannerDecouplingConfidence {
  return value === "medium" || value === "high" ? value : "low";
}

export function normalizeNumber(value: unknown, fallback: number, min = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, n);
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeExecutionTarget(value: unknown): PlannerExecutionTarget {
  return value === "container" || value === "distributed" || value === "local_threads"
    ? value
    : "local_threads";
}
