import {
  extractObject,
  normalizeMetaDecompositionStrategy,
  normalizeNumber,
  normalizeRefinementScope,
} from "./orchestrate-planner-contract-normalize.js";
import type { PlannerDependencyConfig } from "./orchestrate-planner-dependency-semantics.js";
import type {
  PlannerInitialPartition,
  PlannerInitialPartitionModule,
  PlannerLeafUnit,
  PlannerRefinementPartition,
} from "./orchestrate-planner-contract.js";
import { PlannerContractError } from "./orchestrate-planner-errors.js";
import { computeDependencySummary } from "./orchestrate-planner-split-plan-summary.js";

function requireNonEmptyString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new PlannerContractError({
      code: "MISSING_FIELD",
      field,
      detail: "non-empty string is required",
    });
  }
  return normalized;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function requirePositiveInt(value: unknown, field: string): number {
  const n = Math.floor(normalizeNumber(value, 0, 0));
  if (n < 1) {
    throw new PlannerContractError({
      code: "TYPE_MISMATCH",
      field,
      detail: "positive integer is required",
    });
  }
  return n;
}

function requireInitialPartitionModule(value: unknown): PlannerInitialPartitionModule {
  const raw = extractObject(value);
  const childTasks = Array.isArray(raw.child_tasks)
    ? raw.child_tasks.map((entry) => String(entry))
    : [];
  return {
    module_id: String(raw.module_id ?? ""),
    module_title: String(raw.module_title ?? ""),
    rationale: raw.rationale == null ? undefined : String(raw.rationale),
    planned_leaf_count:
      raw.planned_leaf_count == null
        ? undefined
        : Math.floor(normalizeNumber(raw.planned_leaf_count, 0, 0)),
    child_tasks: childTasks,
  };
}

export function requireInitialPartition(value: unknown): PlannerInitialPartition {
  const raw = extractObject(value);
  const modulesRaw = Array.isArray(raw.modules) ? raw.modules : [];
  const modules = modulesRaw.map(requireInitialPartitionModule);
  if (modules.length === 0) {
    throw new PlannerContractError({
      code: "MISSING_FIELD",
      field: "initial_partition.modules",
      detail: "at least one module is required",
    });
  }
  const strategy = normalizeMetaDecompositionStrategy(raw.strategy);
  if (strategy === "meta_single_unit" && modules.length > 1) {
    throw new PlannerContractError({
      code: "INVALID_PARTITION_STRATEGY",
      field: "initial_partition.strategy",
      detail: "meta_single_unit requires one module",
    });
  }
  if (strategy === "meta_module_partition" && modules.length < 2) {
    throw new PlannerContractError({
      code: "INVALID_PARTITION_STRATEGY",
      field: "initial_partition.strategy",
      detail: "meta_module_partition requires multiple modules",
    });
  }
  return {
    strategy,
    modules,
  };
}

function requireLeafUnit(value: unknown): PlannerLeafUnit {
  const raw = extractObject(value);
  return {
    leaf_id: requireNonEmptyString(raw.leaf_id, "leaf_units.leaf_id"),
    module_id: requireNonEmptyString(raw.module_id, "leaf_units.module_id"),
    module_title: requireNonEmptyString(raw.module_title, "leaf_units.module_title"),
    component_candidate: requireNonEmptyString(
      raw.component_candidate,
      "leaf_units.component_candidate",
    ),
    depends_on_component_candidates: requireStringArray(raw.depends_on_component_candidates),
    depends_on_leaf_ids: requireStringArray(raw.depends_on_leaf_ids),
    stage_id: requireNonEmptyString(raw.stage_id, "leaf_units.stage_id"),
    sequence: requirePositiveInt(raw.sequence, "leaf_units.sequence"),
    total_units: requirePositiveInt(raw.total_units, "leaf_units.total_units"),
    release_state: requireNonEmptyString(raw.release_state, "leaf_units.release_state"),
    ...(raw.worker_task_id == null
      ? {}
      : { worker_task_id: requireNonEmptyString(raw.worker_task_id, "leaf_units.worker_task_id") }),
    ...(raw.child_task_id == null
      ? {}
      : { child_task_id: requireNonEmptyString(raw.child_task_id, "leaf_units.child_task_id") }),
  };
}

export function requireLeafUnits(value: unknown): PlannerLeafUnit[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.map(requireLeafUnit);
}

export function requireRefinementPartition(
  value: unknown,
  dependencyConfig: PlannerDependencyConfig,
): PlannerRefinementPartition {
  const raw = extractObject(value);
  const strategy =
    raw.strategy === "linear_split_units_placeholder"
      ? "linear_split_units_placeholder"
      : undefined;
  if (!strategy) {
    throw new PlannerContractError({
      code: "MISSING_FIELD",
      field: "refinement_partition.strategy",
      detail: "linear_split_units_placeholder is required",
    });
  }
  const leafUnits = requireLeafUnits(raw.leaf_units);
  const dependencySummaryRaw = extractObject(raw.dependency_summary);
  return {
    strategy,
    input_scope: normalizeRefinementScope(raw.input_scope),
    granularity: requireNonEmptyString(raw.granularity, "refinement_partition.granularity"),
    component_candidates: requireStringArray(raw.component_candidates),
    leaf_units: leafUnits,
    dependency_summary:
      Object.keys(dependencySummaryRaw).length > 0
        ? {
            mode: requireNonEmptyString(dependencySummaryRaw.mode, "dependency_summary.mode") as "component_semantic_linearized",
            roots: Math.floor(normalizeNumber(dependencySummaryRaw.roots, 0, 0)),
            blocked: Math.floor(normalizeNumber(dependencySummaryRaw.blocked, 0, 0)),
            links: Math.floor(normalizeNumber(dependencySummaryRaw.links, 0, 0)),
            cross_module_links: Math.floor(
              normalizeNumber(dependencySummaryRaw.cross_module_links, 0, 0),
            ),
            note: requireNonEmptyString(dependencySummaryRaw.note, "dependency_summary.note"),
          }
        : computeDependencySummary(leafUnits),
    backlog: Array.isArray(raw.backlog) ? raw.backlog : [],
  };
}
