import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWhitelistedScript } from "./orchestrate-command.js";
import { parseOrchestrateArgs, type OrchestrateSessionState } from "./orchestrate-session.js";
import { type PathState } from "./orchestrate-path.js";
import { registerOrchestratorHttpRoutes } from "./orchestrate-http.js";
import { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import { handleBeforeAgentStartHook } from "./orchestrate-session-agent-hook.js";
import { registerOrchestratorOverviewGatewayMethod } from "./orchestrate-overview-gateway.js";
import { buildOrchestratePluginRuntime } from "./orchestrate-plugin-runtime.js";
import { createOrchestratorEventEmitter } from "./orchestrate-events.js";
import {
  createDefaultOrchestrateIo,
  trimOutput,
} from "./orchestrate-io.js";
import {
  readOrchestrateSessionStore,
  readPathStateStore,
  writeOrchestrateSessionStore,
  writePathStateStore,
} from "./orchestrate-state.js";
import {
  buildRuntimeConsistencyController,
} from "./orchestrate-runtime-consistency.js";
import {
  createConfigService,
  updateListKvText,
  updatePlainKvText,
} from "./orchestrate-config-service.js";
import { buildExecutionRuntimeReader } from "./orchestrate-execution-runtime.js";
import { buildAgentRuntimeController } from "./orchestrate-agent-runtime.js";
import { buildRunnerRuntimeController } from "./orchestrate-runner-runtime.js";
import { buildOrchestratorBootstrapContext } from "./orchestrate-bootstrap-context.js";

type DashboardPluginConfig = {
  enabled: boolean;
  repoRoot: string;
  basePath: string;
  apiBasePath: string;
  dashboardJsonPath: string;
  systemHealthJsonPath: string;
  plannerCurrentPath: string;
  plannerPropertiesPath: string;
  auditPolicyPath: string;
  configHistoryPath: string;
  snapshotScriptPath: string;
  rollbackScriptPath: string;
  requireGatewayAuth: boolean;
  runnerEnabled: boolean;
  runnerIntervalSec: number;
  runnerExecutionMode: "local_threads" | "container" | "distributed";
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeConsistencyMode: "enforce" | "warn";
  runnerFallbackEnabled: boolean;
  runnerFallbackMode: "external_daemon" | "none";
  agentRuntimeConfigPath: string;
};

const DEFAULT_REPO_ROOT = process.env.OPENCLAW_ORCHESTRATOR_REPO_ROOT?.trim() || process.cwd();
const DEFAULT_BASE_PATH = "/plugins/orchestrator";
const DEFAULT_API_BASE_PATH = "/api/plugins/orchestrator";
const DEFAULT_REQUESTS_PATH = "templates/coordination/orchestrator/requests";
const DEFAULT_TASKS_ROOT = "templates/coordination/tasks/task_folders";
const DEFAULT_RUNNER_INTERVAL_SEC = 10;
const DEFAULT_AGENT_RUNTIME_CONFIG_PATH = "templates/coordination/orchestrator/agent_runtime.json";
const RUNTIME_MISMATCH_CODE = "ORCHESTRATOR_RUNTIME_MISMATCH";

const configSchema = {
  safeParse(value: unknown) {
    const normalized = parsePluginConfig(value);
    return { success: true as const, data: normalized };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      repoRoot: { type: "string" },
      basePath: { type: "string", default: DEFAULT_BASE_PATH },
      apiBasePath: { type: "string", default: DEFAULT_API_BASE_PATH },
      dashboardJsonPath: { type: "string" },
      systemHealthJsonPath: { type: "string" },
      plannerCurrentPath: { type: "string" },
      plannerPropertiesPath: { type: "string" },
      auditPolicyPath: { type: "string" },
      configHistoryPath: { type: "string" },
      snapshotScriptPath: { type: "string" },
      rollbackScriptPath: { type: "string" },
      requireGatewayAuth: { type: "boolean", default: true },
      runnerEnabled: { type: "boolean", default: true },
      runnerIntervalSec: { type: "number", default: DEFAULT_RUNNER_INTERVAL_SEC },
      runnerExecutionMode: { type: "string", default: "local_threads" },
      runnerBatchSize: { type: "number", default: 4 },
      runnerMaxParallel: { type: "number", default: 2 },
      runtimeConsistencyMode: { type: "string", default: "enforce" },
      runnerFallbackEnabled: { type: "boolean", default: true },
      runnerFallbackMode: { type: "string", default: "external_daemon" },
      agentRuntimeConfigPath: { type: "string", default: DEFAULT_AGENT_RUNTIME_CONFIG_PATH },
    },
  },
};

function parsePluginConfig(value: unknown): DashboardPluginConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const repoRoot = asString(raw.repoRoot, DEFAULT_REPO_ROOT);
  const basePath = ensureLeadingSlash(asString(raw.basePath, DEFAULT_BASE_PATH));
  const apiBasePath = ensureLeadingSlash(asString(raw.apiBasePath, DEFAULT_API_BASE_PATH));

  return {
    enabled: asBoolean(raw.enabled, true),
    repoRoot,
    basePath,
    apiBasePath,
    dashboardJsonPath: asString(
      raw.dashboardJsonPath,
      "templates/coordination/orchestrator/dashboard.json",
    ),
    systemHealthJsonPath: asString(
      raw.systemHealthJsonPath,
      "templates/coordination/orchestrator/system-health.json",
    ),
    plannerCurrentPath: asString(
      raw.plannerCurrentPath,
      "templates/coordination/planner/config/current.md",
    ),
    plannerPropertiesPath: asString(
      raw.plannerPropertiesPath,
      "templates/coordination/planner/properties.md",
    ),
    auditPolicyPath: asString(
      raw.auditPolicyPath,
      "templates/coordination/audit/policy/current.json",
    ),
    configHistoryPath: asString(
      raw.configHistoryPath,
      "templates/coordination/planner/config/history/versions.ndjson",
    ),
    snapshotScriptPath: asString(
      raw.snapshotScriptPath,
      "agent-orchestrator/scripts/config_snapshot.sh",
    ),
    rollbackScriptPath: asString(
      raw.rollbackScriptPath,
      "agent-orchestrator/scripts/config_rollback.sh",
    ),
    requireGatewayAuth: asBoolean(raw.requireGatewayAuth, true),
    runnerEnabled: asBoolean(raw.runnerEnabled, true),
    runnerIntervalSec: asPositiveInt(raw.runnerIntervalSec, DEFAULT_RUNNER_INTERVAL_SEC),
    runnerExecutionMode: asExecutionMode(raw.runnerExecutionMode, "local_threads"),
    runnerBatchSize: asPositiveInt(raw.runnerBatchSize, 4),
    runnerMaxParallel: asPositiveInt(raw.runnerMaxParallel, 2),
    runtimeConsistencyMode: asConsistencyMode(raw.runtimeConsistencyMode, "enforce"),
    runnerFallbackEnabled: asBoolean(raw.runnerFallbackEnabled, true),
    runnerFallbackMode: asRunnerFallbackMode(raw.runnerFallbackMode, "external_daemon"),
    agentRuntimeConfigPath: asString(raw.agentRuntimeConfigPath, DEFAULT_AGENT_RUNTIME_CONFIG_PATH),
  };
}

function asString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function asExecutionMode(
  value: unknown,
  fallback: "local_threads" | "container" | "distributed",
): "local_threads" | "container" | "distributed" {
  const normalized = asString(value, fallback).toLowerCase();
  if (
    normalized === "local_threads" ||
    normalized === "container" ||
    normalized === "distributed"
  ) {
    return normalized;
  }
  return fallback;
}

function asConsistencyMode(value: unknown, fallback: "enforce" | "warn"): "enforce" | "warn" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "enforce" || normalized === "warn") {
    return normalized;
  }
  return fallback;
}

function asRunnerFallbackMode(
  value: unknown,
  fallback: "external_daemon" | "none",
): "external_daemon" | "none" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "external_daemon" || normalized === "none") {
    return normalized;
  }
  return fallback;
}

function ensureLeadingSlash(input: string): string {
  if (!input) {
    return "/";
  }
  return input.startsWith("/") ? input : `/${input}`;
}

function normalizeResponseJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed.replace(/^```[a-zA-Z]*\n?/u, "").replace(/\n?```$/u, "");
    return stripped.trim();
  }
  return trimmed;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function renderOrchestrateHelp(): string {
  return [
    "/orchestrate start",
    "/orchestrate summary",
    "/orchestrate run",
    "/orchestrate stop",
    "/orchestrate session",
    "/orchestrate intake <free text> (legacy helper)",
    "/orchestrate status <task_id>",
    "/orchestrate status",
    "/orchestrate path set --project-id <project_id> --workspace-root <relative_path_under_projects>",
    "/orchestrate path get --project-id <project_id>",
    "/orchestrate path clear --project-id <project_id>",
    "/orchestrate path list",
    "/orchestrate amend <task_id> <extra requirement>",
    "/orchestrate kb-sync <task_id> [approve|deny|auto-on|auto-off]",
    "/orchestrate help",
  ].join("\n");
}

function renderRequiredConfigChecklist(): string {
  return [
    "required_config:",
    "- planner_current: version, state_machine, transition_script, audit_gate_script",
    "- planner_properties: worker_timeout_minutes, stale_in_progress_minutes, dashboard_refresh_minutes",
    "- audit_policy: rules[]",
    "- worker_profile: task-scoped worker id enabled",
  ].join("\n");
}

function buildWorkerIdFromTaskId(taskId: string): string {
  const raw = taskId
    .replace(/^task_/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return `worker_${raw || "generic"}`;
}

const orchestratorDashboardPlugin = {
  id: "orchestrator-dashboard",
  name: "Orchestrator Dashboard",
  description: "Dashboard + Config Studio for orchestrator files",
  configSchema,
  register(api: OpenClawPluginApi) {
    const cfg = parsePluginConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info("orchestrator-dashboard: disabled by config");
      return;
    }

    const basePath = ensureLeadingSlash(cfg.basePath);
    const apiBasePath = ensureLeadingSlash(cfg.apiBasePath);
    const repoRoot = cfg.repoRoot;
    const pluginDir = path.dirname(fileURLToPath(import.meta.url));
    const io = createDefaultOrchestrateIo();
    const bootstrap = buildOrchestratorBootstrapContext({
      api,
      repoRoot,
      pluginDir,
      cfg,
      defaults: {
        requestsPath: DEFAULT_REQUESTS_PATH,
        tasksRoot: DEFAULT_TASKS_ROOT,
      },
    });
    const { eventsPath, lockPath, paths, runnerLockPath, runtimeSignaturePath, runtimeSignatureFiles } =
      bootstrap;
    const runnerIntervalSec = asPositiveInt(cfg.runnerIntervalSec, DEFAULT_RUNNER_INTERVAL_SEC);
    const runnerTasksRootArg = path.relative(repoRoot, paths.taskFoldersRoot) || ".";
    const runnerExecutionMode = asExecutionMode(cfg.runnerExecutionMode, "local_threads");
    const runnerBatchSize = asPositiveInt(cfg.runnerBatchSize, 4);
    const runnerMaxParallel = asPositiveInt(cfg.runnerMaxParallel, 2);

    const emitEvent = createOrchestratorEventEmitter({
      eventsPath,
      io: {
        appendNdjson: io.appendNdjson,
      },
    });

    const runtimeConsistencyController = buildRuntimeConsistencyController({
      runtimeSignatureFiles,
      runtimeSignaturePath,
      consistencyMode: cfg.runtimeConsistencyMode,
      readJsonOrDefault: io.readJsonOrDefault,
      readText: io.readText,
      emitEvent,
      mismatchCode: RUNTIME_MISMATCH_CODE,
    });
    const executionRuntimeReader = buildExecutionRuntimeReader({
      repoRoot,
      paths: {
        executionRuntime: paths.executionRuntime,
        dashboardJson: paths.dashboardJson,
      },
      io: {
        fileExists: io.fileExists,
        readJsonOrDefault: io.readJsonOrDefault,
        readText: io.readText,
      },
    });
    const agentRuntimeController = buildAgentRuntimeController({
      api,
      paths: {
        agentRuntimeConfig: paths.agentRuntimeConfig,
      },
      io: {
        readJsonOrDefault: io.readJsonOrDefault,
      },
      emitEvent,
      trimOutput,
    });
    const runnerRuntimeController = buildRunnerRuntimeController({
      repoRoot,
      runnerLockPath,
      externalRunnerScriptPath: bootstrap.externalRunnerScriptPath,
      startupConsistencyPromise: runtimeConsistencyController.startupConsistencyPromise,
      cfg: {
        runnerEnabled: cfg.runnerEnabled,
        runnerFallbackEnabled: cfg.runnerFallbackEnabled,
        runnerFallbackMode: cfg.runnerFallbackMode,
        runnerIntervalSec,
        runnerExecutionMode,
        runnerBatchSize,
        runnerMaxParallel,
        runnerTasksRootArg,
      },
      io: {
        fileExists: io.fileExists,
        readText: io.readText,
        runScript: io.runScript,
      },
      runWhitelistedScript,
      emitEvent,
      trimOutput,
    });
    runnerRuntimeController.kickoffOnStartup();

    const readPathState = async (): Promise<PathState> => {
      return readPathStateStore({
        io: {
          fileExists: io.fileExists,
          readJsonOrDefault: io.readJsonOrDefault,
          writeJsonAtomic: io.writeJsonAtomic,
        },
        paths,
      });
    };

    const writePathState = async (next: PathState): Promise<void> => {
      await writePathStateStore({
        io: {
          fileExists: io.fileExists,
          readJsonOrDefault: io.readJsonOrDefault,
          writeJsonAtomic: io.writeJsonAtomic,
        },
        paths,
        state: next,
      });
    };

    const readOrchestrateSession = async (
      sessionKey: string,
    ): Promise<OrchestrateSessionState | null> => {
      return readOrchestrateSessionStore({
        io: {
          fileExists: io.fileExists,
          readJsonOrDefault: io.readJsonOrDefault,
          writeJsonAtomic: io.writeJsonAtomic,
        },
        paths,
        sessionKey,
      });
    };

    const writeOrchestrateSession = async (next: OrchestrateSessionState): Promise<void> => {
      await writeOrchestrateSessionStore({
        io: {
          fileExists: io.fileExists,
          readJsonOrDefault: io.readJsonOrDefault,
          writeJsonAtomic: io.writeJsonAtomic,
        },
        paths,
        session: next,
      });
    };

    const configService = createConfigService({
      paths: {
        plannerCurrent: paths.plannerCurrent,
        plannerProperties: paths.plannerProperties,
        auditPolicy: paths.auditPolicy,
      },
      lockPath,
      io: {
        readText: io.readText,
        readJsonOrDefault: io.readJsonOrDefault,
      },
    });

    const pluginRuntime = buildOrchestratePluginRuntime({
      api,
      repoRoot,
      basePath,
      apiBasePath,
      cfg: {
        runnerEnabled: cfg.runnerEnabled,
        runnerFallbackEnabled: cfg.runnerFallbackEnabled,
        requireGatewayAuth: cfg.requireGatewayAuth,
      },
      paths: {
        statePaths: {
          pathState: paths.pathState,
          orchestrateSessionsDir: paths.orchestrateSessionsDir,
          orchestrateRequestsDir: paths.orchestrateRequestsDir,
        },
        command: {
          orchestrateRequestsDir: paths.orchestrateRequestsDir,
          taskFoldersRoot: paths.taskFoldersRoot,
          dashboardJson: paths.dashboardJson,
          systemHealthJson: paths.systemHealthJson,
          executionRuntime: paths.executionRuntime,
        },
        httpRoutePaths: {
          ...paths,
        },
        httpNames: {
          dashboardJson: paths.dashboardJson,
          systemHealthJson: paths.systemHealthJson,
          plannerCurrent: paths.plannerCurrent,
          plannerProperties: paths.plannerProperties,
          auditPolicy: paths.auditPolicy,
          auditHistory: paths.history,
          snapshotScript: paths.snapshotScript,
          rollbackScript: paths.rollbackScript,
        },
        eventsPath,
        overview: {
          dashboardJson: paths.dashboardJson,
          systemHealthJson: paths.systemHealthJson,
        },
      },
      state: {
        readOrchestrateSession,
        writeOrchestrateSession,
        readPathState,
        writePathState,
      },
      io: {
        fileExists: io.fileExists,
        readJsonOrDefault: io.readJsonOrDefault,
        writeJsonAtomic: io.writeJsonAtomic,
        readNdjson: io.readNdjson,
        readText: io.readText,
        writeTextAtomic: io.writeTextAtomic,
      },
      controllers: {
        runner: runnerRuntimeController,
        execution: executionRuntimeReader,
        consistency: runtimeConsistencyController,
        agent: agentRuntimeController,
      },
      configService,
      helpers: {
        emitEvent,
        runWhitelistedScript,
        runScript: io.runScript,
        buildWorkerIdFromTaskId,
        trimOutput,
        renderRequiredConfigChecklist,
        renderOrchestrateHelp,
        updatePlainKvText,
        updateListKvText,
      },
    });
    const commandHandlers = createOrchestrateCommandHandlers(pluginRuntime.commandDeps);

    api.on("before_agent_start", async (event, ctx) => {
      return handleBeforeAgentStartHook({
        event,
        ctx,
        readOrchestrateSession,
        writeOrchestrateSession,
      });
    });

    api.registerCommand({
      name: "orchestrate",
      description: "Run orchestrator entry agent: /orchestrate start|summary|run|status|help",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        await runtimeConsistencyController.startupConsistencyPromise;
        if (runtimeConsistencyController.getStartupError()) {
          return { text: runtimeConsistencyController.getStartupError() };
        }
        const parsed = parseOrchestrateArgs(ctx.args);
        let consistencyInfo: {
          runtimeConsistency: "ok" | "mismatch";
          runtimeSignature: string;
          expected: string;
        } | null = null;
        try {
          consistencyInfo = await runtimeConsistencyController.assertRuntimeConsistency("command");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { text: message };
        }
        if (parsed.subcommand === "help") {
          return { text: renderOrchestrateHelp() };
        }

        if (
          parsed.subcommand === "start" ||
          parsed.subcommand === "session" ||
          parsed.subcommand === "stop" ||
          parsed.subcommand === "summary"
        ) {
          return {
            text: await commandHandlers.handleSession(parsed.subcommand, ctx),
          };
        }

        if (parsed.subcommand === "path") {
          return {
            text: await commandHandlers.handlePath(parsed.payload, ctx.senderId),
          };
        }

        if (parsed.subcommand === "status") {
          const consistencySnapshot = runtimeConsistencyController.getSnapshot();
          return {
            text: await commandHandlers.handleStatus(parsed.payload, {
              runtimeConsistency:
                consistencyInfo?.runtimeConsistency || consistencySnapshot.runtimeConsistency,
              runtimeSignature: consistencySnapshot.runtimeSignature,
              runtimeExpectedSignature: consistencySnapshot.runtimeExpectedSignature,
            }),
          };
        }

        if (parsed.subcommand === "kb-sync") {
          return {
            text: await commandHandlers.handleKbSync(parsed.payload),
          };
        }

        if (parsed.subcommand === "intake") {
          return {
            text: await commandHandlers.handleIntake(parsed.payload, ctx),
          };
        }

        if (parsed.subcommand === "amend") {
          return {
            text: await commandHandlers.handleAmend(parsed.payload),
          };
        }

        if (parsed.subcommand === "run") {
          const consistencySnapshot = runtimeConsistencyController.getSnapshot();
          return {
            text: await commandHandlers.handleRun(parsed.payload, ctx, {
              runtimeConsistency:
                consistencyInfo?.runtimeConsistency || consistencySnapshot.runtimeConsistency,
              runtimeSignature: consistencySnapshot.runtimeSignature,
              runtimeExpectedSignature: consistencySnapshot.runtimeExpectedSignature,
            }),
          };
        }

        return { text: renderOrchestrateHelp() };
      },
    });

    registerOrchestratorHttpRoutes(pluginRuntime.httpDeps);

    registerOrchestratorOverviewGatewayMethod(pluginRuntime.overviewDeps);

    api.logger.info(
      `orchestrator-dashboard: mounted ui=${basePath} api=${apiBasePath} repoRoot=${repoRoot}`,
    );
  },
};

export default orchestratorDashboardPlugin;
