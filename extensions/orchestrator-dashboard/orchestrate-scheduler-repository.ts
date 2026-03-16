import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { SchedulerDispatchEventV1 } from "./orchestrate-scheduler-contract.js";
import { normalizeScheduler, type TaskMeta } from "./orchestrate-scheduler-task-model.js";

export function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readJson<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, targetPath);
}

export function stableJsonFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (entry as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return entry;
  });
  return createHash("sha1").update(serialized).digest("hex");
}

export async function emitSchedulerEvent(
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>,
  event: SchedulerDispatchEventV1,
): Promise<void> {
  await emitEvent("orchestrate.scheduler.dispatch_event", event as unknown as Record<string, unknown>);
}

export function buildExecutionEventDetail(input: {
  compatibilityMode: string;
  lane: string;
  reason: string;
}): string {
  return `phase=execution compat=${input.compatibilityMode} lane=${input.lane} reason=${input.reason}`;
}

export function buildMaintenanceEventDetail(input: { action: string; reason: string }): string {
  return `phase=maintenance action=${input.action} reason=${input.reason}`;
}

export async function updateSchedulerOwnedMeta(
  metaPath: string,
  mutate: (meta: Record<string, unknown>) => void,
): Promise<void> {
  const meta = await readJson<Record<string, unknown>>(metaPath, {});
  const plannerBefore = JSON.stringify(meta.planner_replan ?? null);
  const runtimeBefore = JSON.stringify(meta.runtime_replan ?? null);
  mutate(meta);
  if (JSON.stringify(meta.planner_replan ?? null) !== plannerBefore) {
    throw new Error("scheduler boundary violation: planner_replan is planner-owned");
  }
  if (JSON.stringify(meta.runtime_replan ?? null) !== runtimeBefore) {
    throw new Error("scheduler boundary violation: runtime_replan is not scheduler-owned in this path");
  }
  await writeJsonAtomic(metaPath, meta);
}

export async function updateTaskMeta(
  metaPath: string,
  mutate: (meta: Record<string, unknown>) => void,
): Promise<void> {
  const current = await readJson<Record<string, unknown>>(metaPath, {});
  mutate(current);
  current.updated_at = new Date().toISOString();
  await fs.writeFile(metaPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

export async function patchSchedulerEscalationBridgeState(
  metaPath: string,
  state: TaskMeta["scheduler"]["escalation_bridge"],
): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.escalation_bridge = state;
    meta.scheduler = scheduler;
  });
}

export async function patchObserverBridgeSummary(
  metaPath: string,
  patch: {
    bridge_packet_path?: string;
    bridge_last_observed_at?: string;
    bridge_last_fingerprint?: string;
    bridge_last_request_id?: string;
  },
): Promise<void> {
  await updateTaskMeta(metaPath, (meta) => {
    const observer = extractObject(meta.observer);
    meta.observer = {
      ...observer,
      runtime_view_path: String(observer.runtime_view_path ?? "observer_view.json"),
      bridge_packet_path:
        patch.bridge_packet_path ?? String(observer.bridge_packet_path ?? "observer_refinement_packet.json"),
      bridge_last_observed_at:
        patch.bridge_last_observed_at ?? String(observer.bridge_last_observed_at ?? ""),
      bridge_last_fingerprint:
        patch.bridge_last_fingerprint ?? String(observer.bridge_last_fingerprint ?? ""),
      bridge_last_request_id:
        patch.bridge_last_request_id ?? String(observer.bridge_last_request_id ?? ""),
      bridge_last_consumed_at: String(observer.bridge_last_consumed_at ?? ""),
      bridge_last_consumed_fingerprint: String(observer.bridge_last_consumed_fingerprint ?? ""),
      bridge_last_consumed_request_id: String(observer.bridge_last_consumed_request_id ?? ""),
    };
  });
}

export async function runTesterReadinessResetPhase(input: { metas: TaskMeta[] }): Promise<void> {
  for (const task of input.metas) {
    if (task.state !== "TESTING" && task.state !== "APPROVED") {
      continue;
    }
    await updateSchedulerOwnedMeta(task.metaPath, (meta) => {
      const scheduler = normalizeScheduler(meta.scheduler);
      const milestones = scheduler.worker_execution.milestones;
      const allMilestonesMet =
        scheduler.worker_execution.all_milestones_met === true || milestones.length === 0;
      if (!allMilestonesMet) {
        return;
      }
      scheduler.retry_count = 0;
      scheduler.recovery_count = 0;
      scheduler.consecutive_failure_count = 0;
      scheduler.last_worker_lifecycle_result = "success";
      scheduler.worker_execution.tester_ready = true;
      scheduler.degrade.active = false;
      scheduler.degrade.current_token_budget_cap = 0;
      scheduler.degrade.current_stage_write_budget_cap = 0;
      meta.scheduler = scheduler;
    });
  }
}
