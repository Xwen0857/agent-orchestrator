import path from "node:path";
import { resolveExistingPath, resolvePath, resolvePluginStateDir } from "./orchestrate-io.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { RuntimeSignatureFileSpec } from "./orchestrate-runtime-consistency.js";

type DashboardPluginConfigLike = {
  dashboardJsonPath: string;
  systemHealthJsonPath: string;
  plannerCurrentPath: string;
  plannerPropertiesPath: string;
  auditPolicyPath: string;
  configHistoryPath: string;
  snapshotScriptPath: string;
  rollbackScriptPath: string;
  agentRuntimeConfigPath: string;
};

export type OrchestratorBootstrapContext = {
  dataDir: string;
  eventsPath: string;
  lockPath: string;
  paths: {
    dashboardJson: string;
    systemHealthJson: string;
    orchestrateRequestsDir: string;
    orchestrateSessionsDir: string;
    pathState: string;
    taskFoldersRoot: string;
    plannerCurrent: string;
    plannerProperties: string;
    auditPolicy: string;
    history: string;
    snapshotScript: string;
    rollbackScript: string;
    agentRuntimeConfig: string;
    executionRuntime: string;
  };
  runnerLockPath: string;
  runtimeSignaturePath: string;
  runtimeSignatureFiles: RuntimeSignatureFileSpec[];
  externalRunnerScriptPath: string;
};

export function buildOrchestratorBootstrapContext(params: {
  api: OpenClawPluginApi;
  repoRoot: string;
  pluginDir: string;
  cfg: DashboardPluginConfigLike;
  defaults: {
    requestsPath: string;
    tasksRoot: string;
  };
}): OrchestratorBootstrapContext {
  const { api, repoRoot, pluginDir, cfg, defaults } = params;
  const dataDir = path.join(resolvePluginStateDir(api), "plugins", "orchestrator-dashboard");
  const eventsPath = path.join(dataDir, "events.ndjson");
  const lockPath = path.join(dataDir, ".commit.lock");

  const paths = {
    dashboardJson: resolvePath(repoRoot, cfg.dashboardJsonPath),
    systemHealthJson: resolvePath(repoRoot, cfg.systemHealthJsonPath),
    orchestrateRequestsDir: resolvePath(repoRoot, defaults.requestsPath),
    orchestrateSessionsDir: resolvePath(repoRoot, "templates/coordination/orchestrator/sessions"),
    pathState: resolvePath(repoRoot, "templates/coordination/orchestrator/requests/path_state.json"),
    taskFoldersRoot: resolvePath(repoRoot, defaults.tasksRoot),
    plannerCurrent: resolvePath(repoRoot, cfg.plannerCurrentPath),
    plannerProperties: resolvePath(repoRoot, cfg.plannerPropertiesPath),
    auditPolicy: resolvePath(repoRoot, cfg.auditPolicyPath),
    history: resolvePath(repoRoot, cfg.configHistoryPath),
    snapshotScript: resolvePath(repoRoot, cfg.snapshotScriptPath),
    rollbackScript: resolvePath(repoRoot, cfg.rollbackScriptPath),
    agentRuntimeConfig: resolvePath(repoRoot, cfg.agentRuntimeConfigPath),
    executionRuntime: resolvePath(repoRoot, "templates/coordination/orchestrator/execution_runtime.json"),
  };

  const runnerLockPath = resolvePath(
    repoRoot,
    "templates/coordination/orchestrator/.orchestrate-runner.lock",
  );
  const runtimeSignaturePath = resolveExistingPath([
    path.join(pluginDir, "runtime.signature.json"),
    resolvePath(repoRoot, "extensions/orchestrator-dashboard/runtime.signature.json"),
  ]);
  const runtimeSignatureFiles: RuntimeSignatureFileSpec[] = [
    {
      id: "extensions/orchestrator-dashboard/index.ts",
      candidates: [
        path.join(pluginDir, "index.ts"),
        path.join(pluginDir, "index.js"),
        resolvePath(repoRoot, "extensions/orchestrator-dashboard/index.ts"),
        resolvePath(repoRoot, "extensions/orchestrator-dashboard/index.js"),
      ],
    },
    {
      id: "extensions/orchestrator-dashboard/orchestrate-command.ts",
      candidates: [
        path.join(pluginDir, "orchestrate-command.ts"),
        path.join(pluginDir, "orchestrate-command.js"),
        resolvePath(repoRoot, "extensions/orchestrator-dashboard/orchestrate-command.ts"),
        resolvePath(repoRoot, "extensions/orchestrator-dashboard/orchestrate-command.js"),
      ],
    },
    {
      id: "extensions/orchestrator-dashboard/openclaw.plugin.json",
      candidates: [
        path.join(pluginDir, "openclaw.plugin.json"),
        resolvePath(repoRoot, "extensions/orchestrator-dashboard/openclaw.plugin.json"),
      ],
    },
  ];
  const externalRunnerScriptPath = resolvePath(
    repoRoot,
    "agent-orchestrator/scripts/orchestrate_runner_daemon.sh",
  );

  return {
    dataDir,
    eventsPath,
    lockPath,
    paths,
    runnerLockPath,
    runtimeSignaturePath,
    runtimeSignatureFiles,
    externalRunnerScriptPath,
  };
}
