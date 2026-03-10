import { describe, expect, it } from "vitest";
import { projectPlannerView } from "../orchestrate-planner-projection.js";

describe("orchestrate planner projection", () => {
  it("projects planner semantics from valid decision + split plan", () => {
    const projection = projectPlannerView({
      planningDecisionRaw: {
        decision_source: "planner_rules_fallback",
        decision_reason: "fallback",
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "high",
          decoupling_rationale: ["protocol boundary", "core boundary"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
          component_candidates: ["protocol_schema", "transport_adapter"],
          refinement_rationale: ["component sized split"],
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
          guardrail_triggered: true,
          guardrail_notes: ["trimmed"],
        },
      },
      splitPlanRaw: {
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
      },
    });

    expect(projection.initialPartition).toEqual({
      strategy: "meta_module_partition",
      modules: 2,
      expanded: true,
    });
    expect(projection.workerRefinement).toEqual(
      expect.objectContaining({
        scope: "multi_meta_input",
        principle: "engineering_decoupling",
      }),
    );
    expect(projection.decoupling).toEqual(
      expect.objectContaining({
        principle: "functional_decoupling",
        confidence: "high",
      }),
    );
    expect(projection.dependency.plannerHintContractVersion).toBe("planner-hints-v1");
    expect(projection.plannerContractError).toBeUndefined();
  });

  it("falls back split plan and emits structured planner contract error", () => {
    const projection = projectPlannerView({
      planningDecisionRaw: {
        decision_source: "manual_override",
        decision_reason: "manual",
        meta_decomposition: {
          decision_source: "manual_override",
          decomposition_strategy: "meta_single_unit",
          meta_unit_count: 1,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "low",
          decoupling_rationale: ["fallback"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "single_meta_input",
          primary_principle: "engineering_decoupling",
        },
      },
      splitPlanRaw: {
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
            },
          ],
          dependency_summary: {
            mode: "invalid_mode",
            roots: 1,
            blocked: 0,
            links: 0,
            cross_module_links: 0,
            note: "planning_hint_not_scheduler_dag",
          },
          backlog: [],
        },
        decision_context: {},
      },
    });

    expect(projection.splitPlan.schema_version).toBe("planner-split-plan-v1");
    expect(projection.splitPlan.refinement_partition.dependency_summary.mode).toBe(
      "component_semantic_linearized",
    );
    expect(projection.plannerContractError).toEqual(
      expect.objectContaining({
        code: "TYPE_MISMATCH",
        field: "refinement_partition.dependency_summary.mode",
      }),
    );
  });
});
