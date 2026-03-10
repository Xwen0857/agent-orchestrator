import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-entry-llm-"));
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
        constraints: ["python only"],
        deliverables: ["source", "tests"],
        notes: ["prefer local fixtures"],
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

async function readJson(targetPath: string) {
  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_entry llm policy integration", () => {
  it("treats LLM as primary and lets hard guardrails override unsafe single-mode output", async () => {
    const harness = await createHarness(
      "task_llm_guardrail",
      "Build websocket calculator across protocol core test doc",
    );
    const server = http.createServer((req, res) => {
      if (req.url === "/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    modules: [
                      {
                        title: "core_logic",
                        rationale: "llm kept a single functional boundary",
                      },
                    ],
                    reason: "llm proposed a single coarse boundary",
                  }),
                },
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const runtimePath = path.join(harness.root, "agent_runtime.json");
    await fs.writeFile(
      runtimePath,
      JSON.stringify({
        planner_agent: {
          llm_role: "primary",
          token_priority: {
            tier: "highest",
            reserved_ratio: 0.35,
            min_planning_tokens: 1200,
            max_planning_tokens: 6000,
            allow_inline_override: true,
          },
          mcp_soft_boundary: {
            mode: "bias_plan",
            include_namespace: true,
            include_read_only: true,
            include_profile_name: true,
            include_isolation_enabled: true,
          },
        },
        llm: {
          enabled: true,
          auth_mode: "auto",
          api_base_url: `http://127.0.0.1:${port}`,
          api_key: "test-key",
          api_key_env: "",
          model: "gpt-4.1-mini",
          temperature: 0.1,
          max_tokens: 500,
          timeout_ms: 20000,
          system_prompt: "Return JSON only.",
        },
      }),
      "utf8",
    );

    try {
      await execFileAsync(plannerEntryScript, ["--task-dir", harness.taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
          PLANNER_AGENT_RUNTIME_CONFIG: runtimePath,
        },
      });
    } finally {
      server.close();
    }

    const meta = await readJson(harness.metaPath);

    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        llm_role: "primary",
        llm_decision_used: true,
        agent_contract_version: "planner-core-v2",
        meta_decomposition: expect.objectContaining({
          primary_principle: "functional_decoupling",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
        }),
        worker_refinement: expect.objectContaining({
          primary_principle: "engineering_decoupling",
          refinement_scope: "multi_meta_input",
        }),
        granularity_guardrails: expect.objectContaining({
          guardrail_triggered: true,
        }),
      }),
    );
    expect(String((meta.planning_decision as Record<string, unknown>).decision_reason)).toContain(
      "hard guardrail",
    );
  });
});
