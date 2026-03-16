import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadEligibleTasks } from "../orchestrate-scheduler-task-snapshot-loader.js";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("orchestrate-scheduler-task-snapshot-loader", () => {
  it("loads task snapshots and refreshes observer artifacts outside the kernel", async () => {
    const tasksRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-loader-"));
    const openTaskDir = path.join(tasksRoot, "task_active");
    const closedTaskDir = path.join(tasksRoot, "task_closed");
    const runtimeRoot = path.join(openTaskDir, "worker_stages", "runtime");
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, "terminal.log"), "terminal\n", "utf8");

    await writeJson(path.join(openTaskDir, "meta.json"), {
      id: "task_active",
      state: "REJECTED",
      updated_at: "2026-03-12T00:00:00Z",
      worker_runtime: {
        agent_dispatch_capability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["worker-delivery"],
          default_target_role_types: [],
          selected_template_id: "worker-delivery_template",
          selected_template_origin: "builtin",
          custom_runtime_gate_status: "allowed",
          custom_capability_gate_reason: "",
          skill_gate_status: "allowed",
          skill_gate_reason: "",
          dispatch_capability_class: "general",
        },
        refinement_route_ref: {
          module_id: "module_loader",
          refinement_task_id: "task_active",
        },
        milestone_targets: ["bootstrap", "task_complete"],
        milestone_progress_signal: {
          completed_count: 1,
        },
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_active",
        worker_stage_root: path.join(openTaskDir, "worker_stages"),
        runtime_root: runtimeRoot,
        allocation: {
          worker_stage_bytes_used: 24,
          worker_stage_file_count: 1,
        },
        retention: {},
      },
      scheduler: {
        agent_type: "worker-delivery",
        retry_count: 2,
        escalation_bridge: {},
        knowledge_handoff: {},
      },
    });
    await writeJson(path.join(closedTaskDir, "meta.json"), {
      id: "task_closed",
      state: "CLOSED",
    });

    const metas = await loadEligibleTasks(tasksRoot);

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      taskId: "task_active",
      state: "REJECTED",
      agentDispatchCapability: {
        schema_version: "scheduler-agent-dispatch-capability-v1",
        allowed_agent_types: ["worker-delivery"],
        projection_source: "worker_runtime",
      },
      scheduler: {
        retry_count: 2,
      },
      runtimeWorkerControl: {
        workerFaultClass: "",
      },
    });
    expect(metas[0].observerView?.runtime).toMatchObject({
      refinement_route_ref: {
        module_id: "module_loader",
        refinement_task_id: "task_active",
      },
    });
    expect(await fs.stat(path.join(openTaskDir, "observer_view.json"))).toBeTruthy();
    expect(await fs.stat(path.join(openTaskDir, "worker_raw_log_index.json"))).toBeTruthy();
  });

  it("treats missing formal capability summary as a hard deny for every agent", async () => {
    const tasksRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-loader-legacy-"));
    const workerDeliveryDir = path.join(tasksRoot, "task_worker_delivery");
    const secondaryDir = path.join(tasksRoot, "task_secondary");

    await writeJson(path.join(workerDeliveryDir, "meta.json"), {
      id: "task_worker_delivery",
      state: "ASSIGNED",
      updated_at: "2026-03-12T00:00:00Z",
      scheduler: {
        agent_type: "worker-delivery",
      },
    });
    await writeJson(path.join(secondaryDir, "meta.json"), {
      id: "task_secondary",
      state: "ASSIGNED",
      updated_at: "2026-03-12T00:00:00Z",
      scheduler: {
        agent_type: "tester-ephemeral",
      },
    });

    const metas = await loadEligibleTasks(tasksRoot);
    const workerDelivery = metas.find((meta) => meta.taskId === "task_worker_delivery");
    const secondary = metas.find((meta) => meta.taskId === "task_secondary");

    expect(workerDelivery?.agentDispatchCapability).toMatchObject({
      projection_source: "missing",
      allowed_agent_types: [],
      skill_gate_reason: "gate_denied_by_missing_capability_summary",
    });
    expect(secondary?.agentDispatchCapability).toMatchObject({
      projection_source: "missing",
      allowed_agent_types: [],
      skill_gate_reason: "gate_denied_by_missing_capability_summary",
    });
  });

  it("normalizes missing agent_type to unknown instead of worker-delivery", async () => {
    const tasksRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scheduler-loader-unknown-"));
    const taskDir = path.join(tasksRoot, "task_unknown_agent");

    await writeJson(path.join(taskDir, "meta.json"), {
      id: "task_unknown_agent",
      state: "ASSIGNED",
      updated_at: "2026-03-12T00:00:00Z",
      scheduler: {
        retry_count: 1,
      },
    });

    const metas = await loadEligibleTasks(tasksRoot);

    expect(metas).toHaveLength(1);
    expect(metas[0]?.scheduler.agent_type).toBe("unknown");
    expect(metas[0]?.agentDispatchCapability).toMatchObject({
      projection_source: "missing",
      allowed_agent_types: [],
      skill_gate_reason: "gate_denied_by_missing_capability_summary",
    });
  });
});
