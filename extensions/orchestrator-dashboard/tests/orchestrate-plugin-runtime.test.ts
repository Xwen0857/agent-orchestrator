import { buildOrchestratePluginRuntime } from "../orchestrate-plugin-runtime.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate plugin runtime composer", () => {
  it("builds normalized command, http, and overview dependency bundles", () => {
    const api = {
      registerHttpRoute: vi.fn(),
      registerHttpHandler: vi.fn(),
      registerGatewayMethod: vi.fn(),
    } as unknown as Parameters<typeof buildOrchestratePluginRuntime>[0]["api"];
    const readJsonOrDefault = async <T>(_targetPath: string, fallback: T): Promise<T> => fallback;
    const emitEvent = vi.fn(async () => {});
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const runScript = vi.fn(async () => ({ stdout: "", stderr: "" }));

    const runtime = buildOrchestratePluginRuntime({
      api,
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      apiBasePath: "/api/plugins/orchestrator",
      cfg: {
        runnerEnabled: true,
        runnerFallbackEnabled: false,
        requireGatewayAuth: true,
      },
      runnerTimerActive: false,
      paths: {
        statePaths: {
          pathState: "/repo/path_state.json",
          orchestrateSessionsDir: "/repo/sessions",
          orchestrateRequestsDir: "/repo/requests",
        },
        command: {
          orchestrateRequestsDir: "/repo/requests",
          taskFoldersRoot: "/repo/tasks",
          dashboardJson: "/repo/dashboard.json",
          systemHealthJson: "/repo/system_health.json",
          executionRuntime: "/repo/runtime.json",
        },
        httpRoutePaths: {
          dashboardJson: "/repo/dashboard.json",
          systemHealthJson: "/repo/system_health.json",
        },
        httpNames: {
          dashboardJson: "/repo/dashboard.json",
          systemHealthJson: "/repo/system_health.json",
          plannerCurrent: "/repo/current",
          plannerProperties: "/repo/properties",
          auditPolicy: "/repo/audit.json",
          auditHistory: "/repo/history.ndjson",
          snapshotScript: "/repo/snapshot.sh",
          rollbackScript: "/repo/rollback.sh",
        },
        eventsPath: "/repo/events.ndjson",
        overview: {
          dashboardJson: "/repo/dashboard.json",
          systemHealthJson: "/repo/system_health.json",
        },
      },
      state: {
        readOrchestrateSession: vi.fn(),
        writeOrchestrateSession: vi.fn(),
        readPathState: vi.fn(),
        writePathState: vi.fn(),
      },
      io: {
        fileExists: vi.fn(),
        readJsonOrDefault,
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
      configService: {
        loadCurrentConfig: vi.fn(),
        validateDraft: vi.fn(),
        acquireLock: vi.fn(),
        releaseLock: vi.fn(),
      },
      helpers: {
        emitEvent,
        runWhitelistedScript,
        runScript,
        buildWorkerIdFromTaskId: vi.fn(),
        trimOutput: vi.fn(),
        renderRequiredConfigChecklist: vi.fn(),
        renderOrchestrateHelp: vi.fn(),
        updatePlainKvText: vi.fn(),
        updateListKvText: vi.fn(),
      },
    });

    expect(runtime.commandDeps.repoRoot).toBe("/repo");
    expect(runtime.commandDeps.io.readJsonOrDefault).toBe(readJsonOrDefault);
    expect(runtime.commandDeps.runWhitelistedScript).toBe(runWhitelistedScript);
    expect(runtime.commandDeps.emitEvent).toBe(emitEvent);

    expect(runtime.httpDeps.api).toBe(api);
    expect(runtime.httpDeps.cfg.requireGatewayAuth).toBe(true);
    expect(runtime.httpDeps.helpers.emitEvent).toBe(emitEvent);
    expect(runtime.httpDeps.helpers.runScript).toBe(runScript);
    expect(runtime.httpDeps.runtime.eventsPath).toBe("/repo/events.ndjson");

    expect(runtime.overviewDeps.api).toBe(api);
    expect(runtime.overviewDeps.io.readJsonOrDefault).toBe(readJsonOrDefault);
    expect(runtime.overviewDeps.paths.dashboardJson).toBe("/repo/dashboard.json");
  });
});
