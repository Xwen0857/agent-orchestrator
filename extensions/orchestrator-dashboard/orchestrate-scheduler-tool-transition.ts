export type SchedulerToolRuntime = {
  repoRoot: string;
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

export function buildOperationId(taskId: string, action: "recover" | "retry" | "dispatch"): string {
  return `op_scheduler_${action}_${taskId}_${Date.now()}`;
}

export async function runTransition(input: {
  runtime: SchedulerToolRuntime;
  taskDir: string;
  actor: "scheduler-ops" | "agent-orchestrator";
  fromState: string;
  toState: string;
  operationId: string;
  reason: string;
}): Promise<void> {
  await input.runtime.runWhitelistedScript({
    repoRoot: input.runtime.repoRoot,
    scriptName: "transition_task_state",
    args: [
      input.taskDir,
      input.actor,
      input.operationId,
      input.fromState,
      input.toState,
      input.reason.replace(/\s+/g, "_"),
    ],
  });
}
