import type {
  SchedulerAgentFlowId,
  SchedulerAgentMainToolId,
  SchedulerAgentReasoningSummary,
  SchedulerAgentSkillId,
  SchedulerAgentToolArgValue,
  SchedulerBaselineDecision,
  SchedulerConfigV1,
  SchedulerObserverBridgeSummary,
} from "./orchestrate-scheduler-contract.js";
import { resolveSchedulerExecutionFlowPlan } from "./orchestrate-scheduler-agent-controls.js";
import { runSelectionTool } from "./orchestrate-scheduler-selection-tool.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";
import { buildSchedulerBaselineDecision } from "./orchestrate-scheduler-workflow-baseline.js";

function deriveObserverBridgeState(metas: TaskMeta[]): Pick<
  SchedulerObserverBridgeSummary,
  "active" | "last_request_id" | "last_fingerprint" | "last_trigger" | "last_request_at" | "packet_path"
> {
  let latest = {
    active: false,
    last_request_id: "",
    last_fingerprint: "",
    last_trigger: "",
    last_request_at: "",
    packet_path: "",
  };
  for (const task of metas) {
    const candidate = task.scheduler.escalation_bridge;
    if (!candidate.last_request_id && !candidate.last_bridge_fingerprint && !candidate.last_trigger) {
      continue;
    }
    if (!latest.last_request_at || candidate.last_request_at >= latest.last_request_at) {
      latest = {
        active: true,
        last_request_id: candidate.last_request_id,
        last_fingerprint: candidate.last_bridge_fingerprint,
        last_trigger: candidate.last_trigger,
        last_request_at: candidate.last_request_at,
        packet_path: "observer_refinement_packet.json",
      };
    }
  }
  return latest;
}

function buildAutonomousAgentDecision(input: {
  baselineFlowPlan: ReturnType<typeof resolveSchedulerExecutionFlowPlan>;
  candidateCount: number;
  maxTasks: number;
  parallelLimit: number;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  degradeApplied: number;
}): {
  selectedFlow?: SchedulerAgentFlowId;
  selectedSkill?: SchedulerAgentSkillId;
  selectedMainTool?: SchedulerAgentMainToolId;
  selectionMaxTasks: number;
  selectedToolArgs: Record<string, SchedulerAgentToolArgValue>;
  whyThisSkill: string;
  reasoningSummary: SchedulerAgentReasoningSummary;
} {
  const signalsUsed: string[] = [];
  const parameterAdjustments: string[] = [];
  let selectedFlow = input.baselineFlowPlan.selected_flow;
  let selectedSkill = input.baselineFlowPlan.selected_skill;
  let selectedMainTool = input.baselineFlowPlan.selected_main_tool;
  let whyThisSkill = "agent_followed_reference_workflow";
  let rationale = "agent_followed_recommended_workflow_template";
  let selectionMaxTasks = input.maxTasks;

  if (input.parallelLimit < input.maxTasks && input.candidateCount > input.parallelLimit) {
    selectionMaxTasks = input.parallelLimit;
    signalsUsed.push("candidate_pressure");
    parameterAdjustments.push(`max_tasks=${selectionMaxTasks}`);
    rationale = "agent_trimmed_selection_window_to_parallel_capacity";
  }

  if (
    input.runtimeConsistency !== "mismatch" &&
    input.degradeApplied > 0 &&
    input.baselineFlowPlan.selected_flow === "selection_flow"
  ) {
    selectedFlow = "degrade_flow";
    selectedSkill = "degrade-skill";
    selectedMainTool = "apply_degrade_tool";
    whyThisSkill = "agent_selected_degrade_due_to_active_runtime_stall_signal";
    rationale = "agent_bypassed_dispatch_baseline_due_to_degrade_signal";
    signalsUsed.push("degrade_applied");
  }

  const selectedToolArgs: Record<string, SchedulerAgentToolArgValue> = {
    ...input.baselineFlowPlan.selected_tool_args,
  };
  if (selectedFlow === "selection_flow" && selectionMaxTasks !== input.maxTasks) {
    selectedToolArgs.max_tasks = selectionMaxTasks;
  }

  const baselineStatus =
    input.runtimeConsistency === "mismatch"
      ? "blocked"
      : selectedFlow !== input.baselineFlowPlan.selected_flow ||
          selectedSkill !== input.baselineFlowPlan.selected_skill ||
          selectedMainTool !== input.baselineFlowPlan.selected_main_tool
        ? "bypassed"
        : "followed";

  return {
    selectedFlow: selectedFlow || undefined,
    selectedSkill: selectedSkill || undefined,
    selectedMainTool: selectedMainTool || undefined,
    selectionMaxTasks,
    selectedToolArgs,
    whyThisSkill,
    reasoningSummary: {
      baseline_status: baselineStatus,
      rationale,
      signals_used: signalsUsed,
      parameter_adjustments: parameterAdjustments,
    },
  };
}

function buildSelectionPolicyOverrides(input: {
  flow: SchedulerAgentFlowId | undefined;
  selectedToolArgs: Record<string, SchedulerAgentToolArgValue>;
}): {
  retryPolicyOverride?: Partial<SchedulerConfigV1["retry"]>;
  recoveryPolicyOverride?: Partial<SchedulerConfigV1["recovery"]>;
} {
  if (input.flow === "retry_flow") {
    return {
      retryPolicyOverride: {
        ...(typeof input.selectedToolArgs.retry_max_attempts === "number"
          ? { max_attempts: input.selectedToolArgs.retry_max_attempts }
          : {}),
      },
    };
  }
  if (input.flow === "recovery_flow") {
    return {
      recoveryPolicyOverride: {
        ...(typeof input.selectedToolArgs.recovery_max_attempts === "number"
          ? { max_attempts: input.selectedToolArgs.recovery_max_attempts }
          : {}),
      },
    };
  }
  return {};
}

export async function runSchedulerAgentDecisionPhase(input: {
  metas: TaskMeta[];
  maxTasks: number;
  schedulerConfig: SchedulerConfigV1;
  parallelLimit: number;
  effectiveWorkerThreads: number;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  lifecycleActionCount: number;
  degradeApplied: number;
  observerEscalationRequests: number;
}): Promise<{
  selection: Awaited<ReturnType<typeof runSelectionTool>>;
  decision: Awaited<ReturnType<typeof runSelectionTool>>["decision"];
  flowPlan: ReturnType<typeof resolveSchedulerExecutionFlowPlan>;
  baselineDecision: SchedulerBaselineDecision;
  selectedCount: number;
  guardSkipCount: number;
}> {
  const observerBridgeState = deriveObserverBridgeState(input.metas);
  const baselineSelection = await runSelectionTool({
    metas: input.metas,
    maxTasks: input.maxTasks,
    schedulerConfig: input.schedulerConfig,
  });
  const baselineFlowPlan = resolveSchedulerExecutionFlowPlan({
    selected: baselineSelection.decision.selected,
    schedulerConfig: input.schedulerConfig,
    maxTasks: input.maxTasks,
    parallelLimit: input.parallelLimit,
    effectiveWorkerThreads: input.effectiveWorkerThreads,
    runtimeConsistency: input.runtimeConsistency,
    lifecycleActionCount: input.lifecycleActionCount,
    degradeApplied: input.degradeApplied,
    observerEscalationRequests: input.observerEscalationRequests,
    observerBridge: observerBridgeState,
  });
  const autonomousDecision = buildAutonomousAgentDecision({
    baselineFlowPlan,
    candidateCount: input.metas.length,
    maxTasks: input.maxTasks,
    parallelLimit: input.parallelLimit,
    runtimeConsistency: input.runtimeConsistency,
    degradeApplied: input.degradeApplied,
  });
  const selectionPolicyOverrides = buildSelectionPolicyOverrides({
    flow: autonomousDecision.selectedFlow,
    selectedToolArgs: autonomousDecision.selectedToolArgs,
  });
  const selection =
    autonomousDecision.selectionMaxTasks === input.maxTasks
      && !selectionPolicyOverrides.retryPolicyOverride
      && !selectionPolicyOverrides.recoveryPolicyOverride
      ? baselineSelection
      : await runSelectionTool({
          metas: input.metas,
          maxTasks: autonomousDecision.selectionMaxTasks,
          schedulerConfig: input.schedulerConfig,
          ...selectionPolicyOverrides,
        });
  const flowPlan = resolveSchedulerExecutionFlowPlan({
    selected: selection.decision.selected,
    schedulerConfig: input.schedulerConfig,
    maxTasks: input.maxTasks,
    parallelLimit: input.parallelLimit,
    effectiveWorkerThreads: input.effectiveWorkerThreads,
    runtimeConsistency: input.runtimeConsistency,
    lifecycleActionCount: input.lifecycleActionCount,
    degradeApplied: input.degradeApplied,
    observerEscalationRequests: input.observerEscalationRequests,
    observerBridge: observerBridgeState,
    agentSelectedFlow: autonomousDecision.selectedFlow,
    agentSelectedSkill: autonomousDecision.selectedSkill,
    agentSelectedMainTool: autonomousDecision.selectedMainTool,
    agentSelectedToolArgs: autonomousDecision.selectedToolArgs,
    whyThisSkill: autonomousDecision.whyThisSkill,
    reasoningSummary: autonomousDecision.reasoningSummary,
  });
  const decision = {
    ...selection.decision,
    selected: flowPlan.selected,
    skipped: [...selection.decision.skipped, ...flowPlan.deferred],
  };
  const guardSkipReasons = new Set(["unsupported_state"]);
  return {
    selection,
    decision,
    flowPlan,
    baselineDecision: buildSchedulerBaselineDecision({
      baselineFlowPlan,
      selectedFlowPlan: flowPlan,
    }),
    selectedCount: decision.selected.length,
    guardSkipCount: decision.skipped.filter((entry) => guardSkipReasons.has(entry.reason)).length,
  };
}
