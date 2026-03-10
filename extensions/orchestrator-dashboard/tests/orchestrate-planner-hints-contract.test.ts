import { describe, expect, it } from "vitest";
import { extractSplitPlan } from "../orchestrate-planner-contract.js";
import {
  buildDependencyHintsFromRefinementPartitionRaw,
  buildFallbackDependencyHints,
  buildPlannerDependencyHints,
} from "../orchestrate-planner-hints-contract.js";

describe("orchestrate planner hints contract", () => {
  it("builds a stable refinement hint envelope from split plan", () => {
    const splitPlan = extractSplitPlan({
      schema_version: "planner-split-plan-v1",
      task_id: "task_demo",
      planner_phase: "initial_plan",
      decomposition_strategy: "module_first",
      release_policy: "immediate_first_wave",
      initial_partition: {
        strategy: "meta_module_partition",
        modules: [
          { module_id: "module_001", module_title: "protocol_surface", child_tasks: [] },
          { module_id: "module_002", module_title: "core_logic", child_tasks: [] },
        ],
      },
      refinement_partition: {
        strategy: "linear_split_units_placeholder",
        input_scope: "multi_meta_input",
        granularity: "temporary_refinement_granularity",
        component_candidates: ["protocol_schema", "transport_adapter"],
        leaf_units: [
          {
            leaf_id: "leaf_1",
            module_id: "module_001",
            module_title: "protocol_surface",
            component_candidate: "protocol_schema",
            depends_on_component_candidates: [],
            depends_on_leaf_ids: [],
            stage_id: "stage_1",
            sequence: 1,
            total_units: 2,
            release_state: "immediate_first_wave",
            child_task_id: "task_demo_c001",
          },
          {
            leaf_id: "leaf_2",
            module_id: "module_002",
            module_title: "core_logic",
            component_candidate: "transport_adapter",
            depends_on_component_candidates: ["protocol_schema"],
            depends_on_leaf_ids: ["leaf_1"],
            stage_id: "stage_2",
            sequence: 2,
            total_units: 2,
            release_state: "immediate_first_wave",
            child_task_id: "task_demo_c002",
          },
        ],
        dependency_summary: {
          mode: "component_semantic_linearized",
          roots: 1,
          blocked: 1,
          links: 1,
          cross_module_links: 1,
          note: "planning_hint_not_scheduler_dag",
        },
        backlog: [],
      },
      decision_context: {},
    });

    const envelope = buildPlannerDependencyHints(splitPlan);

    expect(envelope.planner_hint_contract_version).toBe("planner-hints-v1");
    expect(envelope.dependency_hints).toEqual({
      mode: "component_semantic_linearized",
      roots: 1,
      blocked: 1,
      links: 1,
      cross_module_links: 1,
      note: "planning_hint_not_scheduler_dag",
    });
    expect(envelope.leaf_bindings).toHaveLength(2);
  });

  it("builds fallback hints from leaf units when needed", () => {
    const splitPlan = extractSplitPlan({
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
        leaf_units: [
          {
            leaf_id: "leaf_1",
            module_id: "meta_unit_001",
            module_title: "root",
            component_candidate: "implementation_unit",
            depends_on_component_candidates: [],
            depends_on_leaf_ids: [],
            stage_id: "stage_1",
            sequence: 1,
            total_units: 1,
            release_state: "immediate_first_wave",
            worker_task_id: "task_demo",
          },
        ],
        backlog: [],
      },
      decision_context: {},
    });

    expect(buildFallbackDependencyHints(splitPlan)).toEqual({
      mode: "component_semantic_linearized",
      roots: 1,
      blocked: 0,
      links: 0,
      cross_module_links: 0,
      note: "planning_hint_not_scheduler_dag",
    });
  });

  it("builds dependency hints from raw refinement partition with missing summary", () => {
    expect(
      buildDependencyHintsFromRefinementPartitionRaw({
        leaf_units: [
          {
            leaf_id: "leaf_1",
            module_id: "module_001",
            depends_on_leaf_ids: [],
          },
          {
            leaf_id: "leaf_2",
            module_id: "module_002",
            depends_on_leaf_ids: ["leaf_1"],
          },
        ],
      }),
    ).toEqual({
      mode: "component_semantic_linearized",
      roots: 1,
      blocked: 1,
      links: 1,
      cross_module_links: 1,
      note: "planning_hint_not_scheduler_dag",
    });
  });
});
