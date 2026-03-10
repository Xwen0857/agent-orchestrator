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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-amend-"));
  tempDirs.push(root);
  const tasksRoot = path.join(root, "task_folders");
  const strategyPath = path.join(root, `${taskId}.strategy.json`);
  const batchPath = path.join(root, `${taskId}.amendment.json`);
  const effectivePatchPath = path.join(root, `${taskId}.effective-patch.v2.json`);
  const watermarkPath = path.join(root, `${taskId}.watermark.v2.json`);
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
    },
  ).trim();

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
        task_goal_patch: {
          op: "set",
          value: "Build websocket calculator with audit trail",
        },
        constraints_patch: [
          {
            op: "append",
            value: "must emit audit logs",
          },
        ],
        deliverables_patch: [
          {
            op: "append",
            value: "RUNBOOK.md",
          },
        ],
        notes_patch: [
          {
            op: "append",
            value: "note: user requested auditability",
          },
        ],
        workspace_patch: {
          op: "set",
          value: "workspace-root: apps/demo-v2",
        },
        budget_patch: {
          op: "set",
          value: "budget: 1200,90",
        },
      },
    }),
    "utf8",
  );

  await fs.writeFile(
    effectivePatchPath,
    JSON.stringify({
      schema_version: "planner-effective-patch-v2",
      session_key: "sess_demo",
      task_id: taskId,
      compiled_at: "2026-03-02T00:10:01Z",
      compiled_from_versions: {
        from_version: 1,
        to_version: 2,
      },
      effective_patch: {
        task_goal_patch: {
          op: "set",
          value: "Build websocket calculator with audit trail",
        },
        constraints_patch: [
          {
            op: "append",
            value: "must emit audit logs",
          },
        ],
        deliverables_patch: [
          {
            op: "append",
            value: "RUNBOOK.md",
          },
        ],
        notes_patch: [
          {
            op: "append",
            value: "note: user requested auditability",
          },
        ],
        workspace_patch: {
          op: "set",
          value: "workspace-root: apps/demo-v2",
        },
        budget_patch: {
          op: "set",
          value: "budget: 1200,90",
        },
      },
      source_versions: {
        goal: [1],
        constraints: [2],
        deliverables: [2],
        notes: [2],
        workspace: [1],
        budget: [1],
      },
      dedupe_basis: {
        goal: "last_write_wins",
        constraints: "set_union_minus_remove",
        deliverables: "set_union_minus_remove",
        notes: "dedupe_append",
        workspace: "last_valid_set",
        budget: "last_valid_set",
      },
      conflicts: [],
    }),
    "utf8",
  );
  await fs.writeFile(
    watermarkPath,
    JSON.stringify({
      schema_version: "planner-amendment-watermark-v2",
      session_key: "sess_demo",
      task_id: taskId,
      head_version: 2,
      applying_version: 2,
      consumed_version: 0,
      last_release_reason: "manual_flush",
      updated_at: "2026-03-02T00:10:01Z",
    }),
    "utf8",
  );

  return {
    taskId,
    taskDir,
    strategyCopyPath: path.join(taskDir, `${taskId}.strategy.json`),
    metaPath: path.join(taskDir, "meta.json"),
    logPath: path.join(taskDir, "log.ndjson"),
    batchPath,
    effectivePatchPath,
    watermarkPath,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_apply_amendment_batch integration", () => {
  it("merges batch changes into planner-facing task inputs and records an event", async () => {
    const harness = await createHarness("task_demo_amend", "Build websocket calculator");

    execFileSync(
      applyBatchScript,
      [
        "--task-dir",
        harness.taskDir,
        "--batch",
        harness.batchPath,
        "--effective-patch",
        harness.effectivePatchPath,
        "--expected-applying-version",
        "2",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const strategy = JSON.parse(await fs.readFile(harness.strategyCopyPath, "utf8")) as Record<string, unknown>;
    const meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const watermark = JSON.parse(await fs.readFile(harness.watermarkPath, "utf8")) as Record<string, unknown>;
    const log = await fs.readFile(harness.logPath, "utf8");
    const summaryInput = strategy.summary_input as Record<string, unknown>;
    const workspace = strategy.workspace as Record<string, unknown>;

    expect(strategy.goal).toBe("Build websocket calculator with audit trail");
    expect(summaryInput.task_goal).toBe("Build websocket calculator with audit trail");
    expect(summaryInput.constraints).toEqual(["python only", "must emit audit logs"]);
    expect(summaryInput.deliverables).toEqual(["source", "RUNBOOK.md"]);
    expect(summaryInput.notes).toEqual(["prefer local fixtures", "note: user requested auditability"]);
    expect(workspace.workspace_root).toBe("apps/demo-v2");
    expect((strategy.budget as Record<string, unknown>).max_token_cost).toBe(1200);
    expect(meta.workspace_root_hint).toBe("apps/demo-v2");
    expect(meta.planner_replan).toMatchObject({
      status: "queued",
      impact: "hard",
      worker_policy: "pause_and_require_replan",
      latest_amendment_batch_path: expect.stringContaining(path.basename(harness.batchPath)),
      latest_effective_patch_path: expect.stringContaining(path.basename(harness.effectivePatchPath)),
    });
    expect(meta.runtime_replan).toBeUndefined();
    expect(watermark.applying_version).toBe(2);
    expect(watermark.consumed_version).toBe(2);
    expect(log).toContain("PLANNER_AMENDMENT_BATCH_APPLIED");
  });

  it("accepts effective-patch-only mode without batch input", async () => {
    const harness = await createHarness("task_demo_effective_only", "Build websocket calculator");

    execFileSync(
      applyBatchScript,
      [
        "--task-dir",
        harness.taskDir,
        "--effective-patch",
        harness.effectivePatchPath,
        "--expected-applying-version",
        "2",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const strategy = JSON.parse(await fs.readFile(harness.strategyCopyPath, "utf8")) as Record<string, unknown>;
    const watermark = JSON.parse(await fs.readFile(harness.watermarkPath, "utf8")) as Record<string, unknown>;
    const meta = JSON.parse(await fs.readFile(harness.metaPath, "utf8")) as Record<string, unknown>;
    const summaryInput = strategy.summary_input as Record<string, unknown>;

    expect(summaryInput.task_goal).toBe("Build websocket calculator with audit trail");
    expect((meta.planner_replan as Record<string, unknown> | undefined)?.latest_amendment_batch_path).toBeUndefined();
    expect(String((meta.planner_replan as Record<string, unknown>).latest_effective_patch_path)).toContain(
      path.basename(harness.effectivePatchPath),
    );
    expect(watermark.applying_version).toBe(2);
    expect(watermark.consumed_version).toBe(2);
  });
});
