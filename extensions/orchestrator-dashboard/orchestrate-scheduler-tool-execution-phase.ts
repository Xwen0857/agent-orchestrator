import type {
  SchedulerConfigV1,
  SchedulerExecutionMode,
  SchedulerFaultHandlingAction,
  SchedulerFlowPlan,
} from "./orchestrate-scheduler-contract.js";
import type { SchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import {
  applyDegradeTool,
  applyRecoveryTool,
  applyWorkerFaultHandlingTool,
  dispatchAssignedTool,
  emitEscalationTool,
  scheduleRetryTool,
} from "./orchestrate-scheduler-main-tools.js";
import { buildExecutionEventDetail, emitSchedulerEvent } from "./orchestrate-scheduler-repository.js";
import type { SchedulerAgentPolicyContext, TaskMeta } from "./orchestrate-scheduler-task-model.js";

type SchedulerExecutionRuntime = {
  repoRoot: string;
  mode: SchedulerExecutionMode;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "transition_task_state"
      | "append_task_event"
      | "agent_dispatch"
      | "kb_submit_candidate";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function runSchedulerToolExecutionPhase(input: {
  runtime: SchedulerExecutionRuntime;
  tasksRoot: string;
  metas: TaskMeta[];
  decision: {
    selected: Array<{
      task_id: string;
      action: "recover" | "retry" | "dispatch" | "skip";
      lane: string;
      reason: string;
    }>;
    skipped: Array<{
      task_id: string;
      lane: string;
      reason: string;
    }>;
  };
  flowPlan: SchedulerFlowPlan;
  selectionPolicies: Map<string, SchedulerAgentPolicyContext>;
  schedulerConfig: SchedulerConfigV1;
  adapter: SchedulerDispatchAdapter;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  throttled: boolean;
}): Promise<{
  advanced: number;
  failed: number;
  retryScheduled: number;
  recoverSuccesses: number;
  degradeApplied: number;
  executionAttemptedCount: number;
  dispatchAttempts: number;
  dispatchSuccesses: number;
  lastFaultActionApplied: SchedulerFaultHandlingAction | "none";
  faultActionBlockedByPolicy: boolean;
  workerFaultClass: string;
  failures: string[];
  observerBridge: {
    requests: number;
    packets: number;
    bridgedTaskIds: string[];
    bridgedTaskRefs: Array<{
      task_id: string;
      request_id: string;
      fingerprint: string;
      trigger: string;
      request_path: string;
      packet_path: string;
      requested_at: string;
    }>;
    lastRequestId: string;
    lastFingerprint: string;
    lastTrigger: string;
    lastRequestAt: string;
    packetPath: string;
  };
}> {
  let advanced = 0;
  let failed = 0;
  let retryScheduled = 0;
  let recoverSuccesses = 0;
  let degradeApplied = 0;
  let executionAttemptedCount = 0;
  let dispatchAttempts = 0;
  let dispatchSuccesses = 0;
  let lastFaultActionApplied: SchedulerFaultHandlingAction | "none" = "none";
  let faultActionBlockedByPolicy = false;
  let workerFaultClass = "";
  const failures: string[] = [];
  const hasGovernanceOverrideBlock = input.flowPlan.blocked_by.some((entry) =>
    entry.startsWith("governance_locked_tool_arg_override:"),
  );

  if (input.flowPlan.selected_flow === "degrade_flow" && !hasGovernanceOverrideBlock && input.runtimeConsistency !== "mismatch") {
    degradeApplied = await applyDegradeTool({
      schedulerConfig: input.schedulerConfig,
      metas: input.metas,
      selectedToolArgs: input.flowPlan.selected_tool_args,
    });
  } else if (hasGovernanceOverrideBlock) {
    await emitSchedulerEvent(input.runtime.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_override_reject_tools_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_OVERRIDE_REJECTED",
      detail: `phase=execution reason=${input.flowPlan.blocked_by.join(",")}`,
    });
  }

  for (const skipped of input.decision.skipped) {
    const policy = input.selectionPolicies.get(skipped.task_id);
    await emitSchedulerEvent(input.runtime.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_skip_${skipped.task_id}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_DISPATCH_SKIPPED",
      task_id: skipped.task_id,
      detail: buildExecutionEventDetail({
        compatibilityMode: policy?.compatibility_mode ?? "missing",
        lane: skipped.lane,
        reason: skipped.reason,
      }),
    });
    if (skipped.lane === "paused_by_replan" || skipped.lane === "awaiting_revalidation") {
      await emitSchedulerEvent(input.runtime.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_override_reject_${skipped.task_id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_OVERRIDE_REJECTED",
        task_id: skipped.task_id,
        detail: buildExecutionEventDetail({
          compatibilityMode: policy?.compatibility_mode ?? "missing",
          lane: skipped.lane,
          reason: "planner_gate_no_execution_side_override",
        }),
      });
    }
  }

  for (const task of input.decision.selected) {
    const selectedMeta = input.metas.find((candidate) => candidate.taskId === task.task_id) ?? null;
    const selectedPolicy = input.selectionPolicies.get(task.task_id);
    const compatibilityMode = selectedPolicy?.compatibility_mode ?? "missing";
    if (hasGovernanceOverrideBlock) {
      await emitSchedulerEvent(input.runtime.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_override_reject_${task.task_id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_OVERRIDE_REJECTED",
        task_id: task.task_id,
        detail: buildExecutionEventDetail({
          compatibilityMode,
          lane: task.lane,
          reason: input.flowPlan.blocked_by.join(","),
        }),
      });
      continue;
    }
    if (input.runtimeConsistency === "mismatch") {
      await emitSchedulerEvent(input.runtime.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_override_reject_${task.task_id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_OVERRIDE_REJECTED",
        task_id: task.task_id,
        detail: buildExecutionEventDetail({
          compatibilityMode,
          lane: task.lane,
          reason: "runtime_guard_mismatch_blocks_side_effects",
        }),
      });
      continue;
    }

    try {
      if (task.action === "retry" && selectedMeta) {
        const faultDecision = await applyWorkerFaultHandlingTool({
          runtime: input.runtime,
          schedulerConfig: input.schedulerConfig,
          task: selectedMeta,
          tasksRoot: input.tasksRoot,
        });
        lastFaultActionApplied = faultDecision.lastFaultActionApplied;
        faultActionBlockedByPolicy = faultDecision.faultActionBlockedByPolicy;
        workerFaultClass = faultDecision.workerFaultClass;
        if (faultDecision.skipTask) {
          await emitSchedulerEvent(input.runtime.emitEvent, {
            schema_version: "scheduler-dispatch-event-v1",
            event_id: `evt_scheduler_skip_pre_exec_${task.task_id}_${Date.now()}`,
            timestamp: new Date().toISOString(),
            action: "SCHEDULER_DISPATCH_SKIPPED",
            task_id: task.task_id,
            detail: buildExecutionEventDetail({
              compatibilityMode,
              lane: task.lane,
              reason: `pre_execution_fault_action_${faultDecision.lastFaultActionApplied}`,
            }),
          });
          continue;
        }
      }

      if (task.action === "recover" && selectedMeta) {
        const result = await applyRecoveryTool({
          runtime: input.runtime,
          adapter: input.adapter,
          selectedMeta,
          tasksRoot: input.tasksRoot,
          schedulerConfig: input.schedulerConfig,
          mode: input.runtime.mode,
          taskId: task.task_id,
          compatibilityMode,
          lane: task.lane,
          selectedToolArgs: input.flowPlan.selected_tool_args,
        });
        recoverSuccesses += 1;
        if (result.attemptedDispatch) {
          executionAttemptedCount += 1;
          dispatchAttempts += 1;
          if (result.ok) {
            advanced += 1;
            dispatchSuccesses += 1;
          } else {
            failed += 1;
            failures.push(`${task.task_id}: recovery dispatch failed`);
          }
        } else {
          advanced += 1;
        }
        continue;
      }

      if (task.action === "retry") {
        const result = await scheduleRetryTool({
          runtime: input.runtime,
          adapter: input.adapter,
          tasksRoot: input.tasksRoot,
          taskId: task.task_id,
          schedulerConfig: input.schedulerConfig,
          mode: input.runtime.mode,
          compatibilityMode,
          lane: task.lane,
          selectedToolArgs: input.flowPlan.selected_tool_args,
        });
        retryScheduled += 1;
        executionAttemptedCount += 1;
        dispatchAttempts += 1;
        if (result.ok) {
          advanced += 1;
          dispatchSuccesses += 1;
        } else {
          failed += 1;
          failures.push(`${task.task_id}: retry dispatch failed`);
        }
        continue;
      }

      if (task.action === "dispatch") {
        const result = await dispatchAssignedTool({
          runtime: input.runtime,
          adapter: input.adapter,
          tasksRoot: input.tasksRoot,
          taskId: task.task_id,
          mode: input.runtime.mode,
          throttled: input.throttled,
          compatibilityMode,
          lane: task.lane,
        });
        executionAttemptedCount += 1;
        dispatchAttempts += 1;
        if (result.ok) {
          advanced += 1;
          dispatchSuccesses += 1;
        } else {
          failed += 1;
          failures.push(`${task.task_id}: dispatch failed`);
        }
      }
    } catch (error) {
      failed += 1;
      failures.push(`${task.task_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const observerBridge = await emitEscalationTool({
    metas: input.metas,
    schedulerConfig: input.schedulerConfig,
  });

  return {
    advanced,
    failed,
    retryScheduled,
    recoverSuccesses,
    degradeApplied,
    executionAttemptedCount,
    dispatchAttempts,
    dispatchSuccesses,
    lastFaultActionApplied,
    faultActionBlockedByPolicy,
    workerFaultClass,
    failures,
    observerBridge,
  };
}
