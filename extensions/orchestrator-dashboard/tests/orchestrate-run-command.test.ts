import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRunSubcommand } from "../orchestrate-run-command.js";

function createSession(overrides?: Partial<{
  project_id: string;
  workspace_root: string;
}>) {
  return {
    schema_version: "orchestrate-session-v1" as const,
    session_key: "sess_demo",
    channel: "cli",
    sender_id: "tester",
    status: "SUMMARY_READY" as const,
    started_at: "2026-03-02T00:00:00.000Z",
    updated_at: "2026-03-02T00:00:00.000Z",
    entry_agent: { active: true, mode: "conversation_capture" as const },
    receptionist: {
      active: true,
      mode: "guided_intake" as const,
      last_briefing_at: "2026-03-02T00:00:00.000Z",
      pending_questions: [],
      amendment_queue_open: false,
      action_route: "intake_new_task" as const,
      action_target_task_id: null,
      clarification_required: false,
      last_action_at: "2026-03-02T00:00:00.000Z",
    },
    draft: {
      goal_raw: "Build websocket calculator",
      task_goal: "Build websocket calculator",
      project_id: overrides?.project_id ?? "prj_demo",
      workspace_root: overrides?.workspace_root ?? "prj_demo/runs/demo/workspace",
      risk_level: "MEDIUM" as const,
      budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
      constraints: ["python only"],
      deliverables: ["server.py"],
      notes: ["keep simple"],
      open_questions: [],
    },
    history: [],
    latest_summary: {
      summary_id: "sum_demo",
      created_at: "2026-03-02T00:00:00.000Z",
      version: 1,
      status: "confirmed" as const,
      content: {
        task_goal: "Build websocket calculator",
        project_id: overrides?.project_id ?? "prj_demo",
        workspace_root: overrides?.workspace_root ?? "prj_demo/runs/demo/workspace",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
        constraints: ["python only"],
        deliverables: ["server.py"],
        notes: ["keep simple"],
      },
    },
  };
}

function createRuntimeStats() {
  return {
    logicalThreads: 8,
    effectiveWorkerThreads: 6,
    parallelLimit: 2,
    queueDepth: 1,
    policyMode: "enforce",
    rolePolicyPath: "templates/coordination/security/role_permissions.effective.json",
    aclDeniedCount: 0,
    aclLastDeniedAt: "",
    sandboxEnabled: true,
    commitGuardEnabled: true,
    kbImportConfirmRequired: false,
    kbImportAutoEnabled: false,
    workspaceSyncSensitivity: "normal",
    skillMcpIsolationEnabled: true,
    protectOrchestratorConfig: true,
    projectRuntimeProfile: "default",
    orchestratorRuntimeProfile: "default",
    workdomainRoot: "/repo/runtime/workdomains",
    projectsRoot: "projects",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("orchestrate-run-command", () => {
  it("treats planner success as the point where the run becomes active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T00:00:00.000Z"));
    const jsonStore = new Map<string, unknown>();
    const writes: Array<{ path: string; payload: unknown }> = [];
    const steps: string[] = [];
    const emitted: string[] = [];
    const runtimeStats = createRuntimeStats();

    const readJsonOrDefault = async <T,>(targetPath: string, fallback: T): Promise<T> => {
      return (jsonStore.has(targetPath) ? jsonStore.get(targetPath) : fallback) as T;
    };
    const writeJsonAtomic = vi.fn(async (targetPath: string, payload: unknown) => {
      writes.push({ path: targetPath, payload });
      jsonStore.set(targetPath, payload);
    });
    const writeOrchestrateSession = vi.fn(async () => {
      steps.push("session:running");
    });
    const emitEvent = vi.fn(async (type: string) => {
      emitted.push(type);
      steps.push(`event:${type}`);
    });
    const runWhitelistedScript = vi.fn(
      async (input: { scriptName: string; args: string[] }) => {
        steps.push(`script:${input.scriptName}`);
        if (input.scriptName === "planner_entry") {
          const plannerTaskDir = path.join("/repo", input.args[1] ?? "");
          const plannerMetaPath = path.join(plannerTaskDir, "meta.json");
          const plannerSplitPlanPath = path.join(plannerTaskDir, "split_plan.json");
          const currentMeta = (jsonStore.get(plannerMetaPath) as Record<string, unknown>) ?? {};
          jsonStore.set(plannerMetaPath, {
            ...currentMeta,
            state: "CREATED",
            version: 1,
            planning_decision: {
              decision_source: "planner_rules_fallback",
              decision_reason: "single-task default",
              meta_decomposition: {
                decision_source: "planner_rules_fallback",
                decomposition_strategy: "meta_single_unit",
                meta_unit_count: 1,
              },
              worker_refinement: {
                required: true,
                refinement_strategy: "linear_split_units_placeholder",
                refinement_scope: "single_meta_input",
              },
            },
            execution_roles: {
              planning_actor: "planner-core",
              scheduling_actor: "scheduler-ops",
            },
          });
          jsonStore.set(plannerSplitPlanPath, {
            initial_partition: {
              strategy: "meta_single_unit",
              modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
            },
            refinement_partition: {
              strategy: "linear_split_units_placeholder",
              input_scope: "single_meta_input",
              granularity: "temporary_refinement_granularity",
              component_candidates: ["implementation_unit"],
              leaf_units: [
                {
                  leaf_id: "leaf_1",
                  module_id: "meta_unit_001",
                  module_title: "root_meta_unit",
                  component_candidate: "implementation_unit",
                  depends_on_component_candidates: [],
                  depends_on_leaf_ids: [],
                  stage_id: "stage_1",
                  sequence: 1,
                  total_units: 1,
                  release_state: "immediate_first_wave",
                  worker_task_id: "task_demo",
                },
              ],
              backlog: [],
            },
          });
        }
        return { stdout: "ok", stderr: "" };
      },
    );

    const text = await handleRunSubcommand({
      payload: "",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_demo",
      },
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      paths: {
        orchestrateRequestsDir: "/repo/requests",
        taskFoldersRoot: "/repo/tasks",
      },
      readOrchestrateSession: vi.fn(async () => createSession()),
      writeOrchestrateSession,
      readPathState: vi.fn(async () => ({
        schema_version: "orchestrate-path-state-v1" as const,
        updated_at: "2026-03-02T00:00:00.000Z",
        projects: {},
      })),
      readJsonOrDefault,
      writeJsonAtomic,
      runWhitelistedScript,
      emitEvent,
      buildWorkerIdFromTaskId: vi.fn(() => "worker_demo"),
      trimOutput: (value: string) => value,
      loadExecutionRuntime: vi.fn(async () => runtimeStats),
      ensureRunnerStarted: vi.fn(async () => ({
        schedulerStatus: "started",
        lastTickAt: "2026-03-02T00:00:05.000Z",
        intervalSec: 10,
      })),
      getExternalRunnerStatus: vi.fn(async () => ({
        running: false,
        pid: 0,
        lastTickAt: "",
        lastExitCode: "",
      })),
      runtime: {
        getRunnerSnapshot: () => ({
          runnerStatus: "started",
          runnerLastTickAt: "2026-03-02T00:00:05.000Z",
          runnerLastTickResult: "ok",
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
          runnerTimerActive: true,
        }),
        getConsistencySnapshot: () => ({
          runtimeConsistency: "ok",
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        }),
        runnerFallbackEnabled: false,
      },
      renderRequiredConfigChecklist: () => "checklist",
    });

    const createTaskCall = runWhitelistedScript.mock.calls[0]?.[0];
    const strategyRelPath = String(createTaskCall?.args?.[0] ?? "");
    const taskId = path.basename(strategyRelPath, ".strategy.json");
    const strategyPath = path.join("/repo", strategyRelPath);
    const taskDir = path.join("/repo", "tasks", taskId);
    const metaPath = path.join(taskDir, "meta.json");

    expect(text).toContain(taskId);
    expect(runWhitelistedScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scriptName: "create_task_from_strategy",
        args: [strategyRelPath, "tasks"],
      }),
    );
    expect(runWhitelistedScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scriptName: "planner_entry",
        args: ["--task-dir", `tasks/${taskId}`],
      }),
    );

    expect(steps.indexOf("script:dashboard_summary")).toBeGreaterThan(steps.indexOf("script:planner_entry"));
    expect(steps.indexOf("session:running")).toBeGreaterThan(steps.indexOf("script:dashboard_summary"));
    expect(steps.indexOf("event:orchestrate.session.run_started")).toBeGreaterThan(
      steps.indexOf("script:dashboard_summary"),
    );

    expect(writeOrchestrateSession).toHaveBeenCalledTimes(1);
    expect(emitted).toContain("orchestrate.session.run_started");
    expect(emitted).toContain("orchestrate.run.applied");

    const strategyWrites = writes.filter((entry) => entry.path === strategyPath);
    expect(strategyWrites).toHaveLength(1);
    expect(strategyWrites[0]?.payload).toEqual(
      expect.objectContaining({
        task_id: taskId,
        status: "drafted",
        workspace: {
          project_id: "prj_demo",
          workspace_root: "prj_demo/runs/demo/workspace",
          source: "run_flag",
        },
      }),
    );
    expect(strategyWrites[0]?.payload).not.toEqual(expect.objectContaining({ summary_id: expect.anything() }));

    const metaWrites = writes.filter((entry) => entry.path === metaPath);
    expect(metaWrites).toHaveLength(1);
    expect(metaWrites[0]?.payload).toEqual(
      expect.objectContaining({
        orchestrate_session_key: "sess_demo",
        summary_id: "sum_demo",
        summary_path: expect.stringContaining("sum_demo.summary.json"),
        input_source: "session_summary",
      }),
    );
  });

  it("does not mark the session active when planner fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T00:00:00.000Z"));
    const jsonStore = new Map<string, unknown>();
    const emitted: string[] = [];
    const writes: Array<{ path: string; payload: unknown }> = [];
    const runWhitelistedScript = vi.fn(async (input: { scriptName: string; args: string[] }) => {
      if (input.scriptName === "planner_entry") {
        throw new Error("planner unavailable");
      }
      return { stdout: "ok", stderr: "" };
    });

    const text = await handleRunSubcommand({
      payload: "",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_demo",
      },
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      paths: {
        orchestrateRequestsDir: "/repo/requests",
        taskFoldersRoot: "/repo/tasks",
      },
      readOrchestrateSession: vi.fn(async () => createSession()),
      writeOrchestrateSession: vi.fn(async () => {
        throw new Error("session should not be updated");
      }),
      readPathState: vi.fn(async () => ({
        schema_version: "orchestrate-path-state-v1" as const,
        updated_at: "2026-03-02T00:00:00.000Z",
        projects: {},
      })),
      readJsonOrDefault: async <T,>(targetPath: string, fallback: T): Promise<T> => {
        return (jsonStore.has(targetPath) ? jsonStore.get(targetPath) : fallback) as T;
      },
      writeJsonAtomic: vi.fn(async (targetPath: string, payload: unknown) => {
        writes.push({ path: targetPath, payload });
        jsonStore.set(targetPath, payload);
      }),
      runWhitelistedScript,
      emitEvent: vi.fn(async (type: string) => {
        emitted.push(type);
      }),
      buildWorkerIdFromTaskId: vi.fn(() => "worker_demo"),
      trimOutput: (value: string) => value,
      loadExecutionRuntime: vi.fn(async () => createRuntimeStats()),
      ensureRunnerStarted: vi.fn(async () => ({
        schedulerStatus: "started",
        lastTickAt: "2026-03-02T00:00:05.000Z",
        intervalSec: 10,
      })),
      getExternalRunnerStatus: vi.fn(async () => ({
        running: false,
        pid: 0,
        lastTickAt: "",
        lastExitCode: "",
      })),
      runtime: {
        getRunnerSnapshot: () => ({
          runnerStatus: "started",
          runnerLastTickAt: "2026-03-02T00:00:05.000Z",
          runnerLastTickResult: "ok",
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
          runnerTimerActive: true,
        }),
        getConsistencySnapshot: () => ({
          runtimeConsistency: "ok",
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        }),
        runnerFallbackEnabled: false,
      },
      renderRequiredConfigChecklist: () => "checklist",
    });

    const createTaskCall = runWhitelistedScript.mock.calls[0]?.[0];
    const strategyRelPath = String(createTaskCall?.args?.[0] ?? "");
    const taskId = path.basename(strategyRelPath, ".strategy.json");
    const strategyPath = path.join("/repo", strategyRelPath);
    const metaPath = path.join("/repo", "tasks", taskId, "meta.json");

    expect(text).toContain("orchestrate run failed: planner unavailable");
    expect(text).toContain(strategyPath);
    expect(emitted).toContain("orchestrate.run.failed");
    expect(emitted).not.toContain("orchestrate.session.run_started");
    expect(writes.filter((entry) => entry.path === strategyPath)).toHaveLength(1);
    expect(writes.filter((entry) => entry.path === metaPath)).toHaveLength(1);
  });

  it("surfaces initial partition output from planner without any mode compatibility fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T00:00:00.000Z"));
    const jsonStore = new Map<string, unknown>();

    const runWhitelistedScript = vi.fn(
      async (input: { scriptName: string; args: string[] }) => {
        if (input.scriptName === "planner_entry") {
          const plannerTaskDir = path.join("/repo", input.args[1] ?? "");
          const plannerMetaPath = path.join(plannerTaskDir, "meta.json");
          const plannerSplitPlanPath = path.join(plannerTaskDir, "split_plan.json");
          const currentMeta = (jsonStore.get(plannerMetaPath) as Record<string, unknown>) ?? {};
          jsonStore.set(plannerMetaPath, {
            ...currentMeta,
            state: "CREATED",
            version: 1,
            planning_decision: {
              decision_source: "manual_override",
              decision_reason: "planner kept initial partition",
              initial_partition: {
                strategy: "meta_module_partition",
                modules: [
                  { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
                  { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
                ],
              },
              meta_decomposition: {
                decision_source: "manual_override",
                decomposition_strategy: "meta_module_partition",
                meta_unit_count: 2,
              },
              worker_refinement: {
                required: true,
                refinement_strategy: "linear_split_units_placeholder",
                refinement_scope: "multi_meta_input",
              },
            },
            execution_roles: {
              planning_actor: "planner-core",
              scheduling_actor: "scheduler-ops",
            },
            children: ["task_child_001", "task_child_002"],
            split_units_planned: 2,
          });
          jsonStore.set(plannerSplitPlanPath, {
            initial_partition: {
              strategy: "meta_module_partition",
              modules: [
                { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
                { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
              ],
            },
            refinement_partition: {
              strategy: "linear_split_units_placeholder",
              input_scope: "multi_meta_input",
              granularity: "temporary_refinement_granularity",
              component_candidates: ["protocol_schema", "transport_adapter"],
              leaf_units: [
                {
                  leaf_id: "leaf_1",
                  module_id: "meta_unit_001",
                  module_title: "module_1",
                  component_candidate: "protocol_schema",
                  depends_on_component_candidates: [],
                  depends_on_leaf_ids: [],
                  stage_id: "stage_1",
                  sequence: 1,
                  total_units: 2,
                  release_state: "immediate_first_wave",
                  child_task_id: "task_child_001",
                },
                {
                  leaf_id: "leaf_2",
                  module_id: "meta_unit_002",
                  module_title: "module_2",
                  component_candidate: "transport_adapter",
                  depends_on_component_candidates: ["protocol_schema"],
                  depends_on_leaf_ids: ["leaf_1"],
                  stage_id: "stage_2",
                  sequence: 2,
                  total_units: 2,
                  release_state: "immediate_first_wave",
                  child_task_id: "task_child_002",
                },
              ],
              backlog: [],
            },
          });
        }
        return { stdout: "ok", stderr: "" };
      },
    );

    const text = await handleRunSubcommand({
      payload: "",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_demo",
      },
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      paths: {
        orchestrateRequestsDir: "/repo/requests",
        taskFoldersRoot: "/repo/tasks",
      },
      readOrchestrateSession: vi.fn(async () => createSession()),
      writeOrchestrateSession: vi.fn(async () => undefined),
      readPathState: vi.fn(async () => ({
        schema_version: "orchestrate-path-state-v1" as const,
        updated_at: "2026-03-02T00:00:00.000Z",
        projects: {},
      })),
      readJsonOrDefault: async <T,>(targetPath: string, fallback: T): Promise<T> => {
        return (jsonStore.has(targetPath) ? jsonStore.get(targetPath) : fallback) as T;
      },
      writeJsonAtomic: vi.fn(async (targetPath: string, payload: unknown) => {
        jsonStore.set(targetPath, payload);
      }),
      runWhitelistedScript,
      emitEvent: vi.fn(async () => undefined),
      buildWorkerIdFromTaskId: vi.fn(() => "worker_demo"),
      trimOutput: (value: string) => value,
      loadExecutionRuntime: vi.fn(async () => createRuntimeStats()),
      ensureRunnerStarted: vi.fn(async () => ({
        schedulerStatus: "started",
        lastTickAt: "2026-03-02T00:00:05.000Z",
        intervalSec: 10,
      })),
      getExternalRunnerStatus: vi.fn(async () => ({
        running: false,
        pid: 0,
        lastTickAt: "",
        lastExitCode: "",
      })),
      runtime: {
        getRunnerSnapshot: () => ({
          runnerStatus: "started",
          runnerLastTickAt: "2026-03-02T00:00:05.000Z",
          runnerLastTickResult: "ok",
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
          runnerTimerActive: true,
        }),
        getConsistencySnapshot: () => ({
          runtimeConsistency: "ok",
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        }),
        runnerFallbackEnabled: false,
      },
      renderRequiredConfigChecklist: () => "checklist",
    });

    expect(runWhitelistedScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptName: "planner_entry",
        args: expect.arrayContaining(["--task-dir"]),
      }),
    );
    expect(text).toContain("planner_ingress: auto-only");
    expect(text).toContain("initial_partition_strategy: meta_module_partition");
    expect(text).toContain("initial_meta_units: 2");
    expect(text).toContain("initial_partition_expanded: true");
  });

  it("rejects workspace roots that shell bootstrap would refuse", async () => {
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));

    const text = await handleRunSubcommand({
      payload: "",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_demo",
      },
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      paths: {
        orchestrateRequestsDir: "/repo/requests",
        taskFoldersRoot: "/repo/tasks",
      },
      readOrchestrateSession: vi.fn(async () =>
        createSession({
          workspace_root: "prj_demo/a..b/workspace",
        }),
      ),
      writeOrchestrateSession: vi.fn(async () => {}),
      readPathState: vi.fn(async () => ({
        schema_version: "orchestrate-path-state-v1" as const,
        updated_at: "2026-03-02T00:00:00.000Z",
        projects: {},
      })),
      readJsonOrDefault: async <T,>(_targetPath: string, fallback: T): Promise<T> => fallback,
      writeJsonAtomic: vi.fn(async () => {}),
      runWhitelistedScript,
      emitEvent: vi.fn(async () => {}),
      buildWorkerIdFromTaskId: vi.fn(() => "worker_demo"),
      trimOutput: (value: string) => value,
      loadExecutionRuntime: vi.fn(async () => createRuntimeStats()),
      ensureRunnerStarted: vi.fn(async () => ({
        schedulerStatus: "started",
        lastTickAt: "2026-03-02T00:00:05.000Z",
        intervalSec: 10,
      })),
      getExternalRunnerStatus: vi.fn(async () => ({
        running: false,
        pid: 0,
        lastTickAt: "",
        lastExitCode: "",
      })),
      runtime: {
        getRunnerSnapshot: () => ({
          runnerStatus: "started",
          runnerLastTickAt: "2026-03-02T00:00:05.000Z",
          runnerLastTickResult: "ok",
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
          runnerTimerActive: true,
        }),
        getConsistencySnapshot: () => ({
          runtimeConsistency: "ok",
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        }),
        runnerFallbackEnabled: false,
      },
      renderRequiredConfigChecklist: () => "checklist",
    });

    expect(text).toBe(
      "orchestrate run failed: invalid --workspace-root: workspace_root cannot contain ..",
    );
    expect(runWhitelistedScript).not.toHaveBeenCalled();
  });
});
