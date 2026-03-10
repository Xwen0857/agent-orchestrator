import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSplitPlan } from "../orchestrate-planner-contract.js";
import { buildFallbackDependencyHints } from "../orchestrate-planner-hints-contract.js";
import { loadPlannerDependencyConfig } from "../orchestrate-planner-dependency-semantics.js";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", relativePath), "utf8");
}

describe("planner dependency config boundary", () => {
  it("keeps dependency defaults and semantics loading aligned in TS", () => {
    const config = loadPlannerDependencyConfig();
    expect(config.defaults.dependency_mode).toBe(config.semantics.dependency_mode);
    const splitPlan = extractSplitPlan({
      schema_version: "planner-split-plan-v1",
      task_id: "task_demo",
      planner_phase: "initial_plan",
      decomposition_strategy: "single_path",
      release_policy: "immediate_first_wave",
      initial_partition: {
        strategy: "meta_single_unit",
        modules: [{ module_id: "meta_unit_001", module_title: "root", child_tasks: [] }],
      },
      refinement_partition: {
        strategy: "linear_split_units_placeholder",
        input_scope: "single_meta_input",
        granularity: "temporary_refinement_granularity",
        component_candidates: ["implementation_unit"],
        leaf_units: [],
        backlog: [],
      },
      decision_context: {},
    });

    expect(splitPlan.refinement_partition.dependency_summary.mode).toBe(config.semantics.dependency_mode);
    expect(splitPlan.refinement_partition.dependency_summary.note).toBe(config.defaults.summary_note);
    expect(splitPlan.refinement_partition.dependency_summary).toEqual(
      expect.objectContaining({
        roots: config.defaults.fallback_dependency_summary.roots,
        blocked: config.defaults.fallback_dependency_summary.blocked,
        links: config.defaults.fallback_dependency_summary.links,
        cross_module_links: config.defaults.fallback_dependency_summary.cross_module_links,
      }),
    );

    expect(buildFallbackDependencyHints(splitPlan)).toEqual({
      mode: config.semantics.dependency_mode,
      roots: config.defaults.fallback_dependency_summary.roots,
      blocked: config.defaults.fallback_dependency_summary.blocked,
      links: config.defaults.fallback_dependency_summary.links,
      cross_module_links: config.defaults.fallback_dependency_summary.cross_module_links,
      note: config.defaults.summary_note,
    });
  });

  it("keeps planner scripts wired to semantics + defaults configs", () => {
    const workers = readRepoFile("agent-orchestrator/scripts/planner_prepare_workers.sh");
    const single = readRepoFile("agent-orchestrator/scripts/planner_prepare_single_worker.sh");

    for (const content of [workers, single]) {
      expect(content).toContain("DEPENDENCY_SEMANTICS_PATH=");
      expect(content).toContain("DEPENDENCY_DEFAULTS_PATH=");
      expect(content).toContain("invalid planner dependency semantics:");
      expect(content).toContain("invalid planner dependency defaults:");
      expect(content).toContain("--argjson dependency_semantics");
      expect(content).toContain("--argjson dependency_defaults");
      expect(content).not.toContain('else ""');
      expect(content).not.toContain("planning_hint_not_scheduler_dag");
      expect(content).not.toContain("component_semantic_linearized");
      expect(content).toContain("$dependency_defaults.summary_note");
      expect(content).toContain("$dependency_semantics.dependency_mode");
    }
  });
});
