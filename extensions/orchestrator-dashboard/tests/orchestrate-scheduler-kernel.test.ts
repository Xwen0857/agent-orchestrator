import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runSchedulerKernelTick } from "../orchestrate-scheduler-kernel.js";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("orchestrate-scheduler-kernel", () => {
  it("dispatches assigned tasks with kernel v2 summary", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_001";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      mode: "local_threads",
      security: {
        policy_mode: "enforce",
      },
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 2,
      maxTasks: 4,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.status).toBe("ok");
    expect(result.scheduler_kernel).toBe("v2");
    expect(result.processed).toBe(1);
    expect(result.advanced).toBe(1);
    const runtimeView = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "worker_runtime_view.json"), "utf8"),
    ) as Record<string, unknown>;
    const meta = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runtimeView.schema_version).toBe("worker-runtime-view-v1");
    expect((meta.worker_runtime as Record<string, unknown>).runtime_view_path).toBe(
      "worker_runtime_view.json",
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "transition_task_state" }),
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
  });

  it("enqueues distributed dispatch requests", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-dist-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_002";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      mode: "distributed",
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        distributed: {
          queue: {
            root: "runtime/scheduler-queue",
            request_topic: "scheduler.dispatch.request",
          },
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "distributed",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.processed).toBe(1);
    const queuePath = path.join(
      repoRoot,
      "runtime/scheduler-queue/scheduler.dispatch.request.ndjson",
    );
    const queue = await fs.readFile(queuePath, "utf8");
    expect(queue).toContain(taskId);
  });

  it("blocks side-effect dispatch on L0 runtime mismatch", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-l0-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_l0";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "mismatch",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.decision_authority_level).toBe("L0");
    expect(result.advanced).toBe(0);
    const hasAgentDispatch = (runWhitelistedScript.mock.calls as unknown[]).some((call) => {
      const args = call as unknown[];
      const first = args[0] as { scriptName?: string } | undefined;
      return first?.scriptName === "agent_dispatch";
    });
    const hasTransition = (runWhitelistedScript.mock.calls as unknown[]).some((call) => {
      const args = call as unknown[];
      const first = args[0] as { scriptName?: string } | undefined;
      return first?.scriptName === "transition_task_state";
    });
    expect(hasAgentDispatch).toBe(false);
    expect(hasTransition).toBe(false);
  });

  it("exposes L1 planner gate when replan lanes are present", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-l1-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });

    await writeJson(path.join(tasksRoot, "task_demo_l1_a", "meta.json"), {
      id: "task_demo_l1_a",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      runtime_replan: {
        consume_status: "paused",
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_l1_b", "meta.json"), {
      id: "task_demo_l1_b",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 2,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.decision_authority_level).toBe("L1");
    expect(result.paused_by_replan).toBe(1);
    const hasL1RejectEvent = (emitEvent.mock.calls as unknown[]).some((call) => {
      const args = call as unknown[];
      const type = args[0];
      const payload = args[1];
      if (type !== "orchestrate.scheduler.dispatch_event") {
        return false;
      }
      if (!payload || typeof payload !== "object") {
        return false;
      }
      return (payload as { action?: string }).action === "SCHEDULER_OVERRIDE_REJECTED";
    });
    expect(hasL1RejectEvent).toBe(true);
  });

  it("keeps L2 when runtime consistency is unknown and planner gate is not active", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-l2-unknown-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_l2_unknown", "meta.json"), {
      id: "task_demo_l2_unknown",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "unknown",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.decision_authority_level).toBe("L2");
  });

  it("counts dispatch success rate from actual adapter outcomes", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-metrics-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_metric_ok", "meta.json"), {
      id: "task_demo_metric_ok",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });
    await writeJson(path.join(tasksRoot, "task_demo_metric_fail", "meta.json"), {
      id: "task_demo_metric_fail",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
    });

    const runWhitelistedScript = vi.fn(async (input: { scriptName: string; args: string[] }) => {
      if (input.scriptName === "agent_dispatch" && input.args.includes("task_demo_metric_fail")) {
        throw new Error("dispatch failed");
      }
      return { stdout: "ok", stderr: "" };
    });
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 2,
      maxTasks: 2,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.processed).toBe(2);
    expect(result.advanced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dispatch_success_rate).toBe(0.5);
  });

  it("degrades worker budget lane once token usage reaches the fast threshold", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-budget-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_budget";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      budget: { max_token_cost: 1000 },
      consumption: { token_cost_used: 1000 },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const meta = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect((meta.worker_budget as Record<string, unknown>).budget_lane).toBe("degraded");
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "append_task_event",
        args: expect.arrayContaining(["WORKER_BUDGET_DEGRADED"]),
      }),
    );
  });

  it("requests reclaim and records keeper feedback when token usage exceeds reclaim threshold", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-reclaim-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_reclaim";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      budget: { max_token_cost: 1000 },
      consumption: { token_cost_used: 2200 },
      worker_convergence: {
        convergence_class: "stalled",
        convergence_confidence: 0.2,
        progress_delta: 0,
        remaining_work_estimate: "needs_replan",
        reclaim_reason: "stalled_no_effective_progress",
        reported_at: "2026-03-06T00:00:00Z",
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const meta = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect((meta.worker_budget as Record<string, unknown>).budget_lane).toBe("reclaim_pending");
    expect((meta.runtime_worker_control as Record<string, unknown>).budget_status).toBe(
      "reclaim_pending",
    );
    expect((meta.keeper_feedback as Record<string, unknown>).feedback_types).toEqual(
      expect.arrayContaining(["capacity_allocation_feedback", "refinement_quality_feedback"]),
    );
    expect((meta.keeper_feedback as Record<string, unknown>).submitted_candidates).toEqual(
      expect.arrayContaining(["capacity_allocation_feedback", "refinement_quality_feedback"]),
    );
    expect((meta.keeper_feedback as Record<string, unknown>).submitted_fingerprints).toEqual(
      expect.arrayContaining([
        expect.stringContaining("capacity_allocation_feedback"),
        expect.stringContaining("refinement_quality_feedback"),
      ]),
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "append_task_event",
        args: expect.arrayContaining(["WORKER_RECLAIM_REQUESTED"]),
      }),
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "kb_submit_candidate",
      }),
    );
  });

  it("submits a new keeper candidate when the fingerprint changes even if feedback type stays the same", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-fingerprint-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_fingerprint";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      project_id: "prj_demo",
      budget: { max_token_cost: 1000 },
      consumption: { token_cost_used: 2200 },
      keeper_feedback: {
        submitted_candidates: ["capacity_allocation_feedback"],
        submitted_fingerprints: [
          "capacity_allocation_feedback__token_budget_exhausted__prj_demo__old_component__reclaim_pending",
        ],
      },
      planning_decision: {
        worker_refinement: {
          component_candidates: ["new_component"],
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "kb_submit_candidate" }),
    );
  });

  it("marks rebuild-ready and records rebuilt event when a reclaimed task is reassembled with lower token pressure", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-rebuild-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_rebuild";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      budget: { max_token_cost: 1000 },
      consumption: { token_cost_used: 400 },
      runtime_worker_control: {
        budget_status: "reclaim_pending",
      },
      worker_convergence: {
        convergence_class: "stalled",
        convergence_confidence: 0.1,
        progress_delta: 0,
        remaining_work_estimate: "needs_rebuild",
        reclaim_reason: "refinement_too_coarse",
        reported_at: "2026-03-06T00:00:00Z",
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const meta = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect((meta.runtime_worker_control as Record<string, unknown>).rebuild_ready).toBe(true);
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "append_task_event",
        args: expect.arrayContaining(["WORKER_REBUILT_WITH_BUDGET"]),
      }),
    );
  });

  it("persists distributed consumer offsets to avoid replaying same ack rows", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-offset-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const queueRoot = path.join(repoRoot, "runtime/scheduler-queue");
    await fs.mkdir(queueRoot, { recursive: true });
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      mode: "distributed",
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        distributed: {
          queue: {
            root: "runtime/scheduler-queue",
            request_topic: "scheduler.dispatch.request",
            ack_topic: "scheduler.dispatch.ack",
            result_topic: "scheduler.dispatch.result",
            heartbeat_topic: "scheduler.worker.heartbeat",
          },
        },
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_offset", "meta.json"), {
      id: "task_demo_offset",
      state: "IN_PROGRESS",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        inflight: {
          operation_id: "op_task_demo_offset",
          dispatch_seq: 1,
          requested_at: "2026-03-06T00:00:00Z",
          ack_at: "",
          last_heartbeat_at: "",
        },
      },
    });
    await fs.writeFile(
      path.join(queueRoot, "scheduler.dispatch.ack.ndjson"),
      `${JSON.stringify({
        task_id: "task_demo_offset",
        operation_id: "op_task_demo_offset",
        dispatch_seq: 1,
        acked_at: "2026-03-06T00:00:01Z",
      })}\n`,
      "utf8",
    );

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const first = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "distributed",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });
    const second = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "distributed",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(first.inflight_acked).toBe(1);
    expect(second.inflight_acked).toBe(0);
    const stateRaw = await fs.readFile(path.join(queueRoot, ".consumer_state.json"), "utf8");
    expect(stateRaw).toContain("scheduler-consumer-state-v1");
  });
});
