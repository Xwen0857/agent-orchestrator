import { buildCommandHandlerDeps, buildHttpRouteDeps } from "../orchestrate-plugin-runtime.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate plugin runtime factories", () => {
  it("returns command deps unchanged", () => {
    const deps = {
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      cfg: { runnerEnabled: true, runnerFallbackEnabled: false },
      runnerTimerActive: false,
      paths: {
        orchestrateRequestsDir: "/repo/requests",
        taskFoldersRoot: "/repo/tasks",
        dashboardJson: "/repo/dashboard.json",
        systemHealthJson: "/repo/system.json",
        executionRuntime: "/repo/runtime.json",
      },
      readOrchestrateSession: vi.fn(),
      writeOrchestrateSession: vi.fn(),
      readPathState: vi.fn(),
      writePathState: vi.fn(),
      statePaths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
      },
      io: {
        fileExists: vi.fn(),
        readJsonOrDefault: vi.fn(),
        writeJsonAtomic: vi.fn(),
        readNdjson: vi.fn(),
        readText: vi.fn(),
        writeTextAtomic: vi.fn(),
      },
      runtime: {
        getRunnerLockMtime: vi.fn(),
        loadExecutionRuntime: vi.fn(),
        getExternalRunnerStatus: vi.fn(),
        ensureRunnerStarted: vi.fn(),
        runnerStatus: "started",
        runnerLastTickAt: "",
        runnerLastTickResult: "none",
        runnerLastTickError: "",
        runnerIntervalSec: 10,
        runnerExecutionMode: "local_threads",
        runnerBatchSize: 4,
        runnerMaxParallel: 2,
      },
      runWhitelistedScript: vi.fn(),
      emitEvent: vi.fn(),
      buildWorkerIdFromTaskId: vi.fn(),
      trimOutput: vi.fn(),
      renderRequiredConfigChecklist: vi.fn(),
      renderOrchestrateHelp: vi.fn(),
    } as Parameters<typeof buildCommandHandlerDeps>[0];

    expect(buildCommandHandlerDeps(deps)).toBe(deps);
  });

  it("returns http deps unchanged", () => {
    const deps = {
      api: { registerHttpRoute: vi.fn(), registerHttpHandler: vi.fn() },
      cfg: { requireGatewayAuth: true },
      basePath: "/plugins/orchestrator",
      apiBasePath: "/api/plugins/orchestrator",
      repoRoot: "/repo",
      paths: {},
      io: {
        fileExists: vi.fn(),
        readJsonOrDefault: vi.fn(),
        readText: vi.fn(),
        writeTextAtomic: vi.fn(),
        writeJsonAtomic: vi.fn(),
        readNdjson: vi.fn(),
      },
      pathsByName: {
        dashboardJson: "/repo/dashboard.json",
        systemHealthJson: "/repo/system.json",
        plannerCurrent: "/repo/current",
        plannerProperties: "/repo/properties",
        auditPolicy: "/repo/audit.json",
        auditHistory: "/repo/history.ndjson",
        snapshotScript: "/repo/snapshot.sh",
        rollbackScript: "/repo/rollback.sh",
      },
      runtime: { eventsPath: "/repo/events.ndjson" },
      helpers: {
        loadCurrentConfig: vi.fn(),
        validateDraft: vi.fn(),
        acquireLock: vi.fn(),
        releaseLock: vi.fn(),
        emitEvent: vi.fn(),
        runScript: vi.fn(),
        updatePlainKvText: vi.fn(),
        updateListKvText: vi.fn(),
      },
    } as unknown as Parameters<typeof buildHttpRouteDeps>[0];

    expect(buildHttpRouteDeps(deps)).toBe(deps);
  });
});
