import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const createTaskScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "create_task_from_strategy.sh",
);
const applyBatchScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "planner_apply_amendment_batch.sh",
);
const consumeReplanScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "planner_consume_replan_queue.sh",
);
const orchestrateOnceScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "orchestrate_once.sh",
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrate-replan-"));
  tempDirs.push(root);
  const tasksRoot = path.join(root, "task_folders");
  const stateRoot = path.join(root, "state");
  const strategyPath = path.join(root, `${taskId}.strategy.json`);
  const batchPath = path.join(root, `${taskId}.amendment.json`);
  await fs.mkdir(tasksRoot, { recursive: true });
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
  meta.state = "ASSIGNED";
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  await fs.writeFile(
    batchPath,
    JSON.stringify({
      schema_version: "planner-amendment-batch-v1",
      session_key: "sess_demo",
      task_id: taskId,
      created_at: "2026-03-02T00:10:00Z",
      from_window: {
        started_at: "2026-03-02T00:09:30Z",
        ended_at: "2026-03-02T00:10:00Z",
      },
      merged_changes: {
        task_goal_patch: null,
        constraints_patch: [],
        deliverables_patch: [],
        notes_patch: [],
        workspace_patch: {
          op: "set",
          value: "workspace-root: apps/demo-v2",
        },
        budget_patch: null,
      },
    }),
    "utf8",
  );

  return {
    taskDir,
    tasksRoot,
    stateRoot,
    taskId,
    metaPath,
    workPath: path.join(taskDir, "work.md"),
    batchPath,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("orchestrate_once replan policy", () => {
  it("spends one tick revalidating refresh-required amendments before resuming execution", async () => {
    const harness = await createHarness("task_demo_refresh", "Build websocket calculator");

    const env = {
      ...process.env,
      AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
    };

    execFileSync(
      applyBatchScript,
      ["--task-dir", harness.taskDir, "--batch", harness.batchPath],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    execFileSync(consumeReplanScript, [harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });

    let meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    expect((meta.planner_replan as Record<string, unknown>).worker_policy).toBe("revalidate_then_resume");
    expect((meta.runtime_replan as Record<string, unknown>).consume_status).toBe("awaiting_revalidation");

    execFileSync(
      orchestrateOnceScript,
      [harness.tasksRoot, "--task-id", harness.taskId],
      { cwd: repoRoot, encoding: "utf8", env },
    );

    meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const work = await fs.readFile(harness.workPath, "utf8");

    expect(meta.state).toBe("ASSIGNED");
    expect((meta.runtime_replan as Record<string, unknown>).consume_status).toBe("ready");
    expect(meta.workspace_last_sync_reason).toBe("receptionist_amendment_batch_revalidated");
    expect(meta.dirty_state).toBe(false);
    expect(work).toContain("planner revalidated amended inputs before resume");
  });
});
