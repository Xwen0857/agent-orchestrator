import fs from "node:fs/promises";
import path from "node:path";

import { assembleObserverArtifactsForTask } from "./orchestrate-observer-runtime-assembler.js";
import {
  computeAgeSeconds,
  normalizeAgentDispatchCapability,
  normalizeRuntimeReplan,
  normalizeRuntimeWorkerControl,
  normalizeScheduler,
  type TaskMeta,
} from "./orchestrate-scheduler-task-model.js";

async function readJson<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadEligibleTasks(tasksRoot: string): Promise<TaskMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(tasksRoot);
  } catch {
    return [];
  }

  const metas: TaskMeta[] = [];
  for (const entry of dirs) {
    if (!entry.startsWith("task_")) {
      continue;
    }
    const taskDir = path.join(tasksRoot, entry);
    const metaPath = path.join(taskDir, "meta.json");
    const observerPath = path.join(taskDir, "observer_view.json");
    const terminalDigestPath = path.join(taskDir, "worker_terminal_digest.json");
    const rawLogIndexPath = path.join(taskDir, "worker_raw_log_index.json");
    try {
      const raw = await readJson<Record<string, unknown>>(metaPath, {});
      const state = String(raw.state ?? "");
      if (
        state === "CLOSED" ||
        state === "BLOCKED_AWAITING_CLARIFICATION" ||
        state === "BLOCKED_PENDING_APPROVAL"
      ) {
        continue;
      }
      const observerArtifacts = await assembleObserverArtifactsForTask({
        taskDir,
        metaPath,
        observerPath,
        rawTaskMeta: raw,
        terminalDigestPath,
        rawLogIndexPath,
      });
      const effectiveMeta = observerArtifacts.taskMeta;
      const scheduler = normalizeScheduler(effectiveMeta.scheduler);
      const agentDispatchCapability = normalizeAgentDispatchCapability(
        effectiveMeta,
        scheduler.agent_type,
      );
      const updatedAt = String(effectiveMeta.updated_at ?? "");
      scheduler.wait_age_seconds = computeAgeSeconds(updatedAt);
      metas.push({
        taskId: String(effectiveMeta.id ?? entry),
        taskDir,
        metaPath,
        observerPath,
        terminalDigestPath,
        rawLogIndexPath,
        observerView: observerArtifacts.observerView,
        terminalDigest: observerArtifacts.terminalDigest,
        state,
        updatedAt,
        runtimeReplanConsumeStatus: normalizeRuntimeReplan(effectiveMeta).consume_status,
        agentDispatchCapability,
        runtimeWorkerControl: normalizeRuntimeWorkerControl(observerArtifacts.observerView),
        scheduler,
      });
    } catch {
      continue;
    }
  }
  return metas;
}
