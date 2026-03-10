import { loadPlannerDependencyConfig } from "./orchestrate-planner-dependency-semantics.js";
import type {
  PlannerDependencySummary,
  PlannerLeafUnit,
  SplitPlan,
} from "./orchestrate-planner-contract.js";

export function computeDependencySummary(leafUnits: PlannerLeafUnit[]): PlannerDependencySummary {
  const dependencyConfig = loadPlannerDependencyConfig();
  const semantics = dependencyConfig.semantics;
  const defaults = dependencyConfig.defaults;
  const roots = leafUnits.filter((leaf) => leaf.depends_on_leaf_ids.length === 0).length;
  const blocked = leafUnits.filter((leaf) => leaf.depends_on_leaf_ids.length > 0).length;
  const links = leafUnits.reduce((sum, leaf) => sum + leaf.depends_on_leaf_ids.length, 0);
  const byLeafId = new Map(leafUnits.map((leaf) => [leaf.leaf_id, leaf] as const));
  const crossModuleLinks = leafUnits.reduce((sum, leaf) => {
    return (
      sum +
      leaf.depends_on_leaf_ids.reduce((inner, dependencyId) => {
        const upstream = byLeafId.get(dependencyId);
        if (!upstream) {
          return inner;
        }
        return upstream.module_id !== leaf.module_id ? inner + 1 : inner;
      }, 0)
    );
  }, 0);
  return {
    mode: semantics.dependency_mode,
    roots,
    blocked,
    links,
    cross_module_links: crossModuleLinks,
    note: defaults.summary_note,
  };
}

export function buildFallbackSplitPlan(): SplitPlan {
  const dependencyConfig = loadPlannerDependencyConfig();
  return {
    schema_version: "planner-split-plan-v1",
    task_id: "",
    planner_phase: "",
    decomposition_strategy: "",
    release_policy: "",
    initial_partition: {
      strategy: "meta_single_unit",
      modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
    },
    refinement_partition: {
      strategy: "linear_split_units_placeholder",
      input_scope: "single_meta_input",
      granularity: "temporary_refinement_granularity",
      component_candidates: [],
      leaf_units: [],
      dependency_summary: {
        mode: dependencyConfig.semantics.dependency_mode,
        roots: dependencyConfig.defaults.fallback_dependency_summary.roots,
        blocked: dependencyConfig.defaults.fallback_dependency_summary.blocked,
        links: dependencyConfig.defaults.fallback_dependency_summary.links,
        cross_module_links: dependencyConfig.defaults.fallback_dependency_summary.cross_module_links,
        note: dependencyConfig.defaults.summary_note,
      },
      backlog: [],
    },
    decision_context: {},
  };
}
