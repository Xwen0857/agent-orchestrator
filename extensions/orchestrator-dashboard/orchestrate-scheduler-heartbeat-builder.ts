import type {
  SchedulerAgentHeartbeatV1,
  SchedulerBaselineDecision,
  SchedulerFlowPlan,
} from "./orchestrate-scheduler-contract.js";
import { buildSchedulerBaselineDecision } from "./orchestrate-scheduler-workflow-baseline.js";

export function buildSchedulerAgentHeartbeat(input: {
  requestId: string;
  candidateCount: number;
  throttled: boolean;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  plannerGateActive: boolean;
  lifecycleActionCount: number;
  degradeApplied: number;
  observerEscalationRequests: number;
  observerBridge: SchedulerAgentHeartbeatV1["observer_bridge"];
  guardSkipCount: number;
  flowPlan: SchedulerFlowPlan;
  baselineDecision?: SchedulerBaselineDecision;
  advanced: number;
  failed: number;
}): SchedulerAgentHeartbeatV1 {
  const baseline =
    input.baselineDecision ??
    buildSchedulerBaselineDecision({
      baselineFlowPlan: input.flowPlan,
      selectedFlowPlan: input.flowPlan,
    });
  const executionResult: SchedulerAgentHeartbeatV1["execution_result"] =
    input.flowPlan.selected_flow === ""
      ? input.lifecycleActionCount > 0 || input.degradeApplied > 0
        ? "maintenance_only"
        : input.flowPlan.blocked_by.length > 0
          ? "blocked"
          : "idle"
      : input.failed > 0
        ? "partial"
        : input.advanced > 0
          ? "completed"
          : input.flowPlan.selected.length > 0
            ? "selected"
            : "blocked";

  return {
    schema_version: "scheduler-agent-heartbeat-v1",
    observed_signals: {
      candidate_count: input.candidateCount,
      throttled: input.throttled,
      runtime_consistency: input.runtimeConsistency,
      planner_gate_active: input.plannerGateActive,
      lifecycle_action_count: input.lifecycleActionCount,
      degrade_applied: input.degradeApplied,
      observer_escalation_requests: input.observerEscalationRequests,
      observer_bridge_active: input.observerBridge.active,
      guard_skip_count: input.guardSkipCount,
    },
    observer_bridge: input.observerBridge,
    matched_constraints: {
      hard_gates: input.flowPlan.blocked_by,
      flow_combination_bans: input.flowPlan.flow_combination_bans,
      tool_parameter_ranges: input.flowPlan.tool_parameter_ranges,
    },
    selected_flow: input.flowPlan.selected_flow,
    selected_skill: input.flowPlan.selected_skill,
    selected_main_tool: input.flowPlan.selected_main_tool,
    selected_tool_args: input.flowPlan.selected_tool_args,
    baseline_reference: {
      flow: baseline.baseline_flow,
      skill: baseline.baseline_skill,
      main_tool: baseline.baseline_main_tool,
      args: baseline.baseline_args,
    },
    baseline_flow: baseline.baseline_flow,
    baseline_skill: baseline.baseline_skill,
    baseline_main_tool: baseline.baseline_main_tool,
    baseline_args: baseline.baseline_args,
    baseline_bypassed: baseline.decision_mode === "baseline_bypassed",
    decision_mode: baseline.decision_mode,
    deviation_reason: baseline.deviation_reason,
    reasoning_summary: input.flowPlan.reasoning_summary,
    execution_log_ref: `orchestrate.scheduler.kernel_tick:${input.requestId}`,
    reasoning_record_ref: "",
    why_this_skill: input.flowPlan.why_this_skill,
    blocked_by: input.flowPlan.blocked_by,
    execution_result: executionResult,
    next_tick_hint:
      input.flowPlan.blocked_by.length > 0
        ? "wait_for_hard_gate_clear"
        : input.failed > 0
          ? "re-evaluate_after_partial_failure"
          : input.observerBridge.active
            ? "await_observer_bridge_consume"
            : "continue_scheduler_tick_loop",
  };
}
