import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import { runSchedulerObserverBridgePhase } from "./orchestrate-scheduler-observer-bridge-phase.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";

export async function emitEscalationTool(input: {
  metas: TaskMeta[];
  schedulerConfig: SchedulerConfigV1;
}): Promise<{
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
}> {
  // Escalation remains a rigid bridge lane in v1: scheduler-agent may classify the
  // tick under escalation_flow, but request/packet emission still follows
  // scheduler-configured recovery/lifecycle boundaries plus observer bridge
  // compaction rules.
  return runSchedulerObserverBridgePhase(input);
}
