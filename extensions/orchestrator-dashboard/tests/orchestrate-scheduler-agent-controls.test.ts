import { describe, expect, it } from "vitest";

import {
  buildSchedulerAgentHeartbeat,
  resolveSchedulerExecutionFlowPlan,
} from "../orchestrate-scheduler-agent-controls.js";
import {
  SCHEDULER_PARAMETERIZED_MAIN_TOOLS,
  SCHEDULER_RIGID_MAIN_TOOLS,
  extractSchedulerConfig,
} from "../orchestrate-scheduler-contract.js";

describe("orchestrate-scheduler-agent-controls", () => {
  it("defers lower-priority execution flows when multiple execution actions are selected", () => {
    const cfg = extractSchedulerConfig({});
    const plan = resolveSchedulerExecutionFlowPlan({
      selected: [
        {
          task_id: "task_recover",
          from_state: "BLOCKED_SYSTEM_ERROR",
          action: "recover",
          reason: "recovery_lane",
          lane: "recovery",
        },
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

    expect(plan.selected_flow).toBe("recovery_flow");
    expect(plan.selected_skill).toBe("recovery-skill");
    expect(plan.selected_main_tool).toBe("apply_recovery_tool");
    expect(plan.selected.map((entry) => entry.task_id)).toEqual(["task_recover"]);
    expect(plan.deferred).toContainEqual(
      expect.objectContaining({
        task_id: "task_dispatch",
        action: "skip",
        reason: "execution_flow_deferred_by_selected_flow:recovery_flow",
      }),
    );
    expect(plan.flow_combination_bans).toContain("mixed_execution_flows_banned:recovery_flow");
  });

  it("builds a machine-readable heartbeat envelope with bounded parameter ranges", () => {
    const cfg = extractSchedulerConfig({});
    const plan = resolveSchedulerExecutionFlowPlan({
      selected: [
        {
          task_id: "task_retry",
          from_state: "REJECTED",
          action: "retry",
          reason: "retry_lane",
          lane: "retry",
        },
      ],
      schedulerConfig: cfg,
      maxTasks: 3,
      parallelLimit: 2,
      effectiveWorkerThreads: 6,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 0,
    });

    const heartbeat = buildSchedulerAgentHeartbeat({
      requestId: "scheduler_req_test",
      candidateCount: 5,
      throttled: false,
      runtimeConsistency: "ok",
      plannerGateActive: false,
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 0,
      observerBridge: {
        active: false,
        request_count: 0,
        packet_count: 0,
        bridged_task_ids: [],
        bridged_task_refs: [],
        last_request_id: "",
        last_fingerprint: "",
        last_trigger: "",
        last_request_at: "",
        packet_path: "",
      },
      guardSkipCount: 0,
      flowPlan: plan,
      advanced: 1,
      failed: 0,
    });

    expect(heartbeat).toMatchObject({
      schema_version: "scheduler-agent-heartbeat-v1",
      selected_flow: "retry_flow",
      selected_skill: "retry-skill",
      selected_main_tool: "schedule_retry_tool",
      baseline_reference: {
        flow: "retry_flow",
        skill: "retry-skill",
        main_tool: "schedule_retry_tool",
        args: plan.selected_tool_args,
      },
      baseline_flow: "retry_flow",
      baseline_skill: "retry-skill",
      baseline_main_tool: "schedule_retry_tool",
      baseline_bypassed: false,
      decision_mode: "baseline_followed",
      deviation_reason: "",
      reasoning_summary: {
        baseline_status: "followed",
        rationale: "agent_followed_recommended_workflow_template",
        signals_used: [],
        parameter_adjustments: [],
      },
      execution_log_ref: "orchestrate.scheduler.kernel_tick:scheduler_req_test",
      reasoning_record_ref: "",
      observer_bridge: {
        active: false,
        request_count: 0,
        packet_count: 0,
        bridged_task_ids: [],
        bridged_task_refs: [],
        last_request_id: "",
        last_fingerprint: "",
        last_trigger: "",
        last_request_at: "",
        packet_path: "",
      },
      execution_result: "completed",
    });
    expect(heartbeat.baseline_args).toEqual(heartbeat.selected_tool_args);
    expect(heartbeat.matched_constraints.tool_parameter_ranges.retry_max_attempts).toEqual({
      min: 1,
      max: cfg.retry.max_attempts,
      default: cfg.retry.max_attempts,
      agent_tunable: true,
      governance_locked: false,
    });
  });

  it("allows autonomous flow bypass within the workflow whitelist", () => {
    const cfg = extractSchedulerConfig({});
    const plan = resolveSchedulerExecutionFlowPlan({
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

    expect(plan.selected_flow).toBe("degrade_flow");
    expect(plan.selected).toEqual([]);
    expect(plan.deferred).toContainEqual(
      expect.objectContaining({
        task_id: "task_dispatch",
        reason: "execution_flow_deferred_by_agent_selected_flow:degrade_flow",
      }),
    );
  });

  it("permits escalation_flow from explicit observer bridge identity, not only aggregate counts", () => {
    const cfg = extractSchedulerConfig({});
    const plan = resolveSchedulerExecutionFlowPlan({
      selected: [],
      schedulerConfig: cfg,
      maxTasks: 1,
      parallelLimit: 1,
      effectiveWorkerThreads: 1,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 0,
      observerBridge: {
        active: true,
        last_request_id: "req_bridge_001",
        last_fingerprint: "fp_bridge_001",
        last_trigger: "recovery_exhausted",
      },
    });

    expect(plan.selected_flow).toBe("escalation_flow");
    expect(plan.selected_main_tool).toBe("emit_escalation_tool");
  });

  it("clamps tunable args and blocks governance-locked overrides", () => {
    const cfg = extractSchedulerConfig({});
    const plan = resolveSchedulerExecutionFlowPlan({
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
      maxTasks: 3,
      parallelLimit: 2,
      effectiveWorkerThreads: 6,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 0,
      agentSelectedToolArgs: {
        max_tasks: 99,
        parallel_limit: 5,
      },
    });

    expect(plan.selected_tool_args.max_tasks).toBe(3);
    expect(plan.selected_tool_args.parallel_limit).toBe(2);
    expect(plan.blocked_by).toContain("governance_locked_tool_arg_override:parallel_limit");
    expect(plan.reasoning_summary.parameter_adjustments).toContain("max_tasks=3(requested=99)");
  });

  it("keeps lifecycle and escalation flows outside the tunable execution surface", () => {
    const cfg = extractSchedulerConfig({});
    const lifecyclePlan = resolveSchedulerExecutionFlowPlan({
      selected: [],
      schedulerConfig: cfg,
      maxTasks: 2,
      parallelLimit: 2,
      effectiveWorkerThreads: 4,
      runtimeConsistency: "ok",
      lifecycleActionCount: 2,
      degradeApplied: 0,
      observerEscalationRequests: 0,
    });
    const escalationPlan = resolveSchedulerExecutionFlowPlan({
      selected: [],
      schedulerConfig: cfg,
      maxTasks: 2,
      parallelLimit: 2,
      effectiveWorkerThreads: 4,
      runtimeConsistency: "ok",
      lifecycleActionCount: 0,
      degradeApplied: 0,
      observerEscalationRequests: 1,
      observerBridge: {
        active: true,
        last_request_id: "req_bridge_lifecycle_test",
        last_fingerprint: "fp_bridge_lifecycle_test",
        last_trigger: "recovery_exhausted",
      },
    });

    expect(lifecyclePlan.selected_main_tool).toBe("apply_lifecycle_tool");
    expect(lifecyclePlan.tool_parameter_ranges).toEqual({});
    expect(lifecyclePlan.selected_tool_args).toEqual({});
    expect(escalationPlan.selected_main_tool).toBe("emit_escalation_tool");
    expect(escalationPlan.tool_parameter_ranges).toEqual({});
    expect(escalationPlan.selected_tool_args).toEqual({});
  });

  it("exports a stable split between parameterized and rigid main tools", () => {
    expect(SCHEDULER_PARAMETERIZED_MAIN_TOOLS).toEqual([
      "run_selection_tool",
      "schedule_retry_tool",
      "apply_recovery_tool",
      "apply_degrade_tool",
    ]);
    expect(SCHEDULER_RIGID_MAIN_TOOLS).toEqual([
      "emit_escalation_tool",
      "apply_lifecycle_tool",
    ]);
  });
});
