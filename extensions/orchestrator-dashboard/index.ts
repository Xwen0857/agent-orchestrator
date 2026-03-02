import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWhitelistedScript } from "./orchestrate-command.js";
import { parseOrchestrateArgs } from "./orchestrate-session.js";
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
  updateListKvText,
  updatePlainKvText,
} from "./orchestrate-config-service.js";
import { buildOrchestratorBootstrapContext } from "./orchestrate-bootstrap-context.js";
import { buildOrchestratorBootstrapAssembly } from "./orchestrate-bootstrap-assembly.js";
import {
  configSchema,
  DEFAULT_REQUESTS_PATH,
  DEFAULT_TASKS_ROOT,
  parsePluginConfig,
} from "./orchestrate-plugin-config.js";
import {
  buildWorkerIdFromTaskId,
  renderOrchestrateHelp,
  renderRequiredConfigChecklist,
} from "./orchestrate-ui-helpers.js";
const RUNTIME_MISMATCH_CODE = "ORCHESTRATOR_RUNTIME_MISMATCH";

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

    const basePath = cfg.basePath;
    const apiBasePath = cfg.apiBasePath;
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
    const runnerTasksRootArg = path.relative(repoRoot, paths.taskFoldersRoot) || ".";

    const emitEvent = createOrchestratorEventEmitter({
      eventsPath,
      io: {
        appendNdjson: io.appendNdjson,
      },
    });
    const bootstrapAssembly = buildOrchestratorBootstrapAssembly({
      api,
      repoRoot,
      lockPath,
      paths,
      runnerLockPath,
      externalRunnerScriptPath: bootstrap.externalRunnerScriptPath,
      runtimeSignaturePath,
      runtimeSignatureFiles,
      cfg: {
        runtimeConsistencyMode: cfg.runtimeConsistencyMode,
        runnerEnabled: cfg.runnerEnabled,
        runnerFallbackEnabled: cfg.runnerFallbackEnabled,
        runnerFallbackMode: cfg.runnerFallbackMode,
        runnerIntervalSec: cfg.runnerIntervalSec,
        runnerExecutionMode: cfg.runnerExecutionMode,
        runnerBatchSize: cfg.runnerBatchSize,
        runnerMaxParallel: cfg.runnerMaxParallel,
        runnerTasksRootArg,
      },
      io,
      helpers: {
        emitEvent,
        runWhitelistedScript,
        trimOutput,
      },
      mismatchCode: RUNTIME_MISMATCH_CODE,
    });
    bootstrapAssembly.controllers.runner.kickoffOnStartup();

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
        ...bootstrapAssembly.state,
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
        ...bootstrapAssembly.controllers,
      },
      configService: bootstrapAssembly.services.configService,
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
        readOrchestrateSession: bootstrapAssembly.state.readOrchestrateSession,
        writeOrchestrateSession: bootstrapAssembly.state.writeOrchestrateSession,
      });
    });

    api.registerCommand({
      name: "orchestrate",
      description: "Run orchestrator entry agent: /orchestrate start|summary|run|status|help",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => {
        await bootstrapAssembly.controllers.consistency.startupConsistencyPromise;
        if (bootstrapAssembly.controllers.consistency.getStartupError()) {
          return { text: bootstrapAssembly.controllers.consistency.getStartupError() };
        }
        const parsed = parseOrchestrateArgs(ctx.args);
        try {
          await bootstrapAssembly.controllers.consistency.assertRuntimeConsistency("command");
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
          return {
            text: await commandHandlers.handleStatus(parsed.payload),
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
          return {
            text: await commandHandlers.handleRun(parsed.payload, ctx),
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
