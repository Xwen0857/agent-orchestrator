import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const createTaskScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "create_task_from_strategy.sh",
);
const buildRolePermissionsScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "build_role_permissions.sh",
);
const consumeObserverBridgeScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "planner_consume_observer_bridge.sh",
);
const templateDir = path.join(
  repoRoot,
  "templates",
  "coordination",
  "tasks",
  "task_folders",
  "_task_id_",
);

const tempDirs: string[] = [];

async function createHarness(taskId: string, goal: string) {
  const tasksRoot = await fs.mkdtemp(
    path.join(repoRoot, "templates", "coordination", "tasks", "task_folders", ".observer-bridge-"),
  );
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "observer-bridge-state-"));
  const strategyPath = path.join(tasksRoot, `${taskId}.strategy.json`);
  tempDirs.push(tasksRoot, stateRoot);
  await fs.cp(templateDir, path.join(tasksRoot, "_task_id_"), { recursive: true });
  await fs.writeFile(
    strategyPath,
    JSON.stringify({
      task_id: taskId,
      title: goal,
      goal,
      owner: "planner-core",
      risk_level: "MEDIUM",
      budget: {
        max_token_cost: 50000,
        max_execution_time_seconds: 3600,
      },
      summary_input: {
        task_goal: goal,
        constraints: ["python only"],
        deliverables: ["source"],
        notes: ["prefer local fixtures"],
      },
      workspace: {
        project_id: "prj_demo",
        workspace_root: "apps/demo",
        source: "run_flag",
      },
      created_at: "2026-03-02T00:00:00Z",
      status: "drafted",
      source: {
        channel: "cli",
        sender_id: "tester",
        session_key: "sess_demo",
        message_thread_id: null,
      },
      raw_request: goal,
    }),
    "utf8",
  );

  const taskDir = execFileSync(
    createTaskScript,
    [strategyPath, tasksRoot, path.join(tasksRoot, "_task_id_")],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: stateRoot,
      },
    },
  ).trim();

  const metaPath = path.join(taskDir, "meta.json");
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
  meta.state = "IN_PROGRESS";
  meta.scheduler = {
    escalation_bridge: {
      last_request_id: "req_prev",
      last_bridge_fingerprint: "fp_prev",
      last_trigger: "retry_exhausted",
    },
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(taskDir, "work.md"), "# Work\n", "utf8");
  await fs.writeFile(path.join(taskDir, "plan.md"), "# Plan\n", "utf8");

  return {
    stateRoot,
    taskDir,
    taskId,
    metaPath,
    logPath: path.join(taskDir, "log.ndjson"),
    planPath: path.join(taskDir, "plan.md"),
    workPath: path.join(taskDir, "work.md"),
    intakePath: path.join(taskDir, "planner_observer_bridge_intake.json"),
    packetPath: path.join(taskDir, "observer_refinement_packet.json"),
  };
}

async function writeBridgePacket(taskDir: string, taskId: string, requestId = "req_bridge_001", fingerprint = "fp_bridge_001") {
  await fs.writeFile(
    path.join(taskDir, "observer_refinement_packet.json"),
    `${JSON.stringify(
      {
        schema_version: "observer-refinement-packet-v1",
        observed_at: "2026-03-12T00:15:00Z",
        task_id: taskId,
        request_id: requestId,
        bridge_fingerprint: fingerprint,
        escalation_reason: "retry_exhausted",
        execution_exhaustion: {
          retry_count: 3,
          recovery_count: 0,
          consecutive_failure_count: 3,
          last_dispatch_mode: "local_threads",
          last_recovery_hint: "",
          dispatch_seq: 2,
          last_worker_lifecycle_result: "failure",
          attempts: [
            {
              kind: "retry",
              status: "attempted",
              detail: "retry_count=3",
            },
          ],
        },
        runtime_summary: {
          has_worker_fault: true,
          fault_class: "worker_stage_exhausted",
          convergence_class: "stalled",
          budget_lane: "degraded",
          retention_decision: "retain_evidence_bundle",
          blocked_reasons: [],
          observation_health: "ok",
          all_milestones_met: false,
          milestone_target_count: 2,
          completed_milestone_count: 1,
          current_instance_degraded: true,
        },
        routing_indexes: {
          module_id: "module_demo",
          refinement_task_id: taskId,
          worker_instance_id: `${taskId}_worker_2`,
          failure_chain_id: `failure_chain_${taskId}_3`,
        },
        evidence_bundle: {
          paths: ["observer_view.json", "work.md"],
          terminal_digest_path: "worker_terminal_digest.json",
          raw_log_index_path: "worker_raw_log_index.json",
          observer_view_path: "observer_view.json",
          attempt_count: 1,
          blocked_reason_count: 0,
        },
        core_ingress_hint: {
          re_refinement_candidate: true,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

beforeEach(() => {
  execFileSync(buildRolePermissionsScript, [], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_consume_observer_bridge integration", () => {
  it("queues planner replan from observer bridge packet and records consume summaries", async () => {
    const harness = await createHarness("task_demo_observer_bridge", "Build websocket calculator");
    await writeBridgePacket(harness.taskDir, harness.taskId);

    execFileSync(consumeObserverBridgeScript, [harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const intake = JSON.parse(await fs.readFile(harness.intakePath, "utf8")) as Record<string, unknown>;
    const log = await fs.readFile(harness.logPath, "utf8");
    const plan = await fs.readFile(harness.planPath, "utf8");
    const work = await fs.readFile(harness.workPath, "utf8");
    const observer = (meta.observer ?? {}) as Record<string, unknown>;
    const scheduler = (meta.scheduler ?? {}) as Record<string, unknown>;
    const bridge = (scheduler.escalation_bridge ?? {}) as Record<string, unknown>;

    expect(meta.planner_replan).toMatchObject({
      status: "queued",
      impact: "hard",
      worker_policy: "pause_and_require_replan",
      scope_summary: ["observer_bridge_execution_exhaustion"],
    });
    expect(meta.runtime_replan).toMatchObject({
      consume_status: "pending_consume",
      last_runtime_actor: "planner-observer-bridge-consume",
      last_runtime_transition: "observer_bridge->pending_consume",
      source_planner_policy: "pause_and_require_replan",
      source_planner_impact: "hard",
    });
    expect(meta.state).toBe("BLOCKED_AWAITING_CLARIFICATION");
    expect(intake).toMatchObject({
      schema_version: "observer-core-refinement-intake-v1",
      task_id: harness.taskId,
      request_id: "req_bridge_001",
      routing_indexes: {
        module_id: "module_demo",
        refinement_task_id: harness.taskId,
      },
    });
    expect(intake.fact_chain_key).toBe(`module_demo::${harness.taskId}::failure_chain_${harness.taskId}_3`);
    expect(observer.bridge_packet_path).toBe("observer_refinement_packet.json");
    expect(observer.bridge_last_request_id).toBe("req_bridge_001");
    expect(observer.bridge_last_consumed_request_id).toBe("req_bridge_001");
    expect(observer.bridge_last_consumed_fingerprint).toBe("fp_bridge_001");
    expect(bridge.last_consumed_request_id).toBe("req_bridge_001");
    expect(bridge.last_consumed_fingerprint).toBe("fp_bridge_001");
    expect(typeof bridge.last_consumed_at).toBe("string");
    expect(log).toContain("PLANNER_REPLAN_QUEUED_FROM_OBSERVER_BRIDGE");
    expect(plan).toContain("observer bridge queued planner replan candidate");
    expect(work).toContain("planner accepted observer bridge packet");
  });

  it("rejects raw scheduler escalation requests as planner authority input", async () => {
    const harness = await createHarness("task_demo_observer_bridge_reject", "Build websocket calculator");
    await fs.writeFile(
      harness.packetPath,
      `${JSON.stringify(
        {
          schema_version: "scheduler-escalation-request-v1",
          task_id: harness.taskId,
          request_id: "req_reject",
          bridge_fingerprint: "fp_reject",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(() =>
      execFileSync(consumeObserverBridgeScript, [harness.taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
        },
      }),
    ).toThrow(/observer core ingress rejects raw scheduler escalation requests/);
  });

  it("skips duplicate packets with the same request id and fingerprint", async () => {
    const harness = await createHarness("task_demo_observer_bridge_dedupe", "Build websocket calculator");
    await writeBridgePacket(harness.taskDir, harness.taskId, "req_dup_001", "fp_dup_001");

    const env = {
      ...process.env,
      AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
    };
    execFileSync(consumeObserverBridgeScript, [harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
    const firstMeta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const firstRequestedAt = String((firstMeta.planner_replan as Record<string, unknown>).requested_at);

    execFileSync(consumeObserverBridgeScript, [harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });

    const secondMeta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const log = await fs.readFile(harness.logPath, "utf8");
    const work = await fs.readFile(harness.workPath, "utf8");

    expect(String((secondMeta.planner_replan as Record<string, unknown>).requested_at)).toBe(firstRequestedAt);
    expect(log).toContain("PLANNER_REPLAN_OBSERVER_BRIDGE_SKIPPED_DUPLICATE");
    expect(work).toContain("planner skipped duplicate observer bridge packet");
  });
});
