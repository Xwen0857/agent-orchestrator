import { PlannerContractError } from "./orchestrate-planner-errors.js";

export type SplitPlanV1Input = {
  schema_version: "planner-split-plan-v1";
  task_id?: unknown;
  planner_phase?: unknown;
  decomposition_strategy?: unknown;
  release_policy?: unknown;
  initial_partition?: unknown;
  refinement_partition?: unknown;
  decision_context?: unknown;
};

export function normalizeSplitPlanSchema(raw: Record<string, unknown>): SplitPlanV1Input {
  const schemaVersionRaw = raw.schema_version;
  if (schemaVersionRaw === "planner-split-plan-v1") {
    return {
      ...raw,
      schema_version: "planner-split-plan-v1",
    };
  }
  if (schemaVersionRaw == null || schemaVersionRaw === "") {
    // legacy-v0 compatibility: only inject schema_version for migration.
    // Do not extend legacy payload semantics beyond v1 structural parsing/validation.
    return {
      ...raw,
      schema_version: "planner-split-plan-v1",
    };
  }
  throw new PlannerContractError({
    code: "TYPE_MISMATCH",
    field: "split_plan.schema_version",
    detail: `unsupported schema version: ${String(schemaVersionRaw)}`,
  });
}
