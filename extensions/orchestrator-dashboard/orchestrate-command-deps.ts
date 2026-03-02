import { handleAmendSubcommand } from "./orchestrate-amend-command.js";
import { handleIntakeSubcommand } from "./orchestrate-intake-command.js";
import { handleKbSyncSubcommand } from "./orchestrate-kb-sync-command.js";
import { handlePathSubcommand } from "./orchestrate-path-command.js";
import { handleRunSubcommand } from "./orchestrate-run-command.js";
import { handleStatusSubcommand } from "./orchestrate-status-command.js";
import type { PathState } from "./orchestrate-path.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import type {
  ExternalRunnerSnapshot,
  RuntimeStatsSnapshot,
} from "./orchestrate-response.js";

type CommandCtx = {
  channel?: string;
  senderId?: string;
  messageThreadId?: string | number;
  sessionKey?: string;
  commandTargetSessionKey?: string;
};

type CreateOrchestrateCommandHandlersParams = {
  repoRoot: string;
  basePath: string;
  cfg: {
    runnerEnabled: boolean;
    runnerFallbackEnabled: boolean;
  };
  runnerTimerActive: boolean;
  paths: {
    orchestrateRequestsDir: string;
    taskFoldersRoot: string;
    dashboardJson: string;
    systemHealthJson: string;
    executionRuntime: string;
  };
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  readPathState: () => Promise<PathState>;
  writePathState: (next: PathState) => Promise<void>;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
    readNdjson: (targetPath: string) => Promise<Array<Record<string, unknown>>>;
    readText: (targetPath: string) => Promise<string>;
    writeTextAtomic: (targetPath: string, payload: string) => Promise<void>;
  };
  runtime: {
    getRunnerLockMtime: () => Promise<string>;
    loadExecutionRuntime: () => Promise<RuntimeStatsSnapshot & { rolePolicyPath?: string; projectsRoot: string }>;
    getExternalRunnerStatus: () => Promise<ExternalRunnerSnapshot>;
    ensureRunnerStarted: () => Promise<{ schedulerStatus: string; lastTickAt: string; intervalSec: number }>;
    runnerStatus: string;
    runnerLastTickAt: string;
    runnerLastTickResult: string;
    runnerLastTickError: string;
    runnerIntervalSec: number;
    runnerExecutionMode: string;
    runnerBatchSize: number;
    runnerMaxParallel: number;
  };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "create_task_from_strategy"
      | "planner_entry"
      | "transition_task_state"
      | "dashboard_summary"
      | "kb_import_from_workspace"
      | "append_task_event";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  buildWorkerIdFromTaskId: (taskId: string) => string;
  trimOutput: (value: string) => string;
  renderRequiredConfigChecklist: () => string;
  renderOrchestrateHelp: () => string;
};

export function createOrchestrateCommandHandlers(
  params: CreateOrchestrateCommandHandlersParams,
) {
  return {
    handlePath: async (payload: string, senderId?: string): Promise<string> => {
      const runtimeStats = await params.runtime.loadExecutionRuntime();
      return handlePathSubcommand({
        payload,
        senderId,
        repoRoot: params.repoRoot,
        projectsRoot: runtimeStats.projectsRoot,
        readPathState: params.readPathState,
        writePathState: params.writePathState,
      });
    },
    handleStatus: async (
      payload: string,
      consistency: { runtimeConsistency: string; runtimeSignature: string; runtimeExpectedSignature: string },
    ): Promise<string> =>
      handleStatusSubcommand({
        payload,
        cfg: params.cfg,
        runnerTimerActive: params.runnerTimerActive,
        ensureRunnerStarted: params.runtime.ensureRunnerStarted,
        paths: {
          dashboardJson: params.paths.dashboardJson,
          systemHealthJson: params.paths.systemHealthJson,
          taskFoldersRoot: params.paths.taskFoldersRoot,
        },
        io: {
          fileExists: params.io.fileExists,
          readJsonOrDefault: params.io.readJsonOrDefault,
          readNdjson: params.io.readNdjson,
          readText: params.io.readText,
        },
        runtime: {
          getRunnerLockMtime: params.runtime.getRunnerLockMtime,
          loadExecutionRuntime: async () => {
            const stats = await params.runtime.loadExecutionRuntime();
            return {
              ...stats,
              rolePolicyPath: stats.rolePolicyPath ?? "",
            };
          },
          getExternalRunnerStatus: params.runtime.getExternalRunnerStatus,
          runnerStatus: params.runtime.runnerStatus,
          runnerLastTickAt: params.runtime.runnerLastTickAt,
          runnerLastTickResult: params.runtime.runnerLastTickResult,
          runnerLastTickError: params.runtime.runnerLastTickError,
          runnerIntervalSec: params.runtime.runnerIntervalSec,
          runnerExecutionMode: params.runtime.runnerExecutionMode,
          runnerBatchSize: params.runtime.runnerBatchSize,
          runnerMaxParallel: params.runtime.runnerMaxParallel,
          runtimeConsistency: consistency.runtimeConsistency,
          runtimeSignature: consistency.runtimeSignature,
          runtimeExpectedSignature: consistency.runtimeExpectedSignature,
        },
        renderOrchestrateHelp: params.renderOrchestrateHelp,
      }),
    handleKbSync: async (payload: string): Promise<string> =>
      handleKbSyncSubcommand({
        payload,
        repoRoot: params.repoRoot,
        paths: {
          taskFoldersRoot: params.paths.taskFoldersRoot,
          executionRuntime: params.paths.executionRuntime,
        },
        io: {
          fileExists: params.io.fileExists,
          readJsonOrDefault: params.io.readJsonOrDefault,
          writeJsonAtomic: params.io.writeJsonAtomic,
        },
        runWhitelistedScript: params.runWhitelistedScript,
        emitEvent: params.emitEvent,
      }),
    handleIntake: async (payload: string, ctx: CommandCtx): Promise<string> =>
      handleIntakeSubcommand({
        payload,
        ctx,
        readOrchestrateSession: params.readOrchestrateSession,
        writeOrchestrateSession: params.writeOrchestrateSession,
        emitEvent: params.emitEvent,
        renderOrchestrateHelp: params.renderOrchestrateHelp,
      }),
    handleAmend: async (payload: string): Promise<string> =>
      handleAmendSubcommand({
        payload,
        repoRoot: params.repoRoot,
        taskFoldersRoot: params.paths.taskFoldersRoot,
        io: {
          fileExists: params.io.fileExists,
          readText: params.io.readText,
          writeTextAtomic: params.io.writeTextAtomic,
        },
        runWhitelistedScript: params.runWhitelistedScript,
        emitEvent: params.emitEvent,
      }),
    handleRun: async (
      payload: string,
      ctx: CommandCtx,
      consistency: { runtimeConsistency: string; runtimeSignature: string; runtimeExpectedSignature: string },
    ): Promise<string> =>
      handleRunSubcommand({
        payload,
        ctx,
        repoRoot: params.repoRoot,
        basePath: params.basePath,
        paths: {
          orchestrateRequestsDir: params.paths.orchestrateRequestsDir,
          taskFoldersRoot: params.paths.taskFoldersRoot,
        },
        readOrchestrateSession: params.readOrchestrateSession,
        writeOrchestrateSession: params.writeOrchestrateSession,
        readPathState: params.readPathState,
        readJsonOrDefault: params.io.readJsonOrDefault,
        writeJsonAtomic: params.io.writeJsonAtomic,
        runWhitelistedScript: params.runWhitelistedScript,
        emitEvent: params.emitEvent,
        buildWorkerIdFromTaskId: params.buildWorkerIdFromTaskId,
        trimOutput: params.trimOutput,
        loadExecutionRuntime: params.runtime.loadExecutionRuntime,
        ensureRunnerStarted: params.runtime.ensureRunnerStarted,
        getExternalRunnerStatus: params.runtime.getExternalRunnerStatus,
        runtime: {
          runnerExecutionMode: params.runtime.runnerExecutionMode,
          runnerBatchSize: params.runtime.runnerBatchSize,
          runnerMaxParallel: params.runtime.runnerMaxParallel,
          runnerLastTickResult: params.runtime.runnerLastTickResult,
          runnerLastTickError: params.runtime.runnerLastTickError,
          runtimeConsistency: consistency.runtimeConsistency,
          runtimeSignature: consistency.runtimeSignature,
          runtimeExpectedSignature: consistency.runtimeExpectedSignature,
          runnerFallbackEnabled: params.cfg.runnerFallbackEnabled,
        },
        renderRequiredConfigChecklist: params.renderRequiredConfigChecklist,
      }),
  };
}
