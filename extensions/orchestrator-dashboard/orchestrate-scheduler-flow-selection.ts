import type {
  SchedulerAgentFlowId,
  SchedulerAgentMainToolId,
  SchedulerObserverBridgeSummary,
  SchedulerAgentReasoningSummary,
  SchedulerAgentSkillId,
  SchedulerAgentToolArgValue,
  SchedulerConfigV1,
  SchedulerDecisionTask,
  SchedulerFlowPlan,
} from "./orchestrate-scheduler-contract.js";
import {
  buildDefaultSchedulerToolArgs,
  buildSchedulerToolParameterRanges,
  normalizeSchedulerToolArgs,
} from "./orchestrate-scheduler-tool-parameter-policy.js";

const EXECUTION_FLOW_PRIORITY: Array<{
  action: "recover" | "retry" | "dispatch";
  flow: SchedulerAgentFlowId;
  skill: SchedulerAgentSkillId;
  tool: SchedulerAgentMainToolId;
}> = [
  { action: "recover", flow: "recovery_flow", skill: "recovery-skill", tool: "apply_recovery_tool" },
  { action: "retry", flow: "retry_flow", skill: "retry-skill", tool: "schedule_retry_tool" },
  { action: "dispatch", flow: "selection_flow", skill: "selection-skill", tool: "run_selection_tool" },
];

const FLOW_TO_ACTION: Partial<Record<SchedulerAgentFlowId, "recover" | "retry" | "dispatch">> = {
  recovery_flow: "recover",
  retry_flow: "retry",
  selection_flow: "dispatch",
};

function buildDefaultReasoningSummary(): SchedulerAgentReasoningSummary {
  return {
    baseline_status: "followed",
    rationale: "agent_followed_recommended_workflow_template",
    signals_used: [],
    parameter_adjustments: [],
  };
}

function mergeParameterAdjustments(input: {
  reasoningSummary: SchedulerAgentReasoningSummary;
  defaultArgs: Record<string, SchedulerAgentToolArgValue>;
  selectedArgs: Record<string, SchedulerAgentToolArgValue>;
  clampedArgs: string[];
}): SchedulerAgentReasoningSummary {
  const parameterAdjustments = [...input.reasoningSummary.parameter_adjustments];
  for (const [key, value] of Object.entries(input.selectedArgs)) {
    const defaultValue = input.defaultArgs[key];
    if (defaultValue === value) {
      continue;
    }
    const summary = `${key}=${String(value)}(default=${String(defaultValue)})`;
    if (!parameterAdjustments.includes(summary)) {
      parameterAdjustments.push(summary);
    }
  }
  for (const clamped of input.clampedArgs) {
    if (!parameterAdjustments.includes(clamped)) {
      parameterAdjustments.push(clamped);
    }
  }
  return {
    ...input.reasoningSummary,
    parameter_adjustments: parameterAdjustments,
  };
}

function resolveDefaultExecutionFlow(selectedActionKinds: Set<"recover" | "retry" | "dispatch">): {
  selectedFlow: SchedulerAgentFlowId | "";
  selectedSkill: SchedulerAgentSkillId | "";
  selectedMainTool: SchedulerAgentMainToolId | "";
} {
  for (const descriptor of EXECUTION_FLOW_PRIORITY) {
    if (selectedActionKinds.has(descriptor.action)) {
      return {
        selectedFlow: descriptor.flow,
        selectedSkill: descriptor.skill,
        selectedMainTool: descriptor.tool,
      };
    }
  }
  return { selectedFlow: "", selectedSkill: "", selectedMainTool: "" };
}

function isFlowPermittedForSignals(input: {
  flow: SchedulerAgentFlowId | "";
  selectedActionKinds: Set<"recover" | "retry" | "dispatch">;
  lifecycleActionCount: number;
  degradeApplied: number;
  observerBridge: Pick<SchedulerObserverBridgeSummary, "active" | "last_request_id" | "last_fingerprint" | "last_trigger">;
}): boolean {
  switch (input.flow) {
    case "":
      return true;
    case "selection_flow":
    case "retry_flow":
    case "recovery_flow":
      return input.selectedActionKinds.has(FLOW_TO_ACTION[input.flow] ?? "dispatch");
    case "lifecycle_flow":
      return input.lifecycleActionCount > 0;
    case "degrade_flow":
      return input.degradeApplied > 0;
    case "escalation_flow":
      return (
        input.observerBridge.active &&
        Boolean(
          input.observerBridge.last_request_id ||
            input.observerBridge.last_fingerprint ||
            input.observerBridge.last_trigger,
        )
      );
    default:
      return false;
  }
}

export function resolveSchedulerExecutionFlowPlan(input: {
  selected: SchedulerDecisionTask[];
  schedulerConfig: SchedulerConfigV1;
  maxTasks: number;
  parallelLimit: number;
  effectiveWorkerThreads: number;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  lifecycleActionCount: number;
  degradeApplied: number;
  observerEscalationRequests: number;
  observerBridge?: Pick<
    SchedulerObserverBridgeSummary,
    "active" | "last_request_id" | "last_fingerprint" | "last_trigger"
  >;
  agentSelectedFlow?: SchedulerAgentFlowId | "";
  agentSelectedSkill?: SchedulerAgentSkillId | "";
  agentSelectedMainTool?: SchedulerAgentMainToolId | "";
  agentSelectedToolArgs?: Record<string, SchedulerAgentToolArgValue>;
  reasoningSummary?: SchedulerAgentReasoningSummary;
  whyThisSkill?: string;
}): SchedulerFlowPlan {
  const blockedBy: string[] = [];
  const bans: string[] = [];
  const selectedActionKinds = new Set(
    input.selected
      .map((entry) => entry.action)
      .filter((entry): entry is "recover" | "retry" | "dispatch" => entry !== "skip"),
  );

  const baselineExecutionFlow = resolveDefaultExecutionFlow(selectedActionKinds);
  const observerBridge = input.observerBridge ?? {
    active: input.observerEscalationRequests > 0,
    last_request_id: "",
    last_fingerprint: "",
    last_trigger: "",
  };
  let selectedFlow: SchedulerAgentFlowId | "" = baselineExecutionFlow.selectedFlow;
  let selectedSkill: SchedulerAgentSkillId | "" = baselineExecutionFlow.selectedSkill;
  let selectedMainTool: SchedulerAgentMainToolId | "" = baselineExecutionFlow.selectedMainTool;
  let selected = [...input.selected];
  const deferred: SchedulerDecisionTask[] = [];

  if (input.runtimeConsistency === "mismatch") {
    blockedBy.push("runtime_guard_mismatch");
  }

  if (!selectedFlow) {
    if (isFlowPermittedForSignals({ flow: "escalation_flow", selectedActionKinds, lifecycleActionCount: input.lifecycleActionCount, degradeApplied: input.degradeApplied, observerBridge })) {
      selectedFlow = "escalation_flow";
      selectedSkill = "escalation-skill";
      selectedMainTool = "emit_escalation_tool";
    } else if (input.lifecycleActionCount > 0) {
      selectedFlow = "lifecycle_flow";
      selectedSkill = "lifecycle-skill";
      selectedMainTool = "apply_lifecycle_tool";
    } else if (input.degradeApplied > 0) {
      selectedFlow = "degrade_flow";
      selectedSkill = "degrade-skill";
      selectedMainTool = "apply_degrade_tool";
    }
  }

  if (
    input.agentSelectedFlow &&
    isFlowPermittedForSignals({
      flow: input.agentSelectedFlow,
      selectedActionKinds,
      lifecycleActionCount: input.lifecycleActionCount,
      degradeApplied: input.degradeApplied,
      observerBridge,
    })
  ) {
    selectedFlow = input.agentSelectedFlow;
    selectedSkill = input.agentSelectedSkill ?? selectedSkill;
    selectedMainTool = input.agentSelectedMainTool ?? selectedMainTool;
  }

  const selectedExecutionAction = selectedFlow ? FLOW_TO_ACTION[selectedFlow] : undefined;
  if (selectedActionKinds.size > 1 && selectedExecutionAction) {
    bans.push(`mixed_execution_flows_banned:${selectedFlow}`);
  }

  if (selectedExecutionAction) {
    const nextSelected: SchedulerDecisionTask[] = [];
    for (const task of selected) {
      if (task.action === selectedExecutionAction || task.action === "skip") {
        nextSelected.push(task);
        continue;
      }
      deferred.push({
        ...task,
        action: "skip",
        reason:
          input.agentSelectedFlow && input.agentSelectedFlow === selectedFlow
            ? `execution_flow_deferred_by_agent_selected_flow:${selectedFlow}`
            : `execution_flow_deferred_by_selected_flow:${selectedFlow}`,
      });
    }
    selected = nextSelected;
  } else if (selected.length > 0 && selectedFlow) {
    for (const task of selected) {
      deferred.push({
        ...task,
        action: "skip",
        reason: `execution_flow_deferred_by_agent_selected_flow:${selectedFlow}`,
      });
    }
    selected = [];
  }

  const ranges = buildSchedulerToolParameterRanges({
    flow: selectedFlow,
    schedulerConfig: input.schedulerConfig,
    maxTasks: input.maxTasks,
    parallelLimit: input.parallelLimit,
    effectiveWorkerThreads: input.effectiveWorkerThreads,
  });
  const defaultArgs = buildDefaultSchedulerToolArgs(selectedFlow, ranges);
  const normalizedToolArgs = normalizeSchedulerToolArgs(
    input.agentSelectedToolArgs ?? defaultArgs,
    ranges,
  );
  for (const key of normalizedToolArgs.governance_override_rejections) {
    blockedBy.push(`governance_locked_tool_arg_override:${key}`);
  }
  const reasoningSummary = mergeParameterAdjustments({
    reasoningSummary: input.reasoningSummary ?? buildDefaultReasoningSummary(),
    defaultArgs,
    selectedArgs: normalizedToolArgs.args,
    clampedArgs: normalizedToolArgs.clamped_args,
  });

  return {
    selected,
    deferred,
    selected_flow: selectedFlow,
    selected_skill: selectedSkill,
    selected_main_tool: selectedMainTool,
    selected_tool_args: normalizedToolArgs.args,
    tool_parameter_ranges: ranges,
    reasoning_summary: reasoningSummary,
    flow_combination_bans: bans,
    why_this_skill:
      input.whyThisSkill ??
      (selectedSkill
        ? `default_strategy_for_${selectedFlow}`
        : blockedBy.length > 0
          ? "hard_gate_blocks_skill_selection"
          : "no_flow_selected"),
    blocked_by: blockedBy,
  };
}
