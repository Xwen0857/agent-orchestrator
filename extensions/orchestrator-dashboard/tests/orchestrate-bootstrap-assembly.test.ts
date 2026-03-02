import { describe, expect, it, vi } from "vitest";
import { buildOrchestratorBootstrapAssembly } from "../orchestrate-bootstrap-assembly.js";

describe("orchestrate-bootstrap-assembly", () => {
  it("builds state accessors, config service, and runtime controllers", async () => {
    const api = {
      pluginConfig: {},
      runtime: {
        state: {
          resolveStateDir: () => "/tmp/openclaw-state",
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as never;

    const assembly = buildOrchestratorBootstrapAssembly({
      api,
      repoRoot: "/repo",
      lockPath: "/repo/.lock",
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        plannerCurrent: "/repo/current.md",
        plannerProperties: "/repo/properties.md",
        auditPolicy: "/repo/audit.json",
        dashboardJson: "/repo/dashboard.json",
        executionRuntime: "/repo/execution_runtime.json",
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
      runnerLockPath: "/repo/runner.lock",
      externalRunnerScriptPath: "/repo/external.sh",
      runtimeSignaturePath: "/repo/runtime.signature.json",
      runtimeSignatureFiles: [],
      cfg: {
        runtimeConsistencyMode: "warn",
        runnerEnabled: false,
        runnerFallbackEnabled: false,
        runnerFallbackMode: "none",
        runnerIntervalSec: 10,
        runnerExecutionMode: "local_threads",
        runnerBatchSize: 4,
        runnerMaxParallel: 2,
        runnerTasksRootArg: "templates/coordination/tasks/task_folders",
      },
      io: {
        fileExists: vi.fn(async () => false),
        readJsonOrDefault: async <T>(_p: string, fallback: T): Promise<T> => fallback,
        readText: vi.fn(async () => ""),
        writeTextAtomic: vi.fn(async () => {}),
        writeJsonAtomic: vi.fn(async () => {}),
        readNdjson: vi.fn(async () => []),
        appendNdjson: vi.fn(async () => {}),
        runScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
      },
      helpers: {
        emitEvent: vi.fn(async () => {}),
        runWhitelistedScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
        trimOutput: (value: string) => value,
      },
      mismatchCode: "ORCHESTRATOR_RUNTIME_MISMATCH",
    });

    expect(typeof assembly.state.readPathState).toBe("function");
    expect(typeof assembly.state.writePathState).toBe("function");
    expect(typeof assembly.state.readOrchestrateSession).toBe("function");
    expect(typeof assembly.state.writeOrchestrateSession).toBe("function");
    expect(typeof assembly.services.configService.loadCurrentConfig).toBe("function");
    expect(typeof assembly.controllers.consistency.getSnapshot).toBe("function");
    expect(typeof assembly.controllers.execution.loadExecutionRuntime).toBe("function");
    expect(typeof assembly.controllers.agent.loadAgentRuntimeConfig).toBe("function");
    expect(typeof assembly.controllers.runner.getSnapshot).toBe("function");

    await expect(assembly.controllers.runner.ensureRunnerStarted()).resolves.toMatchObject({
      schedulerStatus: "degraded",
      intervalSec: 10,
    });
  });
});
