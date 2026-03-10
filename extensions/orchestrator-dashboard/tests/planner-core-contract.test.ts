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

async function createHarness(params: {
  taskId: string;
  goal: string;
  deliverables?: string[];
  constraints?: string[];
  notes?: string[];
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-core-contract-"));
  tempDirs.push(root);
  const tasksRoot = path.join(root, "task_folders");
  const stateRoot = path.join(root, "state");
  const strategyPath = path.join(root, `${params.taskId}.strategy.json`);
  await fs.mkdir(tasksRoot, { recursive: true });
  await fs.cp(templateDir, path.join(tasksRoot, "_task_id_"), { recursive: true });
  await fs.writeFile(
    strategyPath,
    JSON.stringify({
      task_id: params.taskId,
      title: params.goal,
      goal: params.goal,
      owner: "planner-core",
      risk_level: "MEDIUM",
      budget: {
        max_token_cost: 50000,
        max_execution_time_seconds: 3600,
      },
      summary_input: {
        task_goal: params.goal,
        constraints: params.constraints ?? ["python only"],
        deliverables: params.deliverables ?? ["source", "tests"],
        notes: params.notes ?? ["prefer local fixtures"],
      },
      created_at: "2026-03-02T00:00:00Z",
      status: "drafted",
      source: {
        channel: "cli",
        sender_id: "tester",
        session_key: "sess_demo",
        message_thread_id: null,
      },
      raw_request: params.goal,
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
    stateRoot,
    taskDir,
    tasksRoot,
    metaPath: path.join(taskDir, "meta.json"),
  };
}

async function readJson(targetPath: string) {
  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
}

function runPlanner(taskDir: string, stateRoot: string) {
  execFileSync(plannerEntryScript, ["--task-dir", taskDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_ORCHESTRATOR_STATE_DIR: stateRoot,
    },
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner-core contract", () => {
  it("keeps bounded tasks on single-meta input under auto mode", async () => {
    const harness = await createHarness({
      taskId: "task_contract_single",
      goal: "Build websocket calculator",
      deliverables: ["source"],
    });

    runPlanner(harness.taskDir, harness.stateRoot);

    const meta = await readJson(harness.metaPath);

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        request_authority: "task_local_strategy_meta",
        meta_decomposition: expect.objectContaining({
          primary_principle: "functional_decoupling",
          decomposition_strategy: "meta_single_unit",
          meta_unit_count: 1,
        }),
        worker_refinement: expect.objectContaining({
          primary_principle: "engineering_decoupling",
          refinement_scope: "single_meta_input",
        }),
      }),
    );
    expect(meta.children ?? []).toEqual([]);
  });

  it("forces initial split under auto mode when strong multi signals exist", async () => {
    const harness = await createHarness({
      taskId: "task_contract_multi",
      goal: "Build websocket calculator",
    });

    runPlanner(harness.taskDir, harness.stateRoot);

    const meta = await readJson(harness.metaPath);

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        request_authority: "task_local_strategy_meta",
        meta_decomposition: expect.objectContaining({
          primary_principle: "functional_decoupling",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
        }),
        worker_refinement: expect.objectContaining({
          primary_principle: "engineering_decoupling",
          refinement_scope: "multi_meta_input",
        }),
      }),
    );
    expect(Array.isArray(meta.children)).toBe(true);
    expect((meta.children as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("uses fallback planning only in auto mode", async () => {
    const harness = await createHarness({
      taskId: "task_contract_auto",
      goal: "Build websocket calculator",
    });

    runPlanner(harness.taskDir, harness.stateRoot);

    const meta = await readJson(harness.metaPath);

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        request_authority: "task_local_strategy_meta",
        meta_decomposition: expect.objectContaining({
          primary_principle: "functional_decoupling",
        }),
        worker_refinement: expect.objectContaining({
          primary_principle: "engineering_decoupling",
        }),
      }),
    );
  });

  it("treats task-local strategy and child-task meta as planner authority inputs", async () => {
    const harness = await createHarness({
      taskId: "task_contract_child",
      goal: "Build protocol core test doc split parallel platform",
    });
    const parentSeed = {
      ...(await readJson(harness.metaPath)),
      parent_task_id: "task_parent_demo",
    };
    await fs.writeFile(harness.metaPath, JSON.stringify(parentSeed, null, 2), "utf8");

    runPlanner(harness.taskDir, harness.stateRoot);

    const meta = await readJson(harness.metaPath);

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        request_authority: "task_local_strategy_meta",
        meta_decomposition: expect.objectContaining({
          primary_principle: "functional_decoupling",
          decomposition_strategy: "meta_single_unit",
          meta_unit_count: 1,
        }),
        worker_refinement: expect.objectContaining({
          primary_principle: "engineering_decoupling",
          refinement_scope: "single_meta_input",
        }),
      }),
    );
    expect(String((meta.planning_decision as Record<string, unknown>).decision_reason)).toContain(
      "child task forced single",
    );
  });
});
