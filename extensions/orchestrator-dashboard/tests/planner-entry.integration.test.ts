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
const dependencyDefaultsPath = path.join(
  repoRoot,
  "templates",
  "coordination",
  "orchestrator",
  "planner_dependency_defaults.json",
);
const dependencySemanticsPath = path.join(
  repoRoot,
  "templates",
  "coordination",
  "orchestrator",
  "planner_dependency_semantics.json",
);

const tempDirs: string[] = [];

async function createHarness(
  taskId: string,
  goal: string,
  options: { deliverables?: string[]; constraints?: string[]; notes?: string[] } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-entry-"));
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
        constraints: options.constraints ?? ["python only"],
        deliverables: options.deliverables ?? ["source", "tests"],
        notes: options.notes ?? ["prefer local fixtures"],
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
    tasksRoot,
    stateRoot,
    taskDir,
    metaPath: path.join(taskDir, "meta.json"),
    strategyCopyPath: path.join(taskDir, `${taskId}.strategy.json`),
    plannerPrimaryPath: path.join(stateRoot, "planner", "primary.md"),
    plannerChecklistPath: path.join(stateRoot, "planner", "checklist.md"),
    workerTasksDir: path.join(stateRoot, "tasks", "worker_tasks"),
  };
}

async function readJson(targetPath: string) {
  return JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
}

async function readDependencyConfig() {
  return {
    defaults: (await readJson(dependencyDefaultsPath)) as {
      summary_note: string;
    },
    semantics: (await readJson(dependencySemanticsPath)) as {
      dependency_mode: string;
    },
  };
}

function computeSummaryFromLeafUnits(
  leafUnits: Array<Record<string, unknown>>,
): { roots: number; blocked: number; links: number; cross_module_links: number } {
  const links = leafUnits.reduce((sum, leaf) => {
    return sum + (Array.isArray(leaf.depends_on_leaf_ids) ? leaf.depends_on_leaf_ids.length : 0);
  }, 0);
  const roots = leafUnits.filter((leaf) => {
    return Array.isArray(leaf.depends_on_leaf_ids) && leaf.depends_on_leaf_ids.length === 0;
  }).length;
  const blocked = leafUnits.filter((leaf) => {
    return Array.isArray(leaf.depends_on_leaf_ids) && leaf.depends_on_leaf_ids.length > 0;
  }).length;
  const byLeafId = new Map<string, Record<string, unknown>>(
    leafUnits
      .filter((leaf) => typeof leaf.leaf_id === "string" && String(leaf.leaf_id).trim().length > 0)
      .map((leaf) => [String(leaf.leaf_id), leaf] as const),
  );
  const crossModuleLinks = leafUnits.reduce((sum, leaf) => {
    const currentModule = String(leaf.module_id ?? "");
    if (!Array.isArray(leaf.depends_on_leaf_ids) || !currentModule) {
      return sum;
    }
    return (
      sum +
      leaf.depends_on_leaf_ids.reduce((inner, dependencyLeafId) => {
        const dependency = byLeafId.get(String(dependencyLeafId));
        if (!dependency) {
          return inner;
        }
        return String(dependency.module_id ?? "") !== currentModule ? inner + 1 : inner;
      }, 0)
    );
  }, 0);
  return { roots, blocked, links, cross_module_links: crossModuleLinks };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_entry integration", () => {
  it("always emits a single-unit initial partition for bounded planning inputs", async () => {
    const harness = await createHarness("task_demo_single", "Build websocket calculator", {
      deliverables: ["source"],
    });

    execFileSync(plannerEntryScript, ["--task-dir", harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const requestEnvelope = await readJson(path.join(harness.taskDir, "planner_request.json"));
    const decisionEnvelope = await readJson(path.join(harness.taskDir, "planner_decision.json"));
    const splitPlan = await readJson(path.join(harness.taskDir, "split_plan.json"));
    const dependencyConfig = await readDependencyConfig();
    const taskPlan = await fs.readFile(path.join(harness.taskDir, "plan.md"), "utf8");
    const plannerPrimary = await fs.readFile(harness.plannerPrimaryPath, "utf8");
    const plannerChecklist = await fs.readFile(harness.plannerChecklistPath, "utf8");
    const log = await fs.readFile(path.join(harness.taskDir, "log.ndjson"), "utf8");

    expect(requestEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-request-v1",
        policy: expect.objectContaining({
          schema_version: "planner-policy-v1",
        }),
        runtime_context: expect.objectContaining({
          execution_target: "local_threads",
        }),
      }),
    );
    expect(decisionEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-decision-v1",
        task_id: "task_demo_single",
        execution_target: "local_threads",
        initial_partition: expect.objectContaining({
          strategy: "meta_single_unit",
          modules: [expect.objectContaining({ module_id: "meta_unit_001" })],
        }),
        apply_contract: expect.objectContaining({
          initial_partition: expect.objectContaining({
            strategy: "meta_single_unit",
          }),
          worker_refinement: expect.objectContaining({
            required: true,
            refinement_strategy: "linear_split_units_placeholder",
            refinement_scope: "single_meta_input",
            component_candidates: ["root_meta_unit_implementation"],
          }),
        }),
      }),
    );
    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        planner_phase: "initial_plan",
        request_authority: "task_local_strategy_meta",
        llm_role: "primary",
        llm_decision_used: false,
        agent_contract_version: "planner-core-v2",
        token_priority_context: expect.objectContaining({
          tier: "highest",
          effective_planning_tokens: expect.any(Number),
        }),
        mcp_soft_boundary_signals: expect.objectContaining({
          mode: "bias_plan",
        }),
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_single_unit",
          meta_unit_count: 1,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "low",
          decoupling_rationale: ["no strong functional boundary detected"],
        },
        worker_refinement: expect.objectContaining({
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "single_meta_input",
          primary_principle: "engineering_decoupling",
          component_candidates: ["root_meta_unit_implementation"],
          refinement_rationale: expect.arrayContaining([expect.any(String)]),
        }),
        granularity_guardrails: {
          mode: "soft",
          fragment_upper_bound: {
            max_meta_units: 4,
            max_leaf_units_per_meta: 8,
          },
          fragment_lower_bound: {
            min_meaningful_meta_units: 1,
            min_meaningful_leaf_scope: "component_sized",
          },
          guardrail_triggered: false,
          guardrail_notes: [],
        },
      }),
    );
    expect(splitPlan).toEqual(
      expect.objectContaining({
        initial_partition: expect.objectContaining({
          strategy: "meta_single_unit",
          modules: [expect.objectContaining({ module_id: "meta_unit_001" })],
        }),
        refinement_partition: expect.objectContaining({
          strategy: "linear_split_units_placeholder",
          input_scope: "single_meta_input",
          component_candidates: ["root_meta_unit_implementation"],
        }),
      }),
    );
    expect(splitPlan.refinement_partition).toEqual(
      expect.objectContaining({
        leaf_units: [
          expect.objectContaining({
            leaf_id: "leaf_1",
            module_id: "meta_unit_001",
            module_title: "root_meta_unit",
            component_candidate: "root_meta_unit_implementation",
            depends_on_component_candidates: [],
            depends_on_leaf_ids: [],
          }),
        ],
      }),
    );
    const singleDependencySummary = (
      splitPlan.refinement_partition as { dependency_summary?: Record<string, unknown> } | undefined
    )?.dependency_summary ?? {};
    expect(singleDependencySummary.mode).toBe(dependencyConfig.semantics.dependency_mode);
    expect(singleDependencySummary.note).toBe(dependencyConfig.defaults.summary_note);
    expect(singleDependencySummary).toEqual(
      expect.objectContaining({
        roots: 1,
        blocked: 0,
        links: 0,
        cross_module_links: 0,
      }),
    );
    expect(meta.execution_roles).toEqual(
      expect.objectContaining({
        planning_actor: "planner-core",
        scheduling_actor: "scheduler-ops",
      }),
    );
    expect(taskPlan).toContain("- Constraints: single-worker deterministic pipeline");
    expect(plannerPrimary).toContain("Build websocket calculator");
    expect(plannerPrimary).toContain("Constraints: python only");
    expect(plannerChecklist).toContain("code+test prepared");
    expect(log).toContain("PLANNER_MODE_DECIDED");
    expect(log).toContain("PLANNER_SINGLE_PREPARED");
  });

  it("always emits a multi-unit initial partition for strong multi-module signals", async () => {
    const harness = await createHarness(
      "task_demo_multi",
      "Build websocket calculator across protocol core test doc",
    );

    execFileSync(plannerEntryScript, ["--task-dir", harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const requestEnvelope = await readJson(path.join(harness.taskDir, "planner_request.json"));
    const decisionEnvelope = await readJson(path.join(harness.taskDir, "planner_decision.json"));
    const splitPlan = await readJson(path.join(harness.taskDir, "split_plan.json"));
    const dependencyConfig = await readDependencyConfig();
    const log = await fs.readFile(path.join(harness.taskDir, "log.ndjson"), "utf8");
    const entries = await fs.readdir(harness.tasksRoot);
    const childIds = entries.filter((name) => name.startsWith("task_demo_multi_c"));
    const firstChildStrategy = await readJson(
      path.join(harness.tasksRoot, childIds[0]!, `${childIds[0]}.strategy.json`),
    );

    expect(requestEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-request-v1",
        task: expect.objectContaining({
          task_id: "task_demo_multi",
        }),
      }),
    );
    expect(decisionEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-decision-v1",
        task_id: "task_demo_multi",
        execution_target: "local_threads",
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
          modules: [
            expect.objectContaining({ module_id: "meta_unit_001" }),
            expect.objectContaining({ module_id: "meta_unit_002" }),
          ],
        }),
        apply_contract: expect.objectContaining({
          initial_partition: expect.objectContaining({
            strategy: "meta_module_partition",
          }),
          worker_refinement: expect.objectContaining({
            required: true,
            refinement_strategy: "linear_split_units_placeholder",
            refinement_scope: "multi_meta_input",
            component_candidates: expect.arrayContaining([expect.any(String)]),
          }),
          decomposition_strategy: "module_first",
        }),
      }),
    );
    expect(decisionEnvelope.planner_decision).toEqual(meta.planning_decision);
    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        planner_phase: "initial_plan",
        request_authority: "task_local_strategy_meta",
        llm_role: "primary",
        llm_decision_used: false,
        agent_contract_version: "planner-core-v2",
        token_priority_context: expect.objectContaining({
          tier: "highest",
          effective_planning_tokens: expect.any(Number),
        }),
        mcp_soft_boundary_signals: expect.objectContaining({
          mode: "bias_plan",
        }),
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "high",
          decoupling_rationale: expect.arrayContaining([expect.any(String)]),
        },
        worker_refinement: expect.objectContaining({
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
          component_candidates: expect.arrayContaining([expect.any(String)]),
          refinement_rationale: expect.arrayContaining([expect.any(String)]),
        }),
        granularity_guardrails: expect.objectContaining({
          mode: "soft",
        }),
      }),
    );
    expect(Array.isArray(meta.children)).toBe(true);
    expect((meta.children as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(Number(meta.split_units_planned ?? 0)).toBeGreaterThanOrEqual(2);
    expect(splitPlan).toEqual(
      expect.objectContaining({
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
          modules: [
            expect.objectContaining({ module_id: "meta_unit_001" }),
            expect.objectContaining({ module_id: "meta_unit_002" }),
          ],
        }),
        refinement_partition: expect.objectContaining({
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          component_candidates: expect.arrayContaining([expect.any(String)]),
        }),
      }),
    );
    expect(
      Array.isArray(
        (splitPlan.refinement_partition as { leaf_units?: unknown[] } | undefined)?.leaf_units,
      ),
    ).toBe(true);
    const multiLeafUnits = (
      (splitPlan.refinement_partition as { leaf_units?: Array<Record<string, unknown>> } | undefined)
        ?.leaf_units ?? []
    ) as Array<Record<string, unknown>>;
    expect(multiLeafUnits.length).toBeGreaterThanOrEqual(2);
    expect(multiLeafUnits[0]).toEqual(
      expect.objectContaining({
        leaf_id: "leaf_1",
        module_id: "meta_unit_001",
        module_title: expect.any(String),
        component_candidate: expect.any(String),
        depends_on_component_candidates: [],
        depends_on_leaf_ids: [],
      }),
    );
    expect(multiLeafUnits[1]).toEqual(
      expect.objectContaining({
        leaf_id: "leaf_2",
        module_id: "meta_unit_002",
        module_title: expect.any(String),
        component_candidate: expect.any(String),
        depends_on_component_candidates: expect.any(Array),
        depends_on_leaf_ids: expect.any(Array),
      }),
    );
    expect(multiLeafUnits.some((leaf) => Array.isArray(leaf.depends_on_leaf_ids) && leaf.depends_on_leaf_ids.length > 0)).toBe(true);
    const multiDependencySummary = (
      splitPlan.refinement_partition as { dependency_summary?: Record<string, unknown> } | undefined
    )?.dependency_summary ?? {};
    expect(multiDependencySummary.mode).toBe(dependencyConfig.semantics.dependency_mode);
    expect(multiDependencySummary.note).toBe(dependencyConfig.defaults.summary_note);
    expect(multiDependencySummary).toEqual(
      expect.objectContaining(computeSummaryFromLeafUnits(multiLeafUnits)),
    );
    for (const leaf of multiLeafUnits) {
      const dependencyComponents = Array.isArray(leaf.depends_on_component_candidates)
        ? (leaf.depends_on_component_candidates as string[])
        : [];
      if (dependencyComponents.length === 0) {
        continue;
      }
      const sequence = Number(leaf.sequence ?? 0);
      const upstream = multiLeafUnits.filter((candidate) => Number(candidate.sequence ?? 0) < sequence);
      for (const dependencyComponent of dependencyComponents) {
        expect(
          upstream.some((candidate) => candidate.component_candidate === dependencyComponent),
        ).toBe(true);
      }
    }
    expect(log).toContain("PLANNER_MULTI_PREPARED");
    expect(childIds.length).toBeGreaterThanOrEqual(2);
    expect(firstChildStrategy.goal).toBe("Build websocket calculator across protocol core test doc (subtask 1/2)");
    expect(String(firstChildStrategy.goal)).not.toContain("Constraints:");
  });

  it("uses summary context to infer functional boundaries beyond the raw goal text", async () => {
    const harness = await createHarness("task_demo_summary_context", "Build websocket calculator", {
      deliverables: ["source", "tests", "docs"],
      notes: ["prepare runbook and verification workflow"],
    });

    execFileSync(plannerEntryScript, ["--task-dir", harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const decisionEnvelope = await readJson(path.join(harness.taskDir, "planner_decision.json"));

    expect(decisionEnvelope).toEqual(
      expect.objectContaining({
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
          modules: expect.arrayContaining([
            expect.objectContaining({ module_title: "test_harness" }),
            expect.objectContaining({ module_title: "docs_rollout" }),
          ]),
        }),
      }),
    );
    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        meta_decomposition: expect.objectContaining({
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          decoupling_rationale: expect.arrayContaining([
            "deliverables require a standalone verification boundary",
            "deliverables include standalone documentation and rollout guidance",
          ]),
        }),
        worker_refinement: expect.objectContaining({
          refinement_scope: "multi_meta_input",
        }),
      }),
    );
  });

  it("keeps planner-agent context while always emitting an initial partition", async () => {
    const harness = await createHarness("task_demo_auto", "Build websocket calculator");

    execFileSync(plannerEntryScript, ["--task-dir", harness.taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_ORCHESTRATOR_STATE_DIR: harness.stateRoot,
      },
    });

    const meta = await readJson(harness.metaPath);
    const requestEnvelope = await readJson(path.join(harness.taskDir, "planner_request.json"));
    const decisionEnvelope = await readJson(path.join(harness.taskDir, "planner_decision.json"));

    expect(requestEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-request-v1",
      }),
    );
    expect(decisionEnvelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-decision-v1",
        execution_target: "local_threads",
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
        }),
      }),
    );
    expect(meta.planning_decision).toEqual(
      expect.objectContaining({
        decision_source: "planner_rules_fallback",
        llm_role: "primary",
        llm_decision_used: false,
        agent_contract_version: "planner-core-v2",
        token_priority_context: expect.objectContaining({
          tier: "highest",
          effective_planning_tokens: expect.any(Number),
        }),
        mcp_soft_boundary_signals: expect.objectContaining({
          mode: "bias_plan",
        }),
        meta_decomposition: expect.objectContaining({
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
        }),
        worker_refinement: expect.objectContaining({
          required: true,
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
        }),
        granularity_guardrails: expect.objectContaining({
          mode: "soft",
        }),
      }),
    );
  });

  it("treats LLM as primary in auto mode and lets hard guardrails override unsafe output", async () => {
    const harness = await createHarness(
      "task_demo_llm",
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
                    meta_unit_count: 1,
                    reason: "llm chose single-unit decomposition",
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
          system_prompt: "Return strict JSON only.",
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
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
        }),
        granularity_guardrails: expect.objectContaining({
          guardrail_triggered: true,
        }),
      }),
    );
    expect(String((meta.planning_decision as Record<string, unknown>).decision_reason)).toContain(
      "soft boundary escalated by hard guardrail",
    );
  });
});
