import {
  buildOrchestratePluginRuntime,
  buildOrchestratePluginRuntimeInput,
} from "../orchestrate-plugin-runtime.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate plugin runtime composer", () => {
  it("builds normalized composer input from bootstrap state", () => {
    const input = buildOrchestratePluginRuntimeInput({
      api: {
        registerHttpRoute: vi.fn(),
        registerHttpHandler: vi.fn(),
        registerGatewayMethod: vi.fn(),
      } as never,
      repoRoot: "/repo",
      basePath: "/plugins/orchestrator",
      apiBasePath: "/api/plugins/orchestrator",
      cfg: {
        runnerEnabled: true,
        runnerFallbackEnabled: false,
        requireGatewayAuth: true,
      },
      bootstrap: {
        dataDir: "/repo/.state",
        eventsPath: "/repo/events.ndjson",
        lockPath: "/repo/.lock",
        paths: {
          dashboardJson: "/repo/dashboard.json",
          systemHealthJson: "/repo/system_health.json",
          orchestrateRequestsDir: "/repo/requests",
          orchestrateSessionsDir: "/repo/sessions",
          pathState: "/repo/path_state.json",
          taskFoldersRoot: "/repo/tasks",
          plannerCurrent: "/repo/current",
          plannerProperties: "/repo/properties",
          auditPolicy: "/repo/audit.json",
          history: "/repo/history.ndjson",
          snapshotScript: "/repo/snapshot.sh",
          rollbackScript: "/repo/rollback.sh",
          agentRuntimeConfig: "/repo/agent_runtime.json",
          executionRuntime: "/repo/runtime.json",
        },
        runnerLockPath: "/repo/runner.lock",
        runtimeSignaturePath: "/repo/runtime.signature.json",
        runtimeSignatureFiles: [],
        externalRunnerScriptPath: "/repo/runner.sh",
      },
      assembly: {
        state: {
          readOrchestrateSession: vi.fn(),
          writeOrchestrateSession: vi.fn(),
          readPathState: vi.fn(),
          writePathState: vi.fn(),
        },
        services: {
          configService: {
            loadCurrentConfig: vi.fn(),
            validateDraft: vi.fn(),
            acquireLock: vi.fn(),
            releaseLock: vi.fn(),
          },
        },
        controllers: {
          consistency: {
            assertRuntimeConsistency: vi.fn(),
            getSnapshot: vi.fn(),
            getStartupError: vi.fn(),
            startupConsistencyPromise: Promise.resolve(null),
          },
          execution: {
            loadExecutionRuntime: vi.fn(),
          },
          agent: {
            loadAgentRuntimeConfig: vi.fn(),
            enhanceStrategyWithLlm: vi.fn(),
          },
          runner: {
            ensureRunnerStarted: vi.fn(),
            getExternalRunnerStatus: vi.fn(),
            getRunnerLockMtime: vi.fn(),
            getSnapshot: vi.fn(),
            kickoffOnStartup: vi.fn(),
          },
        },
      },
      io: {
        fileExists: vi.fn(),
        readJsonOrDefault: vi.fn(),
        writeJsonAtomic: vi.fn(),
        readNdjson: vi.fn(),
        readText: vi.fn(),
        writeTextAtomic: vi.fn(),
        appendNdjson: vi.fn(),
        runScript: vi.fn(),
      },
      helpers: {
        emitEvent: vi.fn(),
        runWhitelistedScript: vi.fn(),
        runScript: vi.fn(),
        buildWorkerIdFromTaskId: vi.fn(),
        trimOutput: vi.fn(),
        renderRequiredConfigChecklist: vi.fn(),
        renderOrchestrateHelp: vi.fn(),
        updatePlainKvText: vi.fn(),
        updateListKvText: vi.fn(),
      },
    });

    expect(input.paths.command.taskFoldersRoot).toBe("/repo/tasks");
    expect(input.paths.statePaths.orchestrateSessionsDir).toBe("/repo/sessions");
    expect(input.paths.httpNames.auditHistory).toBe("/repo/history.ndjson");
    expect(input.paths.eventsPath).toBe("/repo/events.ndjson");
    expect(input.configService).toBeDefined();
  });

  it("builds normalized command, http, and overview dependency bundles", async () => {
    const api = {
      registerHttpRoute: vi.fn(),
      registerHttpHandler: vi.fn(),
      registerGatewayMethod: vi.fn(),
    } as unknown as Parameters<typeof buildOrchestratePluginRuntime>[0]["api"];
    const readJsonOrDefault = async <T>(_targetPath: string, fallback: T): Promise<T> => fallback;
    const emitEvent = vi.fn(async () => {});
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const runScript = vi.fn(async () => ({ stdout: "", stderr: "" }));

    const runnerController = {
      getRunnerLockMtime: vi.fn(async () => "mtime"),
      getExternalRunnerStatus: vi.fn(async () => ({
        running: false,
        pid: 0,
        lastTickAt: "",
        lastExitCode: "",
      })),
      ensureRunnerStarted: vi.fn(async () => ({
        schedulerStatus: "started" as const,
        lastTickAt: "",
        intervalSec: 10,
      })),
      getSnapshot: vi.fn(() => ({
        runnerStatus: "started" as const,
        runnerLastTickAt: "tick",
        runnerLastTickResult: "ok" as const,
        runnerLastTickError: "",
        runnerIntervalSec: 10,
        runnerExecutionMode: "local_threads",
        runnerBatchSize: 4,
        runnerMaxParallel: 2,
        runnerTimerActive: false,
      })),
      kickoffOnStartup: vi.fn(),
    };

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
      controllers: {
        runner: runnerController,
        execution: {
          loadExecutionRuntime: vi.fn(async () => ({
            logicalThreads: 4,
            effectiveWorkerThreads: 1,
            parallelLimit: 1,
            queueDepth: 0,
            policyMode: "enforce",
            rolePolicyPath: "/repo/role.json",
            workdomainRoot: "runtime/workdomains",
            projectsRoot: "projects",
            aclDeniedCount: 0,
            aclLastDeniedAt: "",
            sandboxEnabled: true,
            commitGuardEnabled: true,
            kbImportConfirmRequired: true,
            kbImportAutoEnabled: false,
            workspaceSyncSensitivity: "MEDIUM",
            skillMcpIsolationEnabled: true,
            protectOrchestratorConfig: true,
            projectRuntimeProfile: "project_execution",
            orchestratorRuntimeProfile: "orchestrator_control",
          })),
        },
        consistency: {
          assertRuntimeConsistency: vi.fn(),
          getSnapshot: vi.fn(() => ({
            runtimeConsistency: "ok" as const,
            runtimeSignature: "sig",
            runtimeExpectedSignature: "sig",
          })),
          getStartupError: vi.fn(() => ""),
          startupConsistencyPromise: Promise.resolve(null),
        },
        agent: {
          loadAgentRuntimeConfig: vi.fn(),
          enhanceStrategyWithLlm: vi.fn(),
        },
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
    expect(runtime.commandDeps.runtime.getRunnerSnapshot().runnerStatus).toBe("started");
    expect(runtime.commandDeps.runtime.getConsistencySnapshot().runtimeConsistency).toBe("ok");
    expect(runtime.commandDeps.runtime.ensureRunnerStarted).toBe(runnerController.ensureRunnerStarted);

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
