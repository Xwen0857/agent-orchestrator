import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import type { SchedulerAgentPolicyContext, TaskMeta } from "./orchestrate-scheduler-task-model.js";

function isSecondaryAgent(agentType: TaskMeta["scheduler"]["agent_type"]): boolean {
  return agentType === "tester-ephemeral" || agentType === "audit-guard";
}

function buildDispatchGate(task: TaskMeta): SchedulerAgentPolicyContext["dispatch_gate"] {
  const capability = task.agentDispatchCapability;
  const isUnknownAgent = task.scheduler.agent_type === "unknown";
  if (capability.projection_source === "missing") {
    return {
      allowed: false,
      reason: "gate_denied_by_missing_capability_summary",
      source: capability.projection_source,
    };
  }
  if (!capability.allowed_agent_types.includes(task.scheduler.agent_type)) {
    return {
      allowed: false,
      reason: `agent_type_not_allowed:${task.scheduler.agent_type}`,
      source: capability.projection_source,
    };
  }
  if (capability.custom_runtime_gate_status === "blocked") {
    return {
      allowed: false,
      reason: capability.custom_capability_gate_reason || "custom_runtime_gate_blocked",
      source: capability.projection_source,
    };
  }
  if (
    isSecondaryAgent(task.scheduler.agent_type) &&
    capability.default_target_role_types.length > 0 &&
    !capability.default_target_role_types.includes(task.scheduler.agent_type)
  ) {
    return {
      allowed: false,
      reason: `agent_type_not_in_default_target_role_types:${task.scheduler.agent_type}`,
      source: capability.projection_source,
    };
  }
  return {
    allowed: true,
    reason: "",
    source: capability.projection_source,
  };
}

function buildSkillCapabilityGate(task: TaskMeta): SchedulerAgentPolicyContext["skill_capability_gate"] {
  if (task.agentDispatchCapability.skill_gate_status === "blocked") {
    return {
      allowed: false,
      reason: task.agentDispatchCapability.skill_gate_reason || "skill_gate_blocked",
    };
  }
  return {
    allowed: true,
    reason: "",
  };
}

export function buildSchedulerAgentPolicyContext(
  task: TaskMeta,
  profiles: SchedulerConfigV1["agent_profiles"],
): SchedulerAgentPolicyContext {
  const dispatchGate = buildDispatchGate(task);
  const skillCapabilityGate = buildSkillCapabilityGate(task);
  const laneEligible = dispatchGate.allowed && skillCapabilityGate.allowed;
  const compatibilityMode = task.agentDispatchCapability.projection_source === "worker_runtime" ? "formal" : "missing";
  return {
    task_id: task.taskId,
    agent_type: task.scheduler.agent_type,
    agent_profile: profiles[task.scheduler.agent_type] ?? profiles.unknown,
    compatibility_mode: compatibilityMode,
    selected_template_id: task.agentDispatchCapability.selected_template_id,
    selected_template_origin: task.agentDispatchCapability.selected_template_origin,
    custom_runtime_gate_status: task.agentDispatchCapability.custom_runtime_gate_status,
    custom_capability_gate_reason: task.agentDispatchCapability.custom_capability_gate_reason,
    dispatch_gate: dispatchGate,
    skill_capability_gate: skillCapabilityGate,
    lane_eligibility: {
      // v1 keeps lane eligibility as a gate mirror; lane-specific agent policy is not implemented yet.
      recovery: laneEligible,
      retry: laneEligible,
      assigned_ready: laneEligible,
    },
    capability_summary: task.agentDispatchCapability,
  };
}
