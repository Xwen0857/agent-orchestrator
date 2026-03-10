/**
 * Plugin entrypoint for the orchestrator dashboard package.
 * This file wires host APIs, runtime controllers, command handlers, and HTTP routes
 * into one registration surface without owning business logic itself.
 * Non-trivial orchestration rules live in the imported runtime modules.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWhitelistedScript } from "./orchestrate-command.js";
import { registerOrchestratorHttpRoutes } from "./orchestrate-http.js";
import { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import { handleOrchestrateCommand } from "./orchestrate-command-router.js";
import { handleBeforeAgentStartHook } from "./orchestrate-session-agent-hook.js";
import { registerOrchestratorOverviewGatewayMethod } from "./orchestrate-overview-gateway.js";
import {
  buildOrchestratePluginRuntime,
  buildOrchestratePluginRuntimeInput,
} from "./orchestrate-plugin-runtime.js";
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

    // Reuse one assembled runtime so command, hook, gateway, and HTTP entrypoints
    // all observe the same files and consistency checks.
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
        executionRuntimePath: paths.executionRuntime,
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

    const pluginRuntime = buildOrchestratePluginRuntime(buildOrchestratePluginRuntimeInput({
      api,
      repoRoot,
      basePath,
      apiBasePath,
      cfg: {
        runnerEnabled: cfg.runnerEnabled,
        runnerFallbackEnabled: cfg.runnerFallbackEnabled,
        requireGatewayAuth: cfg.requireGatewayAuth,
      },
      bootstrap,
      assembly: bootstrapAssembly,
      io,
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
    }));
    const commandHandlers = createOrchestrateCommandHandlers(pluginRuntime.commandDeps);

    api.on("before_agent_start", async (event, ctx) => {
      return handleBeforeAgentStartHook({
        event,
        ctx,
        repoRoot,
        taskFoldersRoot: pluginRuntime.hookDeps.taskFoldersRoot,
        entryAgentDecodeContractPath: pluginRuntime.hookDeps.entryAgentDecodeContractPath,
        readOrchestrateSession: pluginRuntime.hookDeps.readOrchestrateSession,
        writeOrchestrateSession: pluginRuntime.hookDeps.writeOrchestrateSession,
        statePaths: pluginRuntime.hookDeps.statePaths,
        io: pluginRuntime.hookDeps.io,
        runWhitelistedScript: pluginRuntime.hookDeps.runWhitelistedScript,
        getConsistencySnapshot: bootstrapAssembly.controllers.consistency.getSnapshot,
        emitEvent: pluginRuntime.hookDeps.emitEvent,
      });
    });

    api.registerCommand({
      name: "orchestrate",
      description: "Run orchestrator entry agent: /orchestrate start|summary|run|status|help",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) =>
        handleOrchestrateCommand({
          ctx,
          commandHandlers,
          consistency: bootstrapAssembly.controllers.consistency,
          renderOrchestrateHelp,
        }),
    });

    registerOrchestratorHttpRoutes(pluginRuntime.httpDeps);

    registerOrchestratorOverviewGatewayMethod(pluginRuntime.overviewDeps);

    api.logger.info(
      `orchestrator-dashboard: mounted ui=${basePath} api=${apiBasePath} repoRoot=${repoRoot}`,
    );
  },
};

export default orchestratorDashboardPlugin;
