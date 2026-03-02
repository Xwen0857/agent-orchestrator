import type { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import type { registerOrchestratorHttpRoutes } from "./orchestrate-http.js";
import type { registerOrchestratorOverviewGatewayMethod } from "./orchestrate-overview-gateway.js";
import type { PathState } from "./orchestrate-path.js";
import type { AgentRuntimeController } from "./orchestrate-agent-runtime.js";
import type { ExecutionRuntimeReader } from "./orchestrate-execution-runtime.js";
import type { OrchestrateStatePaths } from "./orchestrate-state.js";
import type { RuntimeConsistencyController } from "./orchestrate-runtime-consistency.js";
import type { RunnerRuntimeController } from "./orchestrate-runner-runtime.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";

type CommandDeps = Parameters<typeof createOrchestrateCommandHandlers>[0];
type HttpDeps = Parameters<typeof registerOrchestratorHttpRoutes>[0];
type OverviewDeps = Parameters<typeof registerOrchestratorOverviewGatewayMethod>[0];

type ConfigServiceLike = {
  loadCurrentConfig: HttpDeps["helpers"]["loadCurrentConfig"];
  validateDraft: HttpDeps["helpers"]["validateDraft"];
  acquireLock: HttpDeps["helpers"]["acquireLock"];
  releaseLock: HttpDeps["helpers"]["releaseLock"];
};

export type BuildOrchestratePluginRuntimeParams = {
  api: OverviewDeps["api"];
  repoRoot: string;
  basePath: string;
  apiBasePath: string;
  cfg: {
    runnerEnabled: boolean;
    runnerFallbackEnabled: boolean;
    requireGatewayAuth: boolean;
  };
  paths: {
    statePaths: OrchestrateStatePaths;
    command: CommandDeps["paths"];
    httpRoutePaths: HttpDeps["paths"];
    httpNames: HttpDeps["pathsByName"];
    eventsPath: string;
    overview: OverviewDeps["paths"];
  };
  state: {
    readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
    writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
    readPathState: () => Promise<PathState>;
    writePathState: (next: PathState) => Promise<void>;
  };
  io: CommandDeps["io"];
  controllers: {
    runner: RunnerRuntimeController;
    execution: ExecutionRuntimeReader;
    consistency: RuntimeConsistencyController;
    agent: AgentRuntimeController;
  };
  configService: ConfigServiceLike;
  helpers: {
    emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
    runWhitelistedScript: CommandDeps["runWhitelistedScript"];
    runScript: HttpDeps["helpers"]["runScript"];
    buildWorkerIdFromTaskId: (taskId: string) => string;
    trimOutput: (value: string) => string;
    renderRequiredConfigChecklist: () => string;
    renderOrchestrateHelp: () => string;
    updatePlainKvText: HttpDeps["helpers"]["updatePlainKvText"];
    updateListKvText: HttpDeps["helpers"]["updateListKvText"];
  };
};

export function buildOrchestratePluginRuntime(
  params: BuildOrchestratePluginRuntimeParams,
): {
  commandDeps: CommandDeps;
  httpDeps: HttpDeps;
  overviewDeps: OverviewDeps;
} {
  const sharedReadJsonOrDefault = params.io.readJsonOrDefault;
  const sharedIo = {
    fileExists: params.io.fileExists,
    readJsonOrDefault: sharedReadJsonOrDefault,
    writeJsonAtomic: params.io.writeJsonAtomic,
    readNdjson: params.io.readNdjson,
    readText: params.io.readText,
    writeTextAtomic: params.io.writeTextAtomic,
  };

  const commandRuntime: CommandDeps["runtime"] = {
    getRunnerLockMtime: params.controllers.runner.getRunnerLockMtime,
    loadExecutionRuntime: params.controllers.execution.loadExecutionRuntime,
    getExternalRunnerStatus: params.controllers.runner.getExternalRunnerStatus,
    ensureRunnerStarted: params.controllers.runner.ensureRunnerStarted,
    get runnerStatus() {
      return params.controllers.runner.getSnapshot().runnerStatus;
    },
    get runnerLastTickAt() {
      return params.controllers.runner.getSnapshot().runnerLastTickAt;
    },
    get runnerLastTickResult() {
      return params.controllers.runner.getSnapshot().runnerLastTickResult;
    },
    get runnerLastTickError() {
      return params.controllers.runner.getSnapshot().runnerLastTickError;
    },
    get runnerIntervalSec() {
      return params.controllers.runner.getSnapshot().runnerIntervalSec;
    },
    get runnerExecutionMode() {
      return params.controllers.runner.getSnapshot().runnerExecutionMode;
    },
    get runnerBatchSize() {
      return params.controllers.runner.getSnapshot().runnerBatchSize;
    },
    get runnerMaxParallel() {
      return params.controllers.runner.getSnapshot().runnerMaxParallel;
    },
  };

  return {
    commandDeps: {
      repoRoot: params.repoRoot,
      basePath: params.basePath,
      cfg: {
        runnerEnabled: params.cfg.runnerEnabled,
        runnerFallbackEnabled: params.cfg.runnerFallbackEnabled,
      },
      runnerTimerActive: params.controllers.runner.getSnapshot().runnerTimerActive,
      paths: {
        ...params.paths.command,
      },
      readOrchestrateSession: params.state.readOrchestrateSession,
      writeOrchestrateSession: params.state.writeOrchestrateSession,
      readPathState: params.state.readPathState,
      writePathState: params.state.writePathState,
      statePaths: {
        ...params.paths.statePaths,
      },
      io: sharedIo,
      runtime: commandRuntime,
      runWhitelistedScript: params.helpers.runWhitelistedScript,
      emitEvent: params.helpers.emitEvent,
      buildWorkerIdFromTaskId: params.helpers.buildWorkerIdFromTaskId,
      trimOutput: params.helpers.trimOutput,
      renderRequiredConfigChecklist: params.helpers.renderRequiredConfigChecklist,
      renderOrchestrateHelp: params.helpers.renderOrchestrateHelp,
    },
    httpDeps: {
      api: params.api,
      cfg: {
        requireGatewayAuth: params.cfg.requireGatewayAuth,
      },
      basePath: params.basePath,
      apiBasePath: params.apiBasePath,
      repoRoot: params.repoRoot,
      paths: {
        ...params.paths.httpRoutePaths,
      },
      io: sharedIo,
      pathsByName: {
        ...params.paths.httpNames,
      },
      runtime: {
        eventsPath: params.paths.eventsPath,
      },
      helpers: {
        loadCurrentConfig: params.configService.loadCurrentConfig,
        validateDraft: params.configService.validateDraft,
        acquireLock: params.configService.acquireLock,
        releaseLock: params.configService.releaseLock,
        emitEvent: params.helpers.emitEvent,
        runScript: params.helpers.runScript,
        updatePlainKvText: params.helpers.updatePlainKvText,
        updateListKvText: params.helpers.updateListKvText,
      },
    },
    overviewDeps: {
      api: params.api,
      io: {
        readJsonOrDefault: sharedReadJsonOrDefault,
      },
      paths: {
        ...params.paths.overview,
      },
    },
  };
}
