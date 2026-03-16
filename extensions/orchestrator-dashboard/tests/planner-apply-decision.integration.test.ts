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
const plannerApplyScript = path.join(
  repoRoot,
  "agent-orchestrator",
  "scripts",
  "planner_apply_decision.sh",
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-apply-"));
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
    stateRoot,
    taskDir,
    tasksRoot,
    metaPath: path.join(taskDir, "meta.json"),
  };
}

async function readJson(targetPath: string) {
  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_apply_decision integration", () => {
  it("applies a single-meta-input refinement path when initial partition contains one unit", async () => {
    const harness = await createHarness("task_apply_single", "Build websocket calculator");
    const decisionJson = JSON.stringify({
      schema_version: "planner-decision-v1",
      decision_id: "planner_decision_task_apply_single",
      request_id: "planner_request_task_apply_single",
      task_id: "task_apply_single",
      planner_decision: {
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        decision_source: "planner_rules_fallback",
        decision_reason: "single-task default",
        decision_signals: {},
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_single_unit",
          meta_unit_count: 1,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "low",
          decoupling_rationale: ["no strong functional boundary detected"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "single_meta_input",
          primary_principle: "engineering_decoupling",
        },
        granularity_guardrails: {
          guardrail_triggered: false,
          guardrail_notes: [],
        },
        token_priority_context: { effective_planning_tokens: 1200 },
        mcp_soft_boundary_signals: { mode: "bias_plan" },
      },
      initial_partition: {
        strategy: "meta_single_unit",
        modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
      },
      apply_contract: {
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "single_meta_input",
        },
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
      },
      execution_target: "local_threads",
    });

    execFileSync(plannerApplyScript, [harness.taskDir, decisionJson, "worker_demo", "op_demo"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const decisionEnvelope = await readJson(path.join(harness.taskDir, "planner_decision.json"));
    const splitPlan = await readJson(path.join(harness.taskDir, "split_plan.json"));
    const log = await fs.readFile(path.join(harness.taskDir, "log.ndjson"), "utf8");
    const entries = await fs.readdir(harness.tasksRoot);
    const childIds = entries.filter((name) => name.startsWith("task_apply_single_c"));

    expect(meta.children ?? []).toEqual([]);
    expect(decisionEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-decision-v1",
        task_id: "task_apply_single",
      }),
    );
    expect(splitPlan).toEqual(
      expect.objectContaining({
        initial_partition: expect.objectContaining({
          strategy: "meta_single_unit",
        }),
        refinement_partition: expect.objectContaining({
          input_scope: "single_meta_input",
        }),
      }),
    );
    expect(childIds).toEqual([]);
    expect(log).toContain("meta_units=1");
    expect(log).toContain("initial_partition_strategy=meta_single_unit");
    expect(log).toContain("refinement_scope=single_meta_input");
    expect(log).toContain("guardrail_triggered=false");
    const dependencySummary = (
      splitPlan.refinement_partition as { dependency_summary?: Record<string, unknown> } | undefined
    )?.dependency_summary ?? {};
    expect(log).toContain(`dependency_roots=${String(dependencySummary.roots ?? 1)}`);
    expect(log).toContain(`dependency_blocked=${String(dependencySummary.blocked ?? 0)}`);
  });

  it("applies a multi-meta-input refinement path when initial partition contains multiple units", async () => {
    const harness = await createHarness(
      "task_apply_multi",
      "Build websocket calculator across protocol core test doc",
    );
    const decisionJson = JSON.stringify({
      decomposition_strategy: "module_first",
      release_policy: "rolling_followup",
      decision_source: "planner_rules_fallback",
      decision_reason: "strong multi decomposition",
      decision_signals: {},
      meta_decomposition: {
        decision_source: "planner_rules_fallback",
        decomposition_strategy: "meta_module_partition",
        meta_unit_count: 2,
        primary_principle: "functional_decoupling",
        decoupling_confidence: "high",
        decoupling_rationale: ["protocol boundary", "core boundary"],
      },
      worker_refinement: {
        required: true,
        refinement_strategy: "linear_split_units_placeholder",
        refinement_scope: "multi_meta_input",
        primary_principle: "engineering_decoupling",
      },
      granularity_guardrails: {
        guardrail_triggered: true,
        guardrail_notes: ["trimmed to max meta units"],
      },
      llm_role: "primary",
      llm_decision_used: true,
      token_priority_context: {
        tier: "highest",
        reserved_ratio: 0.35,
        min_planning_tokens: 1200,
        max_planning_tokens: 6000,
        inline_override_applied: true,
        effective_planning_tokens: 2400,
      },
      mcp_soft_boundary_signals: {
        mode: "bias_plan",
        isolation_enabled: true,
      },
      schema_version: "planner-decision-v1",
      decision_id: "planner_decision_task_apply_multi",
      request_id: "planner_request_task_apply_multi",
      task_id: "task_apply_multi",
      planner_decision: {
        decomposition_strategy: "module_first",
        release_policy: "rolling_followup",
        decision_source: "planner_rules_fallback",
        decision_reason: "strong multi decomposition",
        decision_signals: {},
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "high",
          decoupling_rationale: ["protocol boundary", "core boundary"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
        },
        llm_role: "primary",
        llm_decision_used: true,
        granularity_guardrails: {
          guardrail_triggered: true,
          guardrail_notes: ["trimmed to max meta units"],
        },
        token_priority_context: {
          tier: "highest",
          reserved_ratio: 0.35,
          min_planning_tokens: 1200,
          max_planning_tokens: 6000,
          inline_override_applied: true,
          effective_planning_tokens: 2400,
        },
        mcp_soft_boundary_signals: {
          mode: "bias_plan",
          isolation_enabled: true,
        },
        agent_contract_version: "planner-core-v2",
      },
      initial_partition: {
        strategy: "meta_module_partition",
        modules: [
          { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
          { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
        ],
      },
      apply_contract: {
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [
            { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
            { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
          ],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
        },
        decomposition_strategy: "module_first",
        release_policy: "rolling_followup",
      },
      execution_target: "local_threads",
    });

    execFileSync(plannerApplyScript, [harness.taskDir, decisionJson, "worker_demo", "op_demo"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const splitPlan = await readJson(path.join(harness.taskDir, "split_plan.json"));
    const log = await fs.readFile(path.join(harness.taskDir, "log.ndjson"), "utf8");

    expect(Array.isArray(meta.children)).toBe(true);
    expect((meta.children as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(splitPlan.decomposition_strategy).toBe("module_first");
    expect(splitPlan.release_policy).toBe("rolling_followup");
    expect(splitPlan.decision_context).toEqual(
      expect.objectContaining({
        llm_role: "primary",
        llm_decision_used: true,
        meta_decomposition: expect.objectContaining({
          meta_unit_count: 2,
        }),
        worker_refinement: expect.objectContaining({
          refinement_scope: "multi_meta_input",
        }),
        granularity_guardrails: expect.objectContaining({
          guardrail_triggered: true,
        }),
        agent_contract_version: "planner-core-v2",
      }),
    );
    expect(splitPlan.initial_partition).toEqual(
      expect.objectContaining({ strategy: "meta_module_partition" }),
    );
    expect(splitPlan.refinement_partition).toEqual(
      expect.objectContaining({ input_scope: "multi_meta_input" }),
    );
    expect(log).toContain("meta_units=2");
    expect(log).toContain("initial_partition_strategy=meta_module_partition");
    expect(log).toContain("refinement_scope=multi_meta_input");
    expect(log).toContain("guardrail_triggered=true");
    const dependencySummary = (
      splitPlan.refinement_partition as { dependency_summary?: Record<string, unknown> } | undefined
    )?.dependency_summary ?? {};
    expect(log).toContain(`dependency_roots=${String(dependencySummary.roots ?? "")}`);
    expect(log).toContain(`dependency_blocked=${String(dependencySummary.blocked ?? "")}`);
  });

  it("rejects bare planner decision payloads that do not provide an envelope", async () => {
    const harness = await createHarness("task_apply_legacy", "Build websocket calculator");
    const decisionJson = JSON.stringify({
      decomposition_strategy: "single_path",
      release_policy: "immediate_first_wave",
      decision_source: "manual_override",
      decision_reason: "manual",
      decision_signals: {},
    });
    let combinedOutput = "";
    try {
      execFileSync(plannerApplyScript, [harness.taskDir, decisionJson, "worker_demo", "op_demo"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
        },
      });
    } catch (error) {
      const stderr =
        error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "")
          : "";
      const stdout =
        error && typeof error === "object" && "stdout" in error
          ? String((error as { stdout?: unknown }).stdout ?? "")
          : "";
      combinedOutput = `${stdout}${stderr}`;
    }

    expect(combinedOutput).toContain("planner_apply_decision now requires planner-decision envelope");
  });
});
