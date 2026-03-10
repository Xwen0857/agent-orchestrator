import { extractObject } from "./orchestrate-planner-contract-normalize.js";
import { loadPlannerDependencyConfig } from "./orchestrate-planner-dependency-semantics.js";
import type { SplitPlan } from "./orchestrate-planner-contract.js";
import {
  requireInitialPartition,
  requireLeafUnits,
  requireRefinementPartition,
} from "./orchestrate-planner-split-plan-parse.js";
import { normalizeSplitPlanSchema } from "./orchestrate-planner-split-plan-schema.js";
import { buildFallbackSplitPlan } from "./orchestrate-planner-split-plan-summary.js";
import {
  validateDependencySummaryConsistency,
  validateRefinementPartitionLinks,
} from "./orchestrate-planner-split-plan-validate.js";

export type SplitPlanExtractDiagnostic = {
  split_plan_extract_ok_count: number;
  split_plan_extract_fail_count: number;
  split_plan_extract_duration_ms: number;
  error_code?: string;
  error_field?: string;
};

let splitPlanExtractOkCount = 0;
let splitPlanExtractFailCount = 0;
let splitPlanExtractDiagnosticsSink: ((event: SplitPlanExtractDiagnostic) => void) | undefined;

export function setSplitPlanExtractDiagnosticsSink(
  sink?: (event: SplitPlanExtractDiagnostic) => void,
): void {
  splitPlanExtractDiagnosticsSink = sink;
}

// Split-plan facade:
// normalize schema -> parse fields -> validate invariants -> return canonical shape.
export function extractSplitPlan(value: unknown): SplitPlan {
  const startedAt = Date.now();
  try {
    const dependencyConfig = loadPlannerDependencyConfig();
    const raw = normalizeSplitPlanSchema(extractObject(value));
    const refinementPartition = requireRefinementPartition(
      raw.refinement_partition,
      dependencyConfig,
    );
    validateRefinementPartitionLinks(refinementPartition);
    validateDependencySummaryConsistency(refinementPartition, dependencyConfig);
    splitPlanExtractOkCount += 1;
    splitPlanExtractDiagnosticsSink?.({
      split_plan_extract_ok_count: splitPlanExtractOkCount,
      split_plan_extract_fail_count: splitPlanExtractFailCount,
      split_plan_extract_duration_ms: Date.now() - startedAt,
    });

    return {
      schema_version: "planner-split-plan-v1",
      task_id: String(raw.task_id ?? ""),
      planner_phase: String(raw.planner_phase ?? ""),
      decomposition_strategy: String(raw.decomposition_strategy ?? ""),
      release_policy: String(raw.release_policy ?? ""),
      initial_partition: requireInitialPartition(raw.initial_partition),
      refinement_partition: refinementPartition,
      decision_context: extractObject(raw.decision_context),
    };
  } catch (error) {
    splitPlanExtractFailCount += 1;
    const diagnostic: SplitPlanExtractDiagnostic = {
      split_plan_extract_ok_count: splitPlanExtractOkCount,
      split_plan_extract_fail_count: splitPlanExtractFailCount,
      split_plan_extract_duration_ms: Date.now() - startedAt,
    };
    if (error && typeof error === "object") {
      if ("code" in error && typeof error.code === "string") {
        diagnostic.error_code = error.code;
      }
      if ("field" in error && typeof error.field === "string") {
        diagnostic.error_field = error.field;
      }
    }
    splitPlanExtractDiagnosticsSink?.(diagnostic);
    throw error;
  }
}

export {
  buildFallbackSplitPlan,
  normalizeSplitPlanSchema,
  requireInitialPartition,
  requireLeafUnits,
  validateRefinementPartitionLinks,
};
