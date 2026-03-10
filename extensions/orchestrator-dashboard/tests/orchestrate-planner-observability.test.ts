import { afterEach, describe, expect, it } from "vitest";
import { extractSplitPlan } from "../orchestrate-planner-contract.js";
import {
  setSplitPlanExtractDiagnosticsSink,
  type SplitPlanExtractDiagnostic,
} from "../orchestrate-planner-split-plan-contract.js";

describe("orchestrate planner split-plan observability", () => {
  afterEach(() => {
    setSplitPlanExtractDiagnosticsSink(undefined);
  });

  it("records extract success counters and duration when sink is injected", () => {
    const diagnostics: SplitPlanExtractDiagnostic[] = [];
    setSplitPlanExtractDiagnosticsSink((event) => diagnostics.push(event));

    extractSplitPlan({
      task_id: "task_observe_ok",
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
        backlog: [],
      },
      decision_context: {},
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        split_plan_extract_ok_count: expect.any(Number),
        split_plan_extract_fail_count: expect.any(Number),
        split_plan_extract_duration_ms: expect.any(Number),
      }),
    );
    expect(diagnostics[0]!.split_plan_extract_ok_count).toBeGreaterThanOrEqual(1);
  });

  it("records extract failure counters with typed error context", () => {
    const diagnostics: SplitPlanExtractDiagnostic[] = [];
    setSplitPlanExtractDiagnosticsSink((event) => diagnostics.push(event));

    expect(() => {
      extractSplitPlan({
        task_id: "task_observe_fail",
        planner_phase: "initial_plan",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [],
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
    }).toThrowError();

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    const failureEvent = diagnostics[diagnostics.length - 1]!;
    expect(failureEvent).toEqual(
      expect.objectContaining({
        split_plan_extract_ok_count: expect.any(Number),
        split_plan_extract_fail_count: expect.any(Number),
        split_plan_extract_duration_ms: expect.any(Number),
        error_code: "MISSING_FIELD",
      }),
    );
    expect(failureEvent.split_plan_extract_fail_count).toBeGreaterThanOrEqual(1);
  });
});
