import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import { runSchedulerSelectionPhase } from "./orchestrate-scheduler-selection-phase.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";

export function runSelectionTool(input: {
  metas: TaskMeta[];
  maxTasks: number;
  schedulerConfig: SchedulerConfigV1;
  retryPolicyOverride?: Partial<SchedulerConfigV1["retry"]>;
  recoveryPolicyOverride?: Partial<SchedulerConfigV1["recovery"]>;
}) {
  return runSchedulerSelectionPhase(input);
}
