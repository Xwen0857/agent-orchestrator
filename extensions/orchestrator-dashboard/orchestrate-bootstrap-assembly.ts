import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildAgentRuntimeController, type AgentRuntimeController } from "./orchestrate-agent-runtime.js";
import { createConfigService } from "./orchestrate-config-service.js";
import {
  buildExecutionRuntimeReader,
  type ExecutionRuntimeReader,
} from "./orchestrate-execution-runtime.js";
import type { OrchestrateIo } from "./orchestrate-io.js";
import { buildRunnerRuntimeController, type RunnerRuntimeController } from "./orchestrate-runner-runtime.js";
import {
  buildRuntimeConsistencyController,
  type RuntimeConsistencyController,
  type RuntimeSignatureFileSpec,
} from "./orchestrate-runtime-consistency.js";
import {
  readOrchestrateSessionStore,
  readPathStateStore,
  type OrchestrateStatePaths,
  writeOrchestrateSessionStore,
  writePathStateStore,
} from "./orchestrate-state.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import type { PathState } from "./orchestrate-path.js";

export type OrchestratorBootstrapAssembly = {
  state: {
    readPathState: () => Promise<PathState>;
    writePathState: (next: PathState) => Promise<void>;
    readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
    writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  };
  services: {
    configService: ReturnType<typeof createConfigService>;
  };
  controllers: {
    consistency: RuntimeConsistencyController;
    execution: ExecutionRuntimeReader;
    agent: AgentRuntimeController;
    runner: RunnerRuntimeController;
  };
};

export function buildOrchestratorBootstrapAssembly(params: {
  api: OpenClawPluginApi;
  repoRoot: string;
  lockPath: string;
  paths: OrchestrateStatePaths & {
    plannerCurrent: string;
    plannerProperties: string;
    auditPolicy: string;
    dashboardJson: string;
    executionRuntime: string;
    agentRuntimeConfig: string;
  };
  runnerLockPath: string;
  externalRunnerScriptPath: string;
  runtimeSignaturePath: string;
  runtimeSignatureFiles: RuntimeSignatureFileSpec[];
  cfg: {
    runtimeConsistencyMode: "enforce" | "warn";
    runnerEnabled: boolean;
    runnerFallbackEnabled: boolean;
    runnerFallbackMode: "external_daemon" | "none";
    runnerIntervalSec: number;
    runnerExecutionMode: "local_threads" | "container" | "distributed";
    runnerBatchSize: number;
    runnerMaxParallel: number;
    runnerTasksRootArg: string;
  };
  io: OrchestrateIo;
  helpers: {
    emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
    runWhitelistedScript: (params: {
      repoRoot: string;
      scriptName: "orchestrate_multi_once";
      args: string[];
      timeoutMs?: number;
      maxBufferBytes?: number;
    }) => Promise<{ stdout: string; stderr: string }>;
    trimOutput: (value: string, maxChars?: number) => string;
  };
  mismatchCode: string;
}): OrchestratorBootstrapAssembly {
  const readPathState = async (): Promise<PathState> =>
    readPathStateStore({
      io: {
        fileExists: params.io.fileExists,
        readJsonOrDefault: params.io.readJsonOrDefault,
        writeJsonAtomic: params.io.writeJsonAtomic,
      },
      paths: params.paths,
    });

  const writePathState = async (next: PathState): Promise<void> => {
    await writePathStateStore({
      io: {
        fileExists: params.io.fileExists,
        readJsonOrDefault: params.io.readJsonOrDefault,
        writeJsonAtomic: params.io.writeJsonAtomic,
      },
      paths: params.paths,
      state: next,
    });
  };

  const readOrchestrateSession = async (
    sessionKey: string,
  ): Promise<OrchestrateSessionState | null> =>
    readOrchestrateSessionStore({
      io: {
        fileExists: params.io.fileExists,
        readJsonOrDefault: params.io.readJsonOrDefault,
        writeJsonAtomic: params.io.writeJsonAtomic,
      },
      paths: params.paths,
      sessionKey,
    });

  const writeOrchestrateSession = async (next: OrchestrateSessionState): Promise<void> => {
    await writeOrchestrateSessionStore({
      io: {
        fileExists: params.io.fileExists,
        readJsonOrDefault: params.io.readJsonOrDefault,
        writeJsonAtomic: params.io.writeJsonAtomic,
      },
      paths: params.paths,
      session: next,
    });
  };

  const configService = createConfigService({
    paths: {
      plannerCurrent: params.paths.plannerCurrent,
      plannerProperties: params.paths.plannerProperties,
      auditPolicy: params.paths.auditPolicy,
    },
    lockPath: params.lockPath,
    io: {
      readText: params.io.readText,
      readJsonOrDefault: params.io.readJsonOrDefault,
    },
  });

  const consistency = buildRuntimeConsistencyController({
    runtimeSignatureFiles: params.runtimeSignatureFiles,
    runtimeSignaturePath: params.runtimeSignaturePath,
    consistencyMode: params.cfg.runtimeConsistencyMode,
    readJsonOrDefault: params.io.readJsonOrDefault,
    readText: params.io.readText,
    emitEvent: params.helpers.emitEvent,
    mismatchCode: params.mismatchCode,
  });

  const execution = buildExecutionRuntimeReader({
    repoRoot: params.repoRoot,
    paths: {
      executionRuntime: params.paths.executionRuntime,
      dashboardJson: params.paths.dashboardJson,
    },
    io: {
      fileExists: params.io.fileExists,
      readJsonOrDefault: params.io.readJsonOrDefault,
      readText: params.io.readText,
    },
  });

  const agent = buildAgentRuntimeController({
    api: params.api,
    paths: {
      agentRuntimeConfig: params.paths.agentRuntimeConfig,
    },
    io: {
      readJsonOrDefault: params.io.readJsonOrDefault,
    },
    emitEvent: params.helpers.emitEvent,
    trimOutput: params.helpers.trimOutput,
  });

  const runner = buildRunnerRuntimeController({
    repoRoot: params.repoRoot,
    runnerLockPath: params.runnerLockPath,
    externalRunnerScriptPath: params.externalRunnerScriptPath,
    startupConsistencyPromise: consistency.startupConsistencyPromise,
    cfg: {
      runnerEnabled: params.cfg.runnerEnabled,
      runnerFallbackEnabled: params.cfg.runnerFallbackEnabled,
      runnerFallbackMode: params.cfg.runnerFallbackMode,
      runnerIntervalSec: params.cfg.runnerIntervalSec,
      runnerExecutionMode: params.cfg.runnerExecutionMode,
      runnerBatchSize: params.cfg.runnerBatchSize,
      runnerMaxParallel: params.cfg.runnerMaxParallel,
      runnerTasksRootArg: params.cfg.runnerTasksRootArg,
    },
    io: {
      fileExists: params.io.fileExists,
      readText: params.io.readText,
      runScript: params.io.runScript,
    },
    runWhitelistedScript: params.helpers.runWhitelistedScript,
    emitEvent: params.helpers.emitEvent,
    trimOutput: params.helpers.trimOutput,
  });

  return {
    state: {
      readPathState,
      writePathState,
      readOrchestrateSession,
      writeOrchestrateSession,
    },
    services: {
      configService,
    },
    controllers: {
      consistency,
      execution,
      agent,
      runner,
    },
  };
}
