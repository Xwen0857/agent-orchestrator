import fs from "node:fs/promises";
import path from "node:path";

import type { SchedulerArtifactLifecycleAction, SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import {
  buildMaintenanceEventDetail,
  emitSchedulerEvent,
  readJson,
  writeJsonAtomic,
} from "./orchestrate-scheduler-repository.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";
import { patchWorkerFaultControlSummary } from "./orchestrate-scheduler-tool-meta-patch.js";
import type { SchedulerToolRuntime } from "./orchestrate-scheduler-tool-transition.js";

async function archiveTaskDeliveryArtifacts(taskDir: string): Promise<void> {
  const exportRecordPath = path.join(taskDir, "delivery.export-records.json");
  const records = await readJson<Array<Record<string, unknown>>>(exportRecordPath, []);
  if (records.length === 0) {
    return;
  }
  const archiveRoot = path.join(taskDir, "delivery.archive");
  await fs.mkdir(archiveRoot, { recursive: true });
  for (const record of records) {
    const artifactPath = String(record.path ?? "").trim();
    if (!artifactPath) {
      continue;
    }
    const sourcePath = path.join(taskDir, artifactPath);
    try {
      await fs.access(sourcePath);
    } catch {
      continue;
    }
    const archivePath = path.join(archiveRoot, artifactPath.replace(/^delivery\//, ""));
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.copyFile(sourcePath, archivePath);
  }
  await writeJsonAtomic(path.join(archiveRoot, "archive-manifest.json"), {
    schema_version: "worker-stage-archive-manifest-v1",
    generated_at: new Date().toISOString(),
    task_id: path.basename(taskDir),
    artifacts: records,
  });
  const now = new Date().toISOString();
  const nextRecords = records.map((record) => ({
    ...record,
    archive_status: "archived",
    archived_at: now,
    archive_manifest_path: "delivery.archive/archive-manifest.json",
    last_lifecycle_action: "scheduler_archived",
  }));
  await fs.writeFile(exportRecordPath, `${JSON.stringify(nextRecords, null, 2)}\n`, "utf8");
}

async function purgeTaskDeliveryArtifacts(taskDir: string): Promise<void> {
  const exportRecordPath = path.join(taskDir, "delivery.export-records.json");
  const records = await readJson<Array<Record<string, unknown>>>(exportRecordPath, []);
  if (records.length === 0) {
    return;
  }
  for (const record of records) {
    const artifactPath = String(record.path ?? "").trim();
    if (!artifactPath) {
      continue;
    }
    await fs.rm(path.join(taskDir, artifactPath), { force: true });
  }
  const now = new Date().toISOString();
  const nextRecords = records.map((record) => ({
    ...record,
    retention_status: String(record.archive_status ?? "").trim() === "archived" ? "archived_only" : "purged",
    purged_at: now,
    last_lifecycle_action: "scheduler_purged",
  }));
  await fs.writeFile(exportRecordPath, `${JSON.stringify(nextRecords, null, 2)}\n`, "utf8");
}

async function reclaimTaskWorkerStages(taskDir: string): Promise<void> {
  await fs.rm(path.join(taskDir, "worker_stages"), { recursive: true, force: true });
}

export async function applyLifecycleTool(input: {
  runtime: SchedulerToolRuntime;
  schedulerConfig: SchedulerConfigV1;
  task: TaskMeta;
  tasksRoot: string;
}): Promise<{ action: SchedulerArtifactLifecycleAction | "none" }> {
  // Lifecycle remains a rigid control tool in v1: flow selection may choose it,
  // but actuation stays driven by runtime control summaries and lifecycle policy.
  const runtimeControl = input.task.runtimeWorkerControl;
  const action: SchedulerArtifactLifecycleAction | "none" = runtimeControl.archiveReady
    ? "archive"
    : runtimeControl.purgeReady
      ? "purge"
      : runtimeControl.reclaimReady
        ? "reclaim"
        : "none";
  if (action === "none") {
    return { action };
  }
  const mode = input.schedulerConfig.artifact_lifecycle_policy.actuation_mode;
  const allowed =
    (action === "archive" && input.schedulerConfig.artifact_lifecycle_policy.allow_archive) ||
    (action === "purge" && input.schedulerConfig.artifact_lifecycle_policy.allow_purge) ||
    (action === "reclaim" && input.schedulerConfig.artifact_lifecycle_policy.allow_reclaim);
  const metaPath = path.join(input.tasksRoot, input.task.taskId, "meta.json");
  const eventBase = {
    schema_version: "scheduler-dispatch-event-v1" as const,
    event_id: `evt_scheduler_artifact_${input.task.taskId}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    task_id: input.task.taskId,
    detail: buildMaintenanceEventDetail({
      action,
      reason: runtimeControl.retentionDecision || "none",
    }),
  };
  if (mode === "disabled") {
    return { action };
  }
  if (!allowed) {
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_ARTIFACT_LIFECYCLE_BLOCKED" });
    return { action };
  }
  if (mode === "summary_only") {
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_ARTIFACT_LIFECYCLE_DEFERRED" });
    return { action };
  }
  if (runtimeControl.archiveReady) {
    await archiveTaskDeliveryArtifacts(input.task.taskDir);
  }
  if (runtimeControl.purgeReady) {
    await purgeTaskDeliveryArtifacts(input.task.taskDir);
  }
  if (runtimeControl.reclaimReady) {
    await reclaimTaskWorkerStages(input.task.taskDir);
  }
  await patchWorkerFaultControlSummary(metaPath, {
    archive_ready: runtimeControl.archiveReady ? false : runtimeControl.archiveReady,
    purge_ready: runtimeControl.purgeReady ? false : runtimeControl.purgeReady,
    reclaim_ready: runtimeControl.reclaimReady ? false : runtimeControl.reclaimReady,
    retention_decision: runtimeControl.retentionDecision,
  });
  await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_ARTIFACT_LIFECYCLE_APPLIED" });
  return { action };
}
