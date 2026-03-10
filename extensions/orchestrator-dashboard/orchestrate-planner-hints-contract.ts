import type { PlannerLeafUnit, SplitPlan } from "./orchestrate-planner-contract.js";
import { loadPlannerDependencyConfig } from "./orchestrate-planner-dependency-semantics.js";

export type PlannerLeafBindingHint = {
  leaf_id: string;
  module_id: string;
  module_title: string;
  component_candidate: string;
  depends_on_leaf_ids: string[];
  depends_on_component_candidates: string[];
};

export type PlannerDependencyHints = {
  mode: string;
  roots: number;
  blocked: number;
  links: number;
  cross_module_links: number;
  note: string;
};

export type PlannerRefinementHintEnvelope = {
  planner_hint_contract_version: "planner-hints-v1";
  task_id: string;
  planner_phase: string;
  decomposition_strategy: string;
  dependency_hints: PlannerDependencyHints;
  leaf_bindings: PlannerLeafBindingHint[];
};

function computeLinks(leafs: PlannerLeafUnit[]): number {
  return leafs.reduce((sum, leaf) => sum + leaf.depends_on_leaf_ids.length, 0);
}

function computeCrossModuleLinks(leafs: PlannerLeafUnit[]): number {
  const byLeaf = new Map(leafs.map((leaf) => [leaf.leaf_id, leaf] as const));
  return leafs.reduce((sum, leaf) => {
    return (
      sum +
      leaf.depends_on_leaf_ids.reduce((inner, dependencyId) => {
        const upstream = byLeaf.get(dependencyId);
        if (!upstream) {
          return inner;
        }
        return upstream.module_id !== leaf.module_id ? inner + 1 : inner;
      }, 0)
    );
  }, 0);
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildHintsFromLooseLeafEntries(
  leafEntries: Array<Record<string, unknown>>,
): Pick<PlannerDependencyHints, "roots" | "blocked" | "links" | "cross_module_links"> {
  const links = leafEntries.reduce((sum, leaf) => {
    return sum + (Array.isArray(leaf.depends_on_leaf_ids) ? leaf.depends_on_leaf_ids.length : 0);
  }, 0);
  const roots = leafEntries.filter((leaf) => {
    return Array.isArray(leaf.depends_on_leaf_ids) && leaf.depends_on_leaf_ids.length === 0;
  }).length;
  const blocked = leafEntries.filter((leaf) => {
    return Array.isArray(leaf.depends_on_leaf_ids) && leaf.depends_on_leaf_ids.length > 0;
  }).length;
  const leafById = new Map<string, Record<string, unknown>>(
    leafEntries
      .filter((leaf) => typeof leaf.leaf_id === "string" && leaf.leaf_id.length > 0)
      .map((leaf) => [String(leaf.leaf_id), leaf] as const),
  );
  const crossModuleLinks = leafEntries.reduce((sum, leaf) => {
    const currentModule = String(leaf.module_id ?? "");
    if (!Array.isArray(leaf.depends_on_leaf_ids) || !currentModule) {
      return sum;
    }
    return (
      sum +
      leaf.depends_on_leaf_ids.reduce((inner, dependencyLeafId) => {
        const dependency = leafById.get(String(dependencyLeafId));
        if (!dependency) {
          return inner;
        }
        return String(dependency.module_id ?? "") !== currentModule ? inner + 1 : inner;
      }, 0)
    );
  }, 0);
  return {
    roots,
    blocked,
    links,
    cross_module_links: crossModuleLinks,
  };
}

export function buildPlannerDependencyHints(splitPlan: SplitPlan): PlannerRefinementHintEnvelope {
  const leafs = splitPlan.refinement_partition.leaf_units;
  const summary = splitPlan.refinement_partition.dependency_summary;
  return {
    planner_hint_contract_version: "planner-hints-v1",
    task_id: splitPlan.task_id,
    planner_phase: splitPlan.planner_phase,
    decomposition_strategy: splitPlan.decomposition_strategy,
    dependency_hints: {
      mode: summary.mode,
      roots: summary.roots,
      blocked: summary.blocked,
      links: summary.links,
      cross_module_links: summary.cross_module_links,
      note: summary.note,
    },
    leaf_bindings: leafs.map((leaf) => ({
      leaf_id: leaf.leaf_id,
      module_id: leaf.module_id,
      module_title: leaf.module_title,
      component_candidate: leaf.component_candidate,
      depends_on_leaf_ids: [...leaf.depends_on_leaf_ids],
      depends_on_component_candidates: [...leaf.depends_on_component_candidates],
    })),
  };
}

export function buildFallbackDependencyHints(splitPlan: SplitPlan): PlannerDependencyHints {
  const dependencyConfig = loadPlannerDependencyConfig();
  const leafs = splitPlan.refinement_partition.leaf_units;
  const roots =
    leafs.length > 0
      ? leafs.filter((leaf) => leaf.depends_on_leaf_ids.length === 0).length
      : dependencyConfig.defaults.fallback_dependency_summary.roots;
  const blocked =
    leafs.length > 0
      ? leafs.filter((leaf) => leaf.depends_on_leaf_ids.length > 0).length
      : dependencyConfig.defaults.fallback_dependency_summary.blocked;
  return {
    mode: dependencyConfig.semantics.dependency_mode,
    roots,
    blocked,
    links:
      leafs.length > 0
        ? computeLinks(leafs)
        : dependencyConfig.defaults.fallback_dependency_summary.links,
    cross_module_links:
      leafs.length > 0
        ? computeCrossModuleLinks(leafs)
        : dependencyConfig.defaults.fallback_dependency_summary.cross_module_links,
    note: dependencyConfig.defaults.summary_note,
  };
}

export function buildDependencyHintsFromRefinementPartitionRaw(
  refinementPartition: Record<string, unknown>,
): PlannerDependencyHints {
  const dependencyConfig = loadPlannerDependencyConfig();
  const dependencySummary =
    refinementPartition.dependency_summary &&
    typeof refinementPartition.dependency_summary === "object" &&
    !Array.isArray(refinementPartition.dependency_summary)
      ? (refinementPartition.dependency_summary as Record<string, unknown>)
      : {};
  const leafEntries = Array.isArray(refinementPartition.leaf_units)
    ? (refinementPartition.leaf_units as Array<Record<string, unknown>>)
    : [];
  const fallback = buildHintsFromLooseLeafEntries(leafEntries);
  return {
    mode: String(dependencySummary.mode ?? dependencyConfig.semantics.dependency_mode),
    roots: asFiniteNumber(dependencySummary.roots) ?? fallback.roots,
    blocked: asFiniteNumber(dependencySummary.blocked) ?? fallback.blocked,
    links: asFiniteNumber(dependencySummary.links) ?? fallback.links,
    cross_module_links:
      asFiniteNumber(dependencySummary.cross_module_links) ?? fallback.cross_module_links,
    note: String(dependencySummary.note ?? dependencyConfig.defaults.summary_note),
  };
}
