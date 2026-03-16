import type {
  SchedulerBaselineDecision,
  SchedulerFlowPlan,
  SchedulerWorkflowBaseline,
  SchedulerWorkflowTemplate,
} from "./orchestrate-scheduler-contract.js";

const SCHEDULER_WORKFLOW_TEMPLATES: Record<string, SchedulerWorkflowTemplate> = {
  selection_flow: {
    flow_id: "selection_flow",
    default_skill: "selection-skill",
    default_main_tool: "run_selection_tool",
    fixed_steps: ["policy_precheck", "candidate_selection", "runtime_assembly", "dispatch", "result_record"],
  },
  retry_flow: {
    flow_id: "retry_flow",
    default_skill: "retry-skill",
    default_main_tool: "schedule_retry_tool",
    fixed_steps: ["retry_precheck", "retry_state_patch", "runtime_assembly", "dispatch", "result_record"],
  },
  recovery_flow: {
    flow_id: "recovery_flow",
    default_skill: "recovery-skill",
    default_main_tool: "apply_recovery_tool",
    fixed_steps: ["recovery_precheck", "recovery_state_patch", "runtime_assembly", "dispatch_or_transition", "result_record"],
  },
  degrade_flow: {
    flow_id: "degrade_flow",
    default_skill: "degrade-skill",
    default_main_tool: "apply_degrade_tool",
    fixed_steps: ["stall_signal_scan", "degrade_budget_patch", "result_record"],
  },
  lifecycle_flow: {
    flow_id: "lifecycle_flow",
    default_skill: "lifecycle-skill",
    default_main_tool: "apply_lifecycle_tool",
    fixed_steps: ["retention_precheck", "retention_actuation", "result_record"],
  },
  escalation_flow: {
    flow_id: "escalation_flow",
    default_skill: "escalation-skill",
    default_main_tool: "emit_escalation_tool",
    fixed_steps: ["observer_bridge_precheck", "request_emit", "packet_emit", "result_record"],
  },
};

export function resolveSchedulerWorkflowBaseline(flowPlan: SchedulerFlowPlan): SchedulerWorkflowBaseline | null {
  if (!flowPlan.selected_flow) {
    return null;
  }
  const template = SCHEDULER_WORKFLOW_TEMPLATES[flowPlan.selected_flow];
  if (!template) {
    return null;
  }
  return {
    ...template,
    default_args: flowPlan.selected_tool_args,
    tool_parameter_ranges: flowPlan.tool_parameter_ranges,
  };
}

export function buildSchedulerBaselineDecision(input: {
  baselineFlowPlan: SchedulerFlowPlan;
  selectedFlowPlan?: SchedulerFlowPlan;
}): SchedulerBaselineDecision {
  const baseline = resolveSchedulerWorkflowBaseline(input.baselineFlowPlan);
  const selectedFlowPlan = input.selectedFlowPlan ?? input.baselineFlowPlan;
  const selectedBlocked = selectedFlowPlan.blocked_by.length > 0;
  if (!baseline) {
    return {
      baseline_flow: "",
      baseline_skill: "",
      baseline_main_tool: "",
      baseline_args: {},
      decision_mode: selectedBlocked ? "blocked" : "baseline_bypassed",
      deviation_reason: selectedBlocked ? selectedFlowPlan.blocked_by.join(",") : "baseline_unavailable",
    };
  }
  if (selectedBlocked) {
    return {
      baseline_flow: baseline.flow_id,
      baseline_skill: baseline.default_skill,
      baseline_main_tool: baseline.default_main_tool,
      baseline_args: baseline.default_args,
      decision_mode: "blocked",
      deviation_reason: selectedFlowPlan.blocked_by.join(","),
    };
  }
  const bypassed =
    selectedFlowPlan.selected_flow !== baseline.flow_id ||
    selectedFlowPlan.selected_skill !== baseline.default_skill ||
    selectedFlowPlan.selected_main_tool !== baseline.default_main_tool;
  return {
    baseline_flow: baseline.flow_id,
    baseline_skill: baseline.default_skill,
    baseline_main_tool: baseline.default_main_tool,
    baseline_args: baseline.default_args,
    decision_mode: bypassed ? "baseline_bypassed" : "baseline_followed",
    deviation_reason: bypassed
      ? `agent_selected_${selectedFlowPlan.selected_flow || "none"}_over_${baseline.flow_id}`
      : "",
  };
}
