import { describe, expect, it } from "vitest";

import { extractSchedulerConfig } from "../orchestrate-scheduler-contract.js";
import { resolveSchedulerExecutionFlowPlan } from "../orchestrate-scheduler-agent-controls.js";
import {
  buildSchedulerBaselineDecision,
  resolveSchedulerWorkflowBaseline,
} from "../orchestrate-scheduler-workflow-baseline.js";

describe("orchestrate-scheduler-workflow-baseline", () => {
  it("builds a workflow baseline from the selected flow plan", () => {
    const cfg = extractSchedulerConfig({});
    const flowPlan = resolveSchedulerExecutionFlowPlan({
      selected: [
        {
          task_id: "task_dispatch",
          from_state: "ASSIGNED",
          action: "dispatch",
          reason: "assigned_ready",
          lane: "assigned_ready",
        },
      ],
      schedulerConfig: cfg,
      maxTasks: 2,
      parallelLimit: 2,
      effectiveWorkerThreads: 4,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 0,
    });

    const baseline = resolveSchedulerWorkflowBaseline(flowPlan);
    const decision = buildSchedulerBaselineDecision({
      baselineFlowPlan: flowPlan,
      selectedFlowPlan: flowPlan,
    });

    expect(baseline).toMatchObject({
      flow_id: "selection_flow",
      default_skill: "selection-skill",
      default_main_tool: "run_selection_tool",
    });
    expect(decision).toEqual({
      baseline_flow: "selection_flow",
      baseline_skill: "selection-skill",
      baseline_main_tool: "run_selection_tool",
      baseline_args: flowPlan.selected_tool_args,
      decision_mode: "baseline_followed",
      deviation_reason: "",
    });
  });

  it("marks blocked baseline decisions when no permitted flow is selected", () => {
    const decision = buildSchedulerBaselineDecision({
      baselineFlowPlan: {
        selected: [],
        deferred: [],
        selected_flow: "",
        selected_skill: "",
        selected_main_tool: "",
        selected_tool_args: {},
        tool_parameter_ranges: {},
        reasoning_summary: {
          baseline_status: "blocked",
          rationale: "hard_blocked",
          signals_used: [],
          parameter_adjustments: [],
        },
        flow_combination_bans: [],
        why_this_skill: "hard_gate_blocks_skill_selection",
        blocked_by: ["runtime_guard_mismatch"],
      },
      selectedFlowPlan: {
      selected: [],
      deferred: [],
      selected_flow: "",
      selected_skill: "",
      selected_main_tool: "",
      selected_tool_args: {},
      tool_parameter_ranges: {},
        reasoning_summary: {
          baseline_status: "blocked",
          rationale: "hard_blocked",
          signals_used: [],
          parameter_adjustments: [],
        },
        flow_combination_bans: [],
        why_this_skill: "hard_gate_blocks_skill_selection",
        blocked_by: ["runtime_guard_mismatch"],
      },
    });

    expect(decision).toEqual({
      baseline_flow: "",
      baseline_skill: "",
      baseline_main_tool: "",
      baseline_args: {},
      decision_mode: "blocked",
      deviation_reason: "runtime_guard_mismatch",
    });
  });

  it("marks baseline bypass when the selected flow diverges from the recommendation", () => {
    const cfg = extractSchedulerConfig({});
    const baselineFlowPlan = resolveSchedulerExecutionFlowPlan({
      selected: [
        {
          task_id: "task_dispatch",
          from_state: "ASSIGNED",
          action: "dispatch",
          reason: "assigned_ready",
          lane: "assigned_ready",
        },
      ],
      schedulerConfig: cfg,
      maxTasks: 2,
      parallelLimit: 2,
      effectiveWorkerThreads: 4,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 1,
      observerEscalationRequests: 0,
    });
    const selectedFlowPlan = resolveSchedulerExecutionFlowPlan({
      selected: [
        {
          task_id: "task_dispatch",
          from_state: "ASSIGNED",
          action: "dispatch",
          reason: "assigned_ready",
          lane: "assigned_ready",
        },
      ],
      schedulerConfig: cfg,
      maxTasks: 2,
      parallelLimit: 2,
      effectiveWorkerThreads: 4,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 1,
      observerEscalationRequests: 0,
      agentSelectedFlow: "degrade_flow",
      agentSelectedSkill: "degrade-skill",
      agentSelectedMainTool: "apply_degrade_tool",
      reasoningSummary: {
        baseline_status: "bypassed",
        rationale: "agent_bypassed_dispatch_baseline_due_to_degrade_signal",
        signals_used: ["degrade_applied"],
        parameter_adjustments: [],
      },
      whyThisSkill: "agent_selected_degrade_due_to_active_runtime_stall_signal",
    });

    expect(
      buildSchedulerBaselineDecision({
        baselineFlowPlan,
        selectedFlowPlan,
      }),
    ).toEqual({
      baseline_flow: "selection_flow",
      baseline_skill: "selection-skill",
      baseline_main_tool: "run_selection_tool",
      baseline_args: baselineFlowPlan.selected_tool_args,
      decision_mode: "baseline_bypassed",
      deviation_reason: "agent_selected_degrade_flow_over_selection_flow",
    });
  });
});
