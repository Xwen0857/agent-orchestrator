import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import { buildSchedulerAgentPolicyContext } from "./orchestrate-scheduler-agent-policy-context.js";
import { selectDispatchBatch } from "./orchestrate-scheduler-selection-engine.js";
import type { SchedulerAgentPolicyContext, TaskMeta } from "./orchestrate-scheduler-task-model.js";

export async function runSchedulerSelectionPhase(input: {
  metas: TaskMeta[];
  maxTasks: number;
  schedulerConfig: SchedulerConfigV1;
  retryPolicyOverride?: Partial<SchedulerConfigV1["retry"]>;
  recoveryPolicyOverride?: Partial<SchedulerConfigV1["recovery"]>;
}): Promise<{
  policies: Map<string, SchedulerAgentPolicyContext>;
  decision: ReturnType<typeof selectDispatchBatch>;
}> {
  const policies = new Map<string, SchedulerAgentPolicyContext>();
  for (const task of input.metas) {
    policies.set(
      task.taskId,
      buildSchedulerAgentPolicyContext(task, input.schedulerConfig.agent_profiles),
    );
  }
  for (const task of input.metas) {
    if (!policies.has(task.taskId)) {
      throw new Error(`scheduler_selection_invariant_failed: missing policy for ${task.taskId}`);
    }
  }
  return {
    policies,
    decision: selectDispatchBatch({
      metas: input.metas,
      policies,
      maxTasks: input.maxTasks,
      retryPolicy: {
        ...input.schedulerConfig.retry,
        ...input.retryPolicyOverride,
      },
      recoveryPolicy: {
        ...input.schedulerConfig.recovery,
        ...input.recoveryPolicyOverride,
      },
      laneQuota: input.schedulerConfig.lane_quota,
      aging: input.schedulerConfig.aging,
    }),
  };
}
