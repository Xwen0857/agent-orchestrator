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
const plannerEntryScript = path.join(repoRoot, "agent-orchestrator", "scripts", "planner_entry.sh");
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-legacy-"));
  tempDirs.push(root);
  const tasksRoot = path.join(root, "task_folders");
  const stateRoot = path.join(root, "state");
  const strategyPath = path.join(root, `${taskId}.strategy.json`);
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

  return {
    root,
    stateRoot,
    taskDir,
    metaPath: path.join(taskDir, "meta.json"),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner legacy compatibility integration", () => {
  it("falls back to legacy agent_runtime planner_agent when planner_policy.json is absent", async () => {
    const harness = await createHarness("task_legacy_policy", "Build websocket calculator");
    const runtimePath = path.join(harness.root, "agent_runtime.json");
    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        planner_agent: {
          token_priority: {
            min_planning_tokens: 2400,
          },
        },
      }),
      "utf8",
    );

    execFileSync(plannerEntryScript, ["--task-dir", harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
        PLANNER_AGENT_RUNTIME_CONFIG: runtimePath,
        PLANNER_POLICY_CONFIG: path.join(harness.root, "missing-planner-policy.json"),
      },
    });

    const meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const requestEnvelope = JSON.parse(
      await fs.readFile(path.join(harness.taskDir, "planner_request.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        request_authority: "task_local_strategy_meta",
      }),
    );
    expect(requestEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-request-v1",
        policy: expect.objectContaining({
          policy_id: "planner_legacy_fallback",
        }),
      }),
    );
  });
});
