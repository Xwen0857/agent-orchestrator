import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runSchedulerKernelTick } from "../orchestrate-scheduler-kernel.js";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const normalizedValue = targetPath.endsWith("/meta.json")
    ? withFormalCapabilityDefaults(value)
    : value;
  await fs.writeFile(targetPath, `${JSON.stringify(normalizedValue, null, 2)}\n`, "utf8");
}

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

function findEmittedPayload(
  emitEvent: ReturnType<typeof vi.fn>,
  type: string,
  predicate?: (payload: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  for (const call of emitEvent.mock.calls as unknown[]) {
    const [eventType, payload] = call as [string, Record<string, unknown>];
    if (eventType !== type || !payload || typeof payload !== "object") {
      continue;
    }
    if (!predicate || predicate(payload)) {
      return payload;
    }
  }
  return null;
}

describe("orchestrate-scheduler-kernel", () => {
  it("keeps kernel focused on orchestration and avoids direct legacy execution helpers", async () => {
    const kernelSource = await fs.readFile(
      "/Users/dylan/.codex/skills-drafts/agent-orchestrator-suite/extensions/orchestrator-dashboard/orchestrate-scheduler-kernel.ts",
      "utf8",
    );

    expect(kernelSource).not.toContain("async function patchRetryMeta");
    expect(kernelSource).not.toContain("async function patchRecoveryMeta");
    expect(kernelSource).not.toContain("async function prepareWorkerRuntimeArtifacts");
    expect(kernelSource).not.toContain("async function applyWorkerFaultDecisionIfNeeded");
    expect(kernelSource).not.toContain("async function runObserverBridgePhase");
    expect(kernelSource).not.toContain("async function runInFlightDegradePhase");
  });

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
      scheduler: {
        agent_type: "worker-delivery",
      },
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
    expect(result.selected_count).toBe(1);
    expect(result.execution_attempted_count).toBe(1);
    expect(result.guard_skip_count).toBe(0);
    expect(result.advanced).toBe(1);
    const runtimeView = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "worker_runtime_view.json"), "utf8"),
    ) as Record<string, unknown>;
    const keeperQuery = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "scheduler_keeper_assembly_query.json"), "utf8"),
    ) as Record<string, unknown>;
    const failurePatternSummary = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "worker_failure_pattern_summary.json"), "utf8"),
    ) as Record<string, unknown>;
    const observerView = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "observer_view.json"), "utf8"),
    ) as Record<string, unknown>;
    const meta = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runtimeView.schema_version).toBe("worker-runtime-view-v1");
    expect((runtimeView.dispatch as Record<string, unknown>).execution_target).toMatchObject({
      schema_version: "worker-milestone-set-v1",
      task_id: taskId,
      source: "scheduler",
      evaluation_window_seconds: 300,
      summary: {
        all_required_met: false,
      },
    });
    expect((runtimeView.dispatch as Record<string, unknown>).history_handoff).toMatchObject({
      failure_pattern_summary: {
        schema_version: "worker-failure-pattern-summary-v1",
      },
      failure_pattern_index_refs: [],
    });
    expect((keeperQuery.schema_version)).toBe("scheduler-keeper-assembly-query-v1");
    expect((failurePatternSummary.schema_version)).toBe("worker-failure-pattern-summary-v1");
    expect(observerView.schema_version).toBe("observer-view-v1");
    expect(observerView.task_id).toBe(taskId);
    expect((observerView.terminal as Record<string, unknown>).available).toBe(false);
    expect((meta.worker_runtime as Record<string, unknown>).runtime_view_path).toBe(
      "worker_runtime_view.json",
    );
    expect((meta.worker_runtime as Record<string, unknown>).keeper_query_path).toBe(
      "scheduler_keeper_assembly_query.json",
    );
    expect((meta.worker_runtime as Record<string, unknown>).failure_pattern_summary_path).toBe(
      "worker_failure_pattern_summary.json",
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "transition_task_state" }),
    );
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
    expect(
      findEmittedPayload(
        emitEvent,
        "orchestrate.scheduler.dispatch_event",
        (payload) => payload.action === "SCHEDULER_DISPATCH_SELECTED",
      ),
    ).toEqual(
      expect.objectContaining({
        task_id: taskId,
        detail: expect.stringContaining("phase=execution compat=formal"),
      }),
    );
    expect(
      findEmittedPayload(
        emitEvent,
        "orchestrate.scheduler.kernel_tick",
      ),
    ).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          agent_control: {
            role: "scheduler-agent",
            mode: "control_agent_v1",
            heartbeat_schema_version: "scheduler-agent-heartbeat-v1",
          },
        }),
        policy_summary: {
          selected: [
            {
              task_id: taskId,
              compatibility_mode: "formal",
              dispatch_gate_reason: "",
              skill_gate_reason: "",
            },
          ],
          skipped: [],
        },
        decision: expect.objectContaining({
          agent_heartbeat: expect.objectContaining({
            schema_version: "scheduler-agent-heartbeat-v1",
            selected_flow: "selection_flow",
            selected_skill: "selection-skill",
            selected_main_tool: "run_selection_tool",
            baseline_reference: expect.objectContaining({
              flow: "selection_flow",
              skill: "selection-skill",
              main_tool: "run_selection_tool",
            }),
            baseline_flow: "selection_flow",
            baseline_skill: "selection-skill",
            baseline_main_tool: "run_selection_tool",
            baseline_bypassed: false,
            decision_mode: "baseline_followed",
            deviation_reason: "",
            reasoning_summary: expect.objectContaining({
              baseline_status: "followed",
            }),
            execution_log_ref: expect.stringContaining("orchestrate.scheduler.kernel_tick:"),
            reasoning_record_ref: "",
            execution_result: "completed",
          }),
        }),
      }),
    );
    expect(
      findEmittedPayload(
        emitEvent,
        "orchestrate.scheduler.agent_heartbeat",
      ),
    ).toEqual(
      expect.objectContaining({
        request_id: expect.any(String),
        heartbeat: expect.objectContaining({
          schema_version: "scheduler-agent-heartbeat-v1",
          selected_flow: "selection_flow",
          selected_skill: "selection-skill",
          selected_main_tool: "run_selection_tool",
          baseline_flow: "selection_flow",
          baseline_skill: "selection-skill",
          baseline_main_tool: "run_selection_tool",
          baseline_bypassed: false,
          decision_mode: "baseline_followed",
          reasoning_record_ref: "",
        }),
      }),
    );
  });

  it("uses agent-selected selection max_tasks as a real execution input", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-selection-args-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
      },
    });
    for (const taskId of ["task_select_1", "task_select_2"]) {
      await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
        id: taskId,
        state: "ASSIGNED",
        updated_at: "2026-03-06T00:00:00Z",
        scheduler: {
          agent_type: "worker-delivery",
        },
      });
    }

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

    expect(result.selected_count).toBe(1);
    expect(
      findEmittedPayload(emitEvent, "orchestrate.scheduler.agent_heartbeat"),
    ).toEqual(
      expect.objectContaining({
        heartbeat: expect.objectContaining({
          selected_flow: "selection_flow",
          selected_tool_args: expect.objectContaining({
            max_tasks: 1,
          }),
          reasoning_summary: expect.objectContaining({
            parameter_adjustments: expect.arrayContaining(["max_tasks=1(default=2)"]),
          }),
          reasoning_record_ref: expect.stringContaining(
            "templates/coordination/orchestrator/scheduler_reasoning_records/",
          ),
        }),
      }),
    );
    const heartbeatPayload = findEmittedPayload(emitEvent, "orchestrate.scheduler.agent_heartbeat");
    const reasoningRecordRef = ((heartbeatPayload?.heartbeat as Record<string, unknown> | undefined)
      ?.reasoning_record_ref ?? "") as string;
    expect(reasoningRecordRef).toMatch(
      /^templates\/coordination\/orchestrator\/scheduler_reasoning_records\/scheduler_reasoning_scheduler_req_\d+\.json$/,
    );
    const persistedRecord = JSON.parse(
      await fs.readFile(path.join(repoRoot, reasoningRecordRef), "utf8"),
    ) as Record<string, unknown>;
    expect(persistedRecord.schema_version).toBe("scheduler-inference-divergence-record-v1");
    expect(persistedRecord.divergence_description).toBe(
      "agent_adjusted_parameterized_execution_within_soft_constraints",
    );
    const indexPath = path.join(
      repoRoot,
      "templates/coordination/orchestrator/scheduler_reasoning_records/index.ndjson",
    );
    const indexContents = await fs.readFile(indexPath, "utf8");
    expect(indexContents).toContain(reasoningRecordRef);
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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

    expect(result.selected_count).toBe(1);
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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
    expect(result.selected_count).toBe(1);
    expect(result.execution_attempted_count).toBe(0);
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
    expect(
      findEmittedPayload(
        emitEvent,
        "orchestrate.scheduler.dispatch_event",
        (payload) => payload.action === "SCHEDULER_OVERRIDE_REJECTED" && payload.task_id === taskId,
      ),
    ).toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("phase=execution compat=formal"),
      }),
    );
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
      scheduler: {
        agent_type: "worker-delivery",
      },
      runtime_replan: {
        consume_status: "paused",
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_l1_b", "meta.json"), {
      id: "task_demo_l1_b",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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
      scheduler: {
        agent_type: "worker-delivery",
      },
    });
    await writeJson(path.join(tasksRoot, "task_demo_metric_fail", "meta.json"), {
      id: "task_demo_metric_fail",
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
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

    expect(result.selected_count).toBe(2);
    expect(result.advanced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dispatch_success_rate).toBe(0.5);
  });

  it("does not dispatch assigned tasks with missing agent_type", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-unknown-agent-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_unknown_agent";
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
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.selected_count).toBe(0);
    expect(result.execution_attempted_count).toBe(0);
    expect(result.advanced).toBe(0);
    expect(runWhitelistedScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
  });

  it("hard-gates dispatch when runtime capability summary blocks the agent", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-cap-gate-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_cap_gate";
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
      scheduler: {
        agent_type: "worker-delivery",
      },
      worker_runtime: {
        agent_dispatch_capability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["tester-ephemeral"],
          default_target_role_types: ["tester-ephemeral"],
          selected_template_id: "custom_bundle",
          selected_template_origin: "custom",
          custom_runtime_gate_status: "blocked",
          custom_capability_gate_reason: "containerized_reserved",
          skill_gate_status: "blocked",
          skill_gate_reason: "containerized_reserved",
          dispatch_capability_class: "general",
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.selected_count).toBe(0);
    expect(result.execution_attempted_count).toBe(0);
    expect(result.advanced).toBe(0);
    expect(runWhitelistedScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
  });

  it("keeps maintenance phases active even when execution dispatch is capability-blocked", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-maintenance-gated-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_maintenance_gated";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        artifact_lifecycle_policy: {
          actuation_mode: "summary_only",
          allow_archive: true,
          allow_purge: true,
          allow_reclaim: true,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "ASSIGNED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
      runtime_worker_control: {
        archive_ready: true,
        retention_decision: "archive_delivery_bundle",
      },
      worker_runtime: {
        agent_dispatch_capability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["tester-ephemeral"],
          default_target_role_types: ["tester-ephemeral"],
          selected_template_id: "custom_bundle",
          selected_template_origin: "custom",
          custom_runtime_gate_status: "blocked",
          custom_capability_gate_reason: "containerized_reserved",
          skill_gate_status: "blocked",
          skill_gate_reason: "containerized_reserved",
          dispatch_capability_class: "general",
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.selected_count).toBe(0);
    expect(result.execution_attempted_count).toBe(0);
    expect(result.guard_skip_count).toBe(0);
    expect(result.advanced).toBe(0);
    expect(runWhitelistedScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
    const hasMaintenanceEvent = (emitEvent.mock.calls as unknown[]).some((call) => {
      const args = call as unknown[];
      const type = args[0];
      const payload = args[1];
      if (type !== "orchestrate.scheduler.dispatch_event") {
        return false;
      }
      if (!payload || typeof payload !== "object") {
        return false;
      }
      return (payload as { action?: string }).action === "SCHEDULER_ARTIFACT_LIFECYCLE_DEFERRED";
    });
    expect(hasMaintenanceEvent).toBe(true);
    expect(
      findEmittedPayload(
        emitEvent,
        "orchestrate.scheduler.dispatch_event",
        (payload) => payload.action === "SCHEDULER_ARTIFACT_LIFECYCLE_DEFERRED",
      ),
    ).toEqual(
      expect.objectContaining({
        task_id: taskId,
        detail: expect.stringContaining("phase=maintenance"),
      }),
    );
    expect(
      findEmittedPayload(emitEvent, "orchestrate.scheduler.kernel_tick"),
    ).toEqual(
      expect.objectContaining({
        policy_summary: {
          selected: [],
          skipped: [
            expect.objectContaining({
              task_id: taskId,
              compatibility_mode: "formal",
            }),
          ],
        },
      }),
    );
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
      scheduler: {
        agent_type: "worker-delivery",
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
    expect((meta.worker_budget as Record<string, unknown>).budget_lane).toBe("degraded");
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "append_task_event",
        args: expect.arrayContaining(["WORKER_BUDGET_DEGRADED"]),
      }),
    );
  });

  it("relaunches rejected tasks through recovery with uplifted budgets after retry exhaustion", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-recovery-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_recovery";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: { max_attempts: 3 },
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
        worker_execution: {
          milestones: ["bootstrap", "task_complete"],
          completed_targets: ["bootstrap"],
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
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
    const runtimeView = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "worker_runtime_view.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.recovery_applied).toBe(1);
    expect((meta.budget as Record<string, unknown>).max_token_cost).toBeGreaterThan(1000);
    expect(
      ((((meta.worker_stage as Record<string, unknown>).allocation ?? {}) as Record<string, unknown>).worker_stage_max_bytes),
    ).toBeGreaterThan(1000);
    expect(((meta.scheduler as Record<string, unknown>).recovery_count)).toBe(1);
    expect((runtimeView.dispatch as Record<string, unknown>).lane).toBe("recovery");
    expect((runtimeView.dispatch as Record<string, unknown>).execution_target).toMatchObject({
      milestones: expect.arrayContaining([
        expect.objectContaining({ milestone_id: "bootstrap", status: "satisfied" }),
        expect.objectContaining({ milestone_id: "task_complete", status: "pending" }),
      ]),
      summary: expect.objectContaining({ satisfied_count: 1 }),
    });
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "transition_task_state",
        args: expect.arrayContaining([path.join(tasksRoot, taskId), "scheduler-ops", "REJECTED", "IN_PROGRESS"]),
      }),
    );
  });

  it("writes recovery_exhausted escalation only after recovery limit is reached", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-recovery-exhausted-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_recovery_exhausted";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: { max_attempts: 3 },
        recovery: { max_attempts: 3 },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 3,
        recovery_count: 3,
        consecutive_failure_count: 6,
        last_worker_lifecycle_result: "failure",
        recovery_hint: "recovery_uplift_relaunch",
        dispatch_seq: 7,
        degrade: {
          active: true,
          count: 1,
        },
      },
      worker_runtime: {
        refinement_route_ref: {
          module_id: "module_runtime",
          refinement_task_id: taskId,
        },
        milestone_targets: ["bootstrap", "task_complete"],
        milestone_progress_signal: {
          completed_count: 1,
        },
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo_recovery_exhausted",
        retention: {
          worker_stage_last_fault_class: "worker_stage_exhausted",
        },
      },
      runtime_worker_control: {
        last_fault_action_applied: "retry",
        worker_fault_class: "worker_stage_exhausted",
      },
      worker_convergence: {
        convergence_class: "stalled",
      },
    });
    await fs.writeFile(path.join(tasksRoot, taskId, "work.md"), "recovery evidence\n", "utf8");
    await fs.mkdir(path.join(tasksRoot, taskId, "worker_stages", "runtime"), { recursive: true });
    await fs.mkdir(path.join(tasksRoot, taskId, "worker_stages", "scratch"), { recursive: true });
    await fs.writeFile(
      path.join(tasksRoot, taskId, "worker_stages", "runtime", "terminal.log"),
      "terminal\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tasksRoot, taskId, "worker_stages", "scratch", "notes.txt"),
      "scratch noise\n",
      "utf8",
    );
    await writeJson(path.join(tasksRoot, taskId, "result.json"), { status: "failed" });
    const metaPath = path.join(tasksRoot, taskId, "meta.json");
    const seededMeta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
    seededMeta.worker_stage = {
      ...((seededMeta.worker_stage as Record<string, unknown> | undefined) ?? {}),
      worker_stage_root: path.join(tasksRoot, taskId, "worker_stages"),
      runtime_root: path.join(tasksRoot, taskId, "worker_stages", "runtime"),
      scratch_root: path.join(tasksRoot, taskId, "worker_stages", "scratch"),
    };
    await writeJson(metaPath, seededMeta);

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const request = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "scheduler_escalation_request.json"), "utf8"),
    ) as Record<string, unknown>;
    const terminalDigest = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "worker_terminal_digest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(result.observer_escalation_requests).toBe(1);
    expect(request.trigger).toBe("recovery_exhausted");
    expect((request.scheduler_context as Record<string, unknown>).recovery_count).toBe(3);
    expect((request.scheduler_context as Record<string, unknown>).consecutive_failure_count).toBe(6);
    expect((request.observation_snapshot as Record<string, unknown>).current_instance_degraded).toBe(true);
    expect(terminalDigest).toMatchObject({
      schema_version: "worker-terminal-digest-v1",
      lifecycle_result: "failure",
      milestones: {
        target_count: 2,
        completed_count: 1,
      },
      evidence: {
        raw_log_index_path: "worker_raw_log_index.json",
      },
    });
    expect(((request.evidence as Record<string, unknown>).paths as unknown[])).toContain("worker_terminal_digest.json");
    expect(((request.evidence as Record<string, unknown>).paths as unknown[])).not.toContain(
      "worker_raw_log_index.json",
    );
    expect((request.routing_indexes as Record<string, unknown>).module_id).toBe("module_runtime");
    expect((request.routing_indexes as Record<string, unknown>).refinement_task_id).toBe(taskId);
    expect((request.evidence_indexes as Record<string, unknown>).raw_log_index_path).toBe("worker_raw_log_index.json");
  });

  it("applies instance-level degrade when milestone progress stalls", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-degrade-milestone-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_milestone_stall";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        degrade: {
          milestone_stall_window_seconds: 300,
          milestone_stall_checks: 3,
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
      worker_runtime: {
        milestone_targets: ["bootstrap", "task_complete"],
        milestone_progress_signal: {
          completed_count: 0,
        },
        milestone_detection_window_seconds: 300,
        stage_write_stagnation_seconds: 120,
        all_milestones_met: false,
      },
      worker_stage: {
        allocation: {
          worker_stage_max_bytes: 1000,
          worker_stage_bytes_used: 10,
          worker_stage_file_count: 1,
          worker_stage_overflow_status: "ok",
        },
      },
      scheduler: {
        worker_execution: {
          milestones: ["bootstrap", "task_complete"],
          completed_targets: [],
          last_progress_at: "2026-03-06T00:00:00Z",
          stall_checks: 2,
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
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
    const scheduler = (meta.scheduler ?? {}) as Record<string, unknown>;
    const degrade = (scheduler.degrade ?? {}) as Record<string, unknown>;

    expect(result.degrade_applied).toBe(1);
    expect(degrade.active).toBe(true);
    expect(degrade.last_reason).toBe("milestone_stall");
    expect((((meta.worker_budget as Record<string, unknown>).fast_token_budget))).toBeLessThan(1000);
  });

  it("applies instance-level degrade when worker stage writes stagnate", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-degrade-stage-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_stage_stall";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        degrade: {
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
      worker_runtime: {
        milestone_targets: ["task_complete"],
        milestone_progress_signal: {
          completed_count: 0,
        },
        all_milestones_met: false,
      },
      worker_stage: {
        allocation: {
          worker_stage_max_bytes: 1000,
          worker_stage_bytes_used: 10,
          worker_stage_file_count: 1,
          worker_stage_overflow_status: "ok",
        },
      },
      scheduler: {
        degrade: {
          last_stage_signature: "6b1edf1f8e5c2102852d19ebe2f02953dc36d43b",
          last_stage_write_at: "2026-03-06T00:00:00Z",
        },
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
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
    const scheduler = (meta.scheduler ?? {}) as Record<string, unknown>;
    const degrade = (scheduler.degrade ?? {}) as Record<string, unknown>;

    expect(result.degrade_applied).toBe(1);
    expect(degrade.active).toBe(true);
    expect(degrade.last_reason).toBe("stage_write_stagnation");
    expect(
      ((((meta.worker_stage as Record<string, unknown>).allocation ?? {}) as Record<string, unknown>).worker_stage_max_bytes),
    ).toBeLessThan(1000);
    expect(result.observer_escalation_requests).toBe(0);
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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
      scheduler: {
        agent_type: "worker-delivery",
      },
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

  it("records deferred fault action in summary_only mode without retrying", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-fault-summary-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_fault_summary";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        worker_fault_policy: {
          fault_actuation_mode: "summary_only",
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
      runtime_worker_control: {
        last_worker_fault_action: "rebuild",
        worker_fault_requires_rebuild: true,
        worker_fault_class: "worker_stage_exhausted",
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

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((meta.runtime_worker_control as Record<string, unknown>).last_fault_action_applied).toBe("rebuild");
    expect((meta.runtime_worker_control as Record<string, unknown>).fault_actuation_mode).toBe("summary_only");
    expect((meta.runtime_worker_control as Record<string, unknown>).last_worker_fault_action).toBe("rebuild");
    expect(runWhitelistedScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.scheduler.dispatch_event",
      expect.objectContaining({ action: "SCHEDULER_FAULT_ACTION_DEFERRED", task_id: taskId }),
    );
  });

  it("applies enabled rebuild fault action and dispatches retry path", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-fault-rebuild-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_fault_rebuild";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        worker_fault_policy: {
          fault_actuation_mode: "enabled",
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
      runtime_worker_control: {
        last_worker_fault_action: "rebuild",
        worker_fault_requires_rebuild: true,
        worker_fault_class: "worker_stage_exhausted",
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

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((meta.runtime_worker_control as Record<string, unknown>).last_fault_action_applied).toBe("rebuild");
    expect((meta.runtime_worker_control as Record<string, unknown>).last_worker_fault_action).toBe("none");
    expect((meta.runtime_worker_control as Record<string, unknown>).rebuild_ready).toBe(true);
    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
  });

  it("applies enabled block fault action without redispatching", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-fault-block-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_fault_block";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        worker_fault_policy: {
          fault_actuation_mode: "enabled",
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
      runtime_worker_control: {
        last_worker_fault_action: "block",
        worker_fault_class: "worker_stage_forbidden_write",
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

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((meta.runtime_worker_control as Record<string, unknown>).last_fault_action_applied).toBe("block");
    expect((meta.runtime_worker_control as Record<string, unknown>).last_worker_fault_action).toBe("none");
    expect(runWhitelistedScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ scriptName: "agent_dispatch" }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.scheduler.dispatch_event",
      expect.objectContaining({ action: "SCHEDULER_FAULT_ACTION_APPLIED", task_id: taskId }),
    );
  });

  it("defers artifact lifecycle actuation in summary_only mode", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-artifact-summary-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_artifact_summary";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        artifact_lifecycle_policy: {
          actuation_mode: "summary_only",
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "COMPLETED",
      updated_at: "2026-03-06T00:00:00Z",
      runtime_worker_control: {
        archive_ready: true,
        retention_decision: "retain_delivery_only",
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "delivery.export-records.json"), [
      {
        artifact_id: "artifact_1",
        path: "delivery/output.txt",
        artifact_type: "text/plain",
        size_bytes: 10,
        digest_sha256: "abc",
        export_class: "delivery_manifest",
        exported_at: "2026-03-06T00:00:00Z",
        consumption_status: "available",
        archive_status: "active",
        retention_status: "retained",
      },
    ]);
    await fs.mkdir(path.join(tasksRoot, taskId, "delivery"), { recursive: true });
    await fs.writeFile(path.join(tasksRoot, taskId, "delivery", "output.txt"), "hello", "utf8");

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

    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.scheduler.dispatch_event",
      expect.objectContaining({ action: "SCHEDULER_ARTIFACT_LIFECYCLE_DEFERRED", task_id: taskId }),
    );
    await expect(fs.access(path.join(tasksRoot, taskId, "delivery", "output.txt"))).resolves.toBeUndefined();
  });

  it("applies enabled artifact archive and purge actions", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-artifact-enabled-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_artifact_enabled";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        artifact_lifecycle_policy: {
          actuation_mode: "enabled",
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "COMPLETED",
      updated_at: "2026-03-06T00:00:00Z",
      runtime_worker_control: {
        archive_ready: true,
        purge_ready: true,
        retention_decision: "retain_delivery_only",
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "delivery.export-records.json"), [
      {
        artifact_id: "artifact_1",
        path: "delivery/output.txt",
        artifact_type: "text/plain",
        size_bytes: 10,
        digest_sha256: "abc",
        export_class: "delivery_manifest",
        exported_at: "2026-03-06T00:00:00Z",
        consumption_status: "available",
        archive_status: "active",
        retention_status: "retained",
      },
    ]);
    await fs.mkdir(path.join(tasksRoot, taskId, "delivery"), { recursive: true });
    await fs.writeFile(path.join(tasksRoot, taskId, "delivery", "output.txt"), "hello", "utf8");
    await fs.mkdir(path.join(tasksRoot, taskId, "worker_stages", "workerstage_1"), { recursive: true });

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

    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const exportRecords = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "delivery.export-records.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    const workerStageRetention = ((((meta.worker_stage as Record<string, unknown>).retention ??
      {}) as Record<string, unknown>));
    expect((meta.runtime_worker_control as Record<string, unknown>).archive_ready).toBe(false);
    expect((meta.runtime_worker_control as Record<string, unknown>).purge_ready).toBe(false);
    expect(workerStageRetention.worker_stage_archive_ready).toBe(false);
    expect(workerStageRetention.worker_stage_purge_ready).toBe(false);
    await expect(fs.access(path.join(tasksRoot, taskId, "delivery.archive", "archive-manifest.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tasksRoot, taskId, "delivery", "output.txt"))).rejects.toThrow();
    expect(exportRecords[0]?.last_lifecycle_action).toBe("scheduler_purged");
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.scheduler.dispatch_event",
      expect.objectContaining({ action: "SCHEDULER_ARTIFACT_LIFECYCLE_APPLIED", task_id: taskId }),
    );
  });

  it("writes scheduler escalation request and observer bridge packet when recovery is exhausted", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-escalation-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_escalation";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: {
          max_attempts: 2,
        },
        recovery: {
          max_attempts: 2,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 2,
        recovery_count: 2,
        consecutive_failure_count: 4,
        last_worker_lifecycle_result: "failure",
        last_dispatch_mode: "local_threads",
        dispatch_seq: 4,
      },
      worker_runtime: {
        selected_template_id: "code_backend_java_spring",
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo_escalation",
        retention: {
          worker_stage_last_fault_class: "worker_stage_exhausted",
        },
      },
      runtime_worker_control: {
        last_fault_action_applied: "retry",
        worker_fault_class: "worker_stage_exhausted",
      },
      worker_convergence: {
        convergence_class: "stalled",
        reclaim_reason: "refinement_too_coarse",
      },
    });
    await fs.writeFile(path.join(tasksRoot, taskId, "work.md"), "retry evidence\n", "utf8");

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const request = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "scheduler_escalation_request.json"), "utf8"),
    ) as Record<string, unknown>;
    const packet = JSON.parse(
      await fs.readFile(path.join(tasksRoot, taskId, "observer_refinement_packet.json"), "utf8"),
    ) as Record<string, unknown>;
    const meta = JSON.parse(await fs.readFile(path.join(tasksRoot, taskId, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const scheduler = (meta.scheduler ?? {}) as Record<string, unknown>;
    const bridge = (scheduler.escalation_bridge ?? {}) as Record<string, unknown>;

    expect(result.observer_escalation_requests).toBe(1);
    expect(result.observer_bridge_packets).toBe(1);
    expect(request.schema_version).toBe("scheduler-escalation-request-v1");
    expect(request.trigger).toBe("recovery_exhausted");
    expect(request.refinement_signal).toEqual(
      expect.objectContaining({
        necessity_tier: "critical",
        necessity_fingerprint: expect.any(String),
      }),
    );
    expect(packet.schema_version).toBe("observer-refinement-packet-v1");
    expect(packet.task_id).toBe(taskId);
    expect(packet.refinement_signal).toEqual(request.refinement_signal);
    expect((packet.core_ingress_hint as Record<string, unknown>).re_refinement_candidate).toBe(true);
    expect(bridge.last_trigger).toBe("recovery_exhausted");
    expect(String(bridge.last_bridge_fingerprint ?? "")).not.toBe("");
    const kernelTick = findEmittedPayload(emitEvent, "orchestrate.scheduler.kernel_tick");
    expect(kernelTick).toEqual(
      expect.objectContaining({
        decision: expect.objectContaining({
          summary: expect.objectContaining({
            observer_bridge: expect.objectContaining({
              active: true,
              request_count: 1,
              packet_count: 1,
              bridged_task_ids: [taskId],
              bridged_task_refs: [
                expect.objectContaining({
                  task_id: taskId,
                  request_id: expect.any(String),
                  fingerprint: expect.any(String),
                  trigger: "recovery_exhausted",
                  request_path: "scheduler_escalation_request.json",
                  packet_path: "observer_refinement_packet.json",
                  requested_at: expect.any(String),
                }),
              ],
              last_request_id: expect.any(String),
              last_fingerprint: expect.any(String),
              last_trigger: "recovery_exhausted",
              packet_path: "observer_refinement_packet.json",
            }),
          }),
          agent_heartbeat: expect.objectContaining({
            observer_bridge: expect.objectContaining({
              active: true,
              request_count: 1,
              packet_count: 1,
              bridged_task_ids: [taskId],
              bridged_task_refs: [
                expect.objectContaining({
                  task_id: taskId,
                  request_id: expect.any(String),
                  fingerprint: expect.any(String),
                  trigger: "recovery_exhausted",
                  request_path: "scheduler_escalation_request.json",
                  packet_path: "observer_refinement_packet.json",
                  requested_at: expect.any(String),
                }),
              ],
              last_request_id: expect.any(String),
              last_fingerprint: expect.any(String),
              last_trigger: "recovery_exhausted",
              packet_path: "observer_refinement_packet.json",
            }),
          }),
        }),
      }),
    );
    expect(meta.planner_replan).toBeUndefined();
    expect(meta.runtime_replan).toBeUndefined();
  });

  it("does not write escalation artifacts when retry remains eligible", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-no-escalation-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_no_escalation";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: {
          max_attempts: 2,
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
      worker_runtime: {
        selected_template_id: "code_backend_java_spring",
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo_no_escalation",
      },
    });

    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const result = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    expect(result.observer_escalation_requests).toBe(0);
    await expect(
      fs.access(path.join(tasksRoot, taskId, "scheduler_escalation_request.json")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tasksRoot, taskId, "observer_refinement_packet.json")),
    ).rejects.toThrow();
  });

  it("does not regenerate bridge artifacts when the same recovery exhaustion fingerprint repeats", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-escalation-dedupe-"));
    const tasksRoot = path.join(repoRoot, "templates/coordination/tasks/task_folders");
    const taskId = "task_demo_escalation_dedupe";
    await writeJson(path.join(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"), {
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: {
          max_attempts: 2,
        },
        recovery: {
          max_attempts: 2,
        },
      },
    });
    await writeJson(path.join(tasksRoot, taskId, "meta.json"), {
      id: taskId,
      state: "REJECTED",
      updated_at: "2026-03-06T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 2,
        recovery_count: 2,
        consecutive_failure_count: 4,
        last_worker_lifecycle_result: "failure",
        last_dispatch_mode: "local_threads",
        dispatch_seq: 4,
      },
      worker_runtime: {
        selected_template_id: "code_backend_java_spring",
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo_escalation_dedupe",
        retention: {
          worker_stage_last_fault_class: "worker_stage_exhausted",
        },
      },
      runtime_worker_control: {
        last_fault_action_applied: "retry",
        worker_fault_class: "worker_stage_exhausted",
      },
      worker_convergence: {
        convergence_class: "stalled",
        reclaim_reason: "refinement_too_coarse",
      },
    });
    await fs.writeFile(path.join(tasksRoot, taskId, "work.md"), "retry evidence\n", "utf8");

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

    const firstPacket = await fs.readFile(
      path.join(tasksRoot, taskId, "observer_refinement_packet.json"),
      "utf8",
    );

    const second = await runSchedulerKernelTick({
      repoRoot,
      tasksRootArg: path.relative(repoRoot, tasksRoot),
      mode: "local_threads",
      maxParallel: 1,
      maxTasks: 1,
      runtimeConsistency: "ok",
      runWhitelistedScript,
      emitEvent,
    });

    const secondPacket = await fs.readFile(
      path.join(tasksRoot, taskId, "observer_refinement_packet.json"),
      "utf8",
    );
    expect(second.observer_escalation_requests).toBe(0);
    expect(second.observer_bridge_packets).toBe(0);
    expect(secondPacket).toBe(firstPacket);
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
