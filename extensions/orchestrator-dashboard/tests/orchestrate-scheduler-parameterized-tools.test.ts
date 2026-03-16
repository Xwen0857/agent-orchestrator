import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SchedulerDispatchAdapter } from "../orchestrate-scheduler-adapters.js";
import { extractSchedulerConfig } from "../orchestrate-scheduler-contract.js";
import { applyDegradeTool } from "../orchestrate-scheduler-degrade-tool.js";
import { applyRecoveryTool } from "../orchestrate-scheduler-recovery-tool.js";
import { runSchedulerTaskSnapshotPhase } from "../orchestrate-scheduler-snapshot-phase.js";
import { runSelectionTool } from "../orchestrate-scheduler-selection-tool.js";
import { scheduleRetryTool } from "../orchestrate-scheduler-retry-tool.js";

function buildFormalCapability(agentType: "worker-delivery" | "tester-ephemeral" | "audit-guard") {
  return {
    schema_version: "scheduler-agent-dispatch-capability-v1",
    allowed_agent_types: [agentType],
    default_target_role_types: agentType === "worker-delivery" ? [] : [agentType],
    selected_template_id: `${agentType}_template`,
    selected_template_origin: "builtin",
    custom_runtime_gate_status: "allowed",
    custom_capability_gate_reason: "",
    skill_gate_status: "allowed",
    skill_gate_reason: "",
    dispatch_capability_class:
      agentType === "tester-ephemeral"
        ? "tester_targeted"
        : agentType === "audit-guard"
          ? "audit_targeted"
          : "general",
  };
}

function withFormalCapabilityDefaults(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const meta = value as Record<string, unknown>;
  const scheduler =
    meta.scheduler && typeof meta.scheduler === "object" && !Array.isArray(meta.scheduler)
      ? (meta.scheduler as Record<string, unknown>)
      : null;
  const rawAgentType = typeof scheduler?.agent_type === "string" ? scheduler.agent_type.trim() : "";
  if (
    rawAgentType !== "worker-delivery" &&
    rawAgentType !== "tester-ephemeral" &&
    rawAgentType !== "audit-guard"
  ) {
    return value;
  }
  const workerRuntime =
    meta.worker_runtime && typeof meta.worker_runtime === "object" && !Array.isArray(meta.worker_runtime)
      ? (meta.worker_runtime as Record<string, unknown>)
      : {};
  if (
    workerRuntime.agent_dispatch_capability &&
    typeof workerRuntime.agent_dispatch_capability === "object" &&
    !Array.isArray(workerRuntime.agent_dispatch_capability)
  ) {
    return value;
  }
  return {
    ...meta,
    worker_runtime: {
      ...workerRuntime,
      agent_dispatch_capability: buildFormalCapability(rawAgentType),
    },
  };
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const normalizedValue = targetPath.endsWith("/meta.json")
    ? withFormalCapabilityDefaults(value)
    : value;
  await fs.writeFile(targetPath, `${JSON.stringify(normalizedValue, null, 2)}\n`, "utf8");
}

function buildToolRuntime(repoRoot: string) {
  return {
    repoRoot,
    mode: "local_threads" as const,
    runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
    emitEvent: vi.fn(async () => {}),
  };
}

function buildAdapter(): SchedulerDispatchAdapter {
  return {
    mode: "local_threads",
    dispatch: vi.fn(async () => ({ ok: true, detail: "ok" })),
  };
}

describe("orchestrate-scheduler-parameterized-tools", () => {
  it("uses retry and recovery policy overrides during selection", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-select-override-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const cfg = extractSchedulerConfig({});

    await writeJson(path.join(tasksRoot, "task_retry_to_recovery", "meta.json"), {
      id: "task_retry_to_recovery",
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 1,
        recovery_count: 0,
      },
    });
    await writeJson(path.join(tasksRoot, "task_recovery_exhausted", "meta.json"), {
      id: "task_recovery_exhausted",
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 1,
        recovery_count: 1,
      },
    });

    const metas = await runSchedulerTaskSnapshotPhase({ tasksRoot });
    const decision = await runSelectionTool({
      metas,
      maxTasks: 2,
      schedulerConfig: cfg,
      retryPolicyOverride: { max_attempts: 1 },
      recoveryPolicyOverride: { max_attempts: 1 },
    });

    expect(decision.decision.selected).toContainEqual(
      expect.objectContaining({
        task_id: "task_retry_to_recovery",
        action: "recover",
      }),
    );
    expect(decision.decision.skipped).toContainEqual(
      expect.objectContaining({
        task_id: "task_recovery_exhausted",
        reason: "recovery_max_reached=1",
      }),
    );
  });

  it("uses agent-selected retry args for retry scheduling", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-retry-tool-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_retry_args";
    const cfg = extractSchedulerConfig({
      scheduler: {
        retry: {
          base_ms: 1000,
          max_ms: 5000,
          max_attempts: 5,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 0,
      },
    });

    const runtime = buildToolRuntime(repoRoot);
    const adapter = buildAdapter();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const start = Date.now();
    await scheduleRetryTool({
      runtime,
      adapter,
      tasksRoot,
      taskId,
      schedulerConfig: cfg,
      mode: "local_threads",
      compatibilityMode: "formal",
      lane: "retry",
      selectedToolArgs: {
        retry_base_ms: 100,
        retry_max_attempts: 2,
      },
    });
    randomSpy.mockRestore();

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<string, unknown>;
    const retryBackoffUntil = Date.parse(String(((meta.scheduler as Record<string, unknown>)?.retry_backoff_until ?? "")));
    expect(retryBackoffUntil - start).toBeLessThan(500);
  });

  it("uses agent-selected recovery uplift args during recovery relaunch", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-recovery-tool-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_recovery_args";
    const cfg = extractSchedulerConfig({
      scheduler: {
        recovery: {
          max_attempts: 3,
          token_uplift_ratio: 0.5,
          stage_write_budget_uplift_ratio: 0.5,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      budget: { max_token_cost: 1000 },
      worker_stage: {
        allocation: {
          worker_stage_max_bytes: 1000,
        },
      },
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 3,
        recovery_count: 0,
      },
    });

    const metas = await runSchedulerTaskSnapshotPhase({ tasksRoot });
    const runtime = buildToolRuntime(repoRoot);
    const adapter = buildAdapter();
    await applyRecoveryTool({
      runtime,
      adapter,
      selectedMeta: metas[0]!,
      tasksRoot,
      schedulerConfig: cfg,
      mode: "local_threads",
      taskId,
      compatibilityMode: "formal",
      lane: "recovery",
      selectedToolArgs: {
        recovery_max_attempts: 1,
        token_uplift_ratio: 0.1,
        stage_write_budget_uplift_ratio: 0.2,
      },
    });

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((meta.budget as Record<string, unknown>).max_token_cost).toBe(1100);
    expect(runtime.emitEvent).toHaveBeenCalledWith(
      "orchestrate.scheduler.dispatch_event",
      expect.objectContaining({
        action: "SCHEDULER_RECOVERY_APPLIED",
        detail: expect.stringContaining("stage_write_budget_uplift_ratio=0.2"),
      }),
    );
  });

  it("uses agent-selected degrade args during degrade application", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-degrade-tool-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_degrade_args";
    const cfg = extractSchedulerConfig({
      scheduler: {
        degrade: {
          milestone_stall_window_seconds: 300,
          milestone_stall_checks: 3,
          stage_write_stagnation_seconds: 120,
          token_budget_decay_ratio: 0.2,
          stage_write_budget_decay_ratio: 0.2,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      updated_at: "2026-03-06T00:00:00Z",
      budget: { max_token_cost: 1000 },
      worker_budget: { budget_lane: "fast", fast_token_budget: 1000 },
      worker_stage: {
        allocation: {
          worker_stage_max_bytes: 1000,
        },
      },
      scheduler: {
        agent_type: "worker-delivery",
        worker_execution: {
          last_progress_at: "2026-03-06T00:00:00Z",
          stall_checks: 2,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "observer_view.json"), {
      schema_version: "observer-view-v1",
      runtime: {
        all_milestones_met: false,
        milestone_detection_window_seconds: 300,
        stage_write_stagnation_seconds: 120,
      },
      worker_stage: {
        allocation: {
          worker_stage_max_bytes: 1000,
          worker_stage_bytes_used: 10,
          worker_stage_file_count: 1,
          worker_stage_overflow_status: "ok",
        },
      },
    });

    const metas = await runSchedulerTaskSnapshotPhase({ tasksRoot });
    const applied = await applyDegradeTool({
      schedulerConfig: cfg,
      metas,
      selectedToolArgs: {
        token_budget_decay_ratio: 0.1,
        stage_write_budget_decay_ratio: 0.4,
      },
    });

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<string, unknown>;
    expect(applied).toBe(1);
    expect((meta.worker_budget as Record<string, unknown>).fast_token_budget).toBe(900);
    expect(
      (((meta.worker_stage as Record<string, unknown>).allocation ?? {}) as Record<string, unknown>).worker_stage_max_bytes,
    ).toBe(600);
  });
});
