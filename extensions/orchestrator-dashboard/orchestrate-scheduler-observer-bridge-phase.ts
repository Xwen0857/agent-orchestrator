import path from "node:path";

import {
  buildEscalationBridgeArtifacts,
  detectSatisfiedSchedulerEscalationCondition,
} from "./orchestrate-observer-escalation-adapter.js";
import { assembleObserverArtifactsForTask } from "./orchestrate-observer-runtime-assembler.js";
import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import {
  patchObserverBridgeSummary,
  patchSchedulerEscalationBridgeState,
  readJson,
  writeJsonAtomic,
} from "./orchestrate-scheduler-repository.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";

export async function runSchedulerObserverBridgePhase(input: {
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
  let requests = 0;
  let packets = 0;
  const bridgedTaskIds: string[] = [];
  const bridgedTaskRefs: Array<{
    task_id: string;
    request_id: string;
    fingerprint: string;
    trigger: string;
    request_path: string;
    packet_path: string;
    requested_at: string;
  }> = [];
  let lastRequestId = "";
  let lastFingerprint = "";
  let lastTrigger = "";
  let lastRequestAt = "";
  let packetPath = "";
  for (const task of input.metas) {
    const raw = await readJson<Record<string, unknown>>(task.metaPath, {});
    const observerArtifacts = await assembleObserverArtifactsForTask({
      taskDir: task.taskDir,
      metaPath: task.metaPath,
      observerPath: task.observerPath,
      terminalDigestPath: task.terminalDigestPath,
      rawLogIndexPath: task.rawLogIndexPath,
      rawTaskMeta: raw,
    });
    const detection = await detectSatisfiedSchedulerEscalationCondition({
      task,
      taskMeta: observerArtifacts.taskMeta,
      observerView: observerArtifacts.observerView,
      schedulerConfig: input.schedulerConfig,
    });
    if (!detection.trigger || !detection.context) {
      await patchSchedulerEscalationBridgeState(task.metaPath, detection.nextBridgeState);
      continue;
    }
    const requestPath = path.join(task.taskDir, "scheduler_escalation_request.json");
    const packetOutputPath = path.join(task.taskDir, "observer_refinement_packet.json");
    const artifacts = await buildEscalationBridgeArtifacts({
      task,
      taskMeta: observerArtifacts.taskMeta,
      observerView: observerArtifacts.observerView,
      nextBridgeState: detection.nextBridgeState,
      trigger: detection.trigger,
      context: detection.context,
    });
    await patchSchedulerEscalationBridgeState(task.metaPath, artifacts.bridgeStatePatch);
    await writeJsonAtomic(requestPath, artifacts.request);
    await writeJsonAtomic(packetOutputPath, artifacts.packet);
    await patchObserverBridgeSummary(task.metaPath, {
      bridge_packet_path: "observer_refinement_packet.json",
      bridge_last_observed_at: artifacts.packet.observed_at,
      bridge_last_fingerprint: artifacts.packet.bridge_fingerprint,
      bridge_last_request_id: artifacts.packet.request_id,
    });
    requests += 1;
    packets += 1;
    bridgedTaskIds.push(task.taskId);
    bridgedTaskRefs.push({
      task_id: task.taskId,
      request_id: artifacts.packet.request_id,
      fingerprint: artifacts.packet.bridge_fingerprint,
      trigger: detection.trigger,
      request_path: "scheduler_escalation_request.json",
      packet_path: "observer_refinement_packet.json",
      requested_at: artifacts.request.requested_at,
    });
    lastRequestId = artifacts.packet.request_id;
    lastFingerprint = artifacts.packet.bridge_fingerprint;
    lastTrigger = detection.trigger;
    lastRequestAt = artifacts.request.requested_at;
    packetPath = "observer_refinement_packet.json";
  }
  return {
    requests,
    packets,
    bridgedTaskIds,
    bridgedTaskRefs,
    lastRequestId,
    lastFingerprint,
    lastTrigger,
    lastRequestAt,
    packetPath,
  };
}
