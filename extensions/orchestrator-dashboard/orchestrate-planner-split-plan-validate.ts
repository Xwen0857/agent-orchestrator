import { loadPlannerDependencyConfig } from "./orchestrate-planner-dependency-semantics.js";
import type {
  PlannerDependencyConfig,
} from "./orchestrate-planner-dependency-semantics.js";
import type {
  PlannerLeafUnit,
  PlannerRefinementPartition,
} from "./orchestrate-planner-contract.js";
import { PlannerContractError } from "./orchestrate-planner-errors.js";
import { computeDependencySummary } from "./orchestrate-planner-split-plan-summary.js";

export function validateRefinementPartitionLinks(partition: PlannerRefinementPartition): void {
  // Canonical invariant reference:
  // templates/coordination/orchestrator/planner_invariants.md
  const semantics = loadPlannerDependencyConfig().semantics;
  const byLeafId = new Map<string, PlannerLeafUnit>();
  for (const leaf of partition.leaf_units) {
    if (byLeafId.has(leaf.leaf_id)) {
      throw new PlannerContractError({
        code: "DUPLICATE_LEAF_ID",
        field: "refinement_partition.leaf_units.leaf_id",
        leaf_id: leaf.leaf_id,
      });
    }
    byLeafId.set(leaf.leaf_id, leaf);
  }
  for (const leaf of partition.leaf_units) {
    const dependencyLeafs = leaf.depends_on_leaf_ids.map((dependencyId) => {
      const dependency = byLeafId.get(dependencyId);
      if (!dependency) {
        throw new PlannerContractError({
          code: "MISSING_DEPENDENCY_LEAF",
          field: "refinement_partition.leaf_units.depends_on_leaf_ids",
          leaf_id: leaf.leaf_id,
          dependency_leaf_id: dependencyId,
        });
      }
      if (dependency.leaf_id === leaf.leaf_id) {
        throw new PlannerContractError({
          code: "SELF_DEPENDENCY",
          field: "refinement_partition.leaf_units.depends_on_leaf_ids",
          leaf_id: leaf.leaf_id,
        });
      }
      if (dependency.sequence >= leaf.sequence) {
        throw new PlannerContractError({
          code: "FUTURE_DEPENDENCY",
          field: "refinement_partition.leaf_units.depends_on_leaf_ids",
          leaf_id: leaf.leaf_id,
          dependency_leaf_id: dependency.leaf_id,
        });
      }
      return dependency;
    });

    if (leaf.depends_on_component_candidates.length > 0) {
      const upstream = partition.leaf_units.filter((candidate) => candidate.sequence < leaf.sequence);
      for (const dependencyComponent of leaf.depends_on_component_candidates) {
        if (!upstream.some((candidate) => candidate.component_candidate === dependencyComponent)) {
          throw new PlannerContractError({
            code: "COMPONENT_DEPENDENCY_MISMATCH",
            field: "refinement_partition.leaf_units.depends_on_component_candidates",
            leaf_id: leaf.leaf_id,
            detail: `no upstream leaf for component ${dependencyComponent}`,
          });
        }
        if (
          !dependencyLeafs.some(
            (dependencyLeaf) => dependencyLeaf.component_candidate === dependencyComponent,
          )
        ) {
          throw new PlannerContractError({
            code: "COMPONENT_DEPENDENCY_MISMATCH",
            field: "refinement_partition.leaf_units.depends_on_component_candidates",
            leaf_id: leaf.leaf_id,
            detail: `leaf dependency mismatch for component ${dependencyComponent}`,
          });
        }
      }
    }

    if (dependencyLeafs.length > 0) {
      for (const dependencyLeaf of dependencyLeafs) {
        if (!leaf.depends_on_component_candidates.includes(dependencyLeaf.component_candidate)) {
          throw new PlannerContractError({
            code: "COMPONENT_DEPENDENCY_MISMATCH",
            field: "refinement_partition.leaf_units.depends_on_component_candidates",
            leaf_id: leaf.leaf_id,
            dependency_leaf_id: dependencyLeaf.leaf_id,
            detail: "dependency component missing from component dependency list",
          });
        }
      }
    }
    const semanticDependency = semantics.component_dependency_map[leaf.component_candidate];
    if (semanticDependency) {
      if (!leaf.depends_on_component_candidates.includes(semanticDependency)) {
        throw new PlannerContractError({
          code: "COMPONENT_DEPENDENCY_MISMATCH",
          field: "refinement_partition.leaf_units.depends_on_component_candidates",
          leaf_id: leaf.leaf_id,
          detail: `semantic dependency ${semanticDependency} is required`,
        });
      }
    }
  }
}

export function validateDependencySummaryConsistency(
  partition: PlannerRefinementPartition,
  dependencyConfig: PlannerDependencyConfig,
): void {
  const semantics = dependencyConfig.semantics;
  const defaults = dependencyConfig.defaults;
  if (partition.dependency_summary.mode !== semantics.dependency_mode) {
    throw new PlannerContractError({
      code: "TYPE_MISMATCH",
      field: "refinement_partition.dependency_summary.mode",
      detail: `expected mode ${semantics.dependency_mode}`,
    });
  }
  if (partition.dependency_summary.note !== defaults.summary_note) {
    throw new PlannerContractError({
      code: "TYPE_MISMATCH",
      field: "refinement_partition.dependency_summary.note",
      detail: `expected note ${defaults.summary_note}`,
    });
  }
  const computedSummary = computeDependencySummary(partition.leaf_units);
  if (
    partition.dependency_summary.roots !== computedSummary.roots ||
    partition.dependency_summary.blocked !== computedSummary.blocked ||
    partition.dependency_summary.links !== computedSummary.links ||
    partition.dependency_summary.cross_module_links !== computedSummary.cross_module_links
  ) {
    throw new PlannerContractError({
      code: "TYPE_MISMATCH",
      field: "refinement_partition.dependency_summary",
      detail: "dependency summary does not match leaf dependency graph",
    });
  }
}
