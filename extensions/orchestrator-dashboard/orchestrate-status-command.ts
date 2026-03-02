import {
  renderTaskStatusResponse,
  type ExternalRunnerSnapshot,
  type RuntimeStatsSnapshot,
} from "./orchestrate-response.js";
import { buildTaskStatusResponseParams } from "./orchestrate-view-model.js";
import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";
import type { RunnerSnapshot } from "./orchestrate-runner-runtime.js";

type StatusPaths = {
  dashboardJson: string;
  systemHealthJson: string;
  taskFoldersRoot: string;
};

type HandleStatusSubcommandParams = {
  payload: string;
  cfg: {
    runnerEnabled: boolean;
    runnerFallbackEnabled: boolean;
  };
  ensureRunnerStarted: () => Promise<unknown>;
  paths: StatusPaths;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    readNdjson: (targetPath: string) => Promise<Array<Record<string, unknown>>>;
    readText: (targetPath: string) => Promise<string>;
  };
  runtime: {
    getRunnerLockMtime: () => Promise<string>;
    loadExecutionRuntime: () => Promise<RuntimeStatsSnapshot & { rolePolicyPath: string }>;
    getExternalRunnerStatus: () => Promise<ExternalRunnerSnapshot>;
    getRunnerSnapshot: () => RunnerSnapshot;
    getConsistencySnapshot: () => RuntimeConsistencySnapshot;
  };
  renderOrchestrateHelp: () => string;
};

export async function handleStatusSubcommand(
  params: HandleStatusSubcommandParams,
): Promise<string> {
  const { payload, cfg, ensureRunnerStarted, paths, io, runtime } = params;

  if (cfg.runnerEnabled && !runtime.getRunnerSnapshot().runnerTimerActive) {
    try {
      await ensureRunnerStarted();
    } catch {
      // keep status query non-fatal
    }
  }
  const runnerSnapshot = runtime.getRunnerSnapshot();

  const taskId = payload.trim();
  if (!taskId) {
    const consistencySnapshot = runtime.getConsistencySnapshot();
    const [dashboard, health, lockMtime, runtimeStats, externalRunner] = await Promise.all([
      io.readJsonOrDefault<Record<string, unknown>>(paths.dashboardJson, {}),
      io.readJsonOrDefault<Record<string, unknown>>(paths.systemHealthJson, {}),
      runtime.getRunnerLockMtime(),
      runtime.loadExecutionRuntime(),
      runtime.getExternalRunnerStatus(),
    ]);
    const active = Array.isArray(dashboard.active_pipelines) ? dashboard.active_pipelines : [];
    const top = active.slice(0, 5).map((item) => {
      const row = item as Record<string, unknown>;
      const task = String(row.task_id ?? "unknown");
      const state = String(row.state ?? "UNKNOWN");
      const owner = String(row.owner ?? "n/a");
      return `- ${task} ${state} owner=${owner}`;
    });
    return [
      `active_tasks: ${String(active.length)}`,
      `system_status: ${String((health as Record<string, unknown>).status ?? "UNKNOWN")}`,
      `scheduler_status: ${runnerSnapshot.runnerStatus}`,
      `last_tick_at: ${runnerSnapshot.runnerLastTickAt || "(none)"}`,
      `last_tick_result: ${runnerSnapshot.runnerLastTickResult}${runnerSnapshot.runnerLastTickError ? ` (${runnerSnapshot.runnerLastTickError})` : ""}`,
      `runner_interval_sec: ${String(runnerSnapshot.runnerIntervalSec)}`,
      `runner_execution_mode: ${runnerSnapshot.runnerExecutionMode}`,
      `runner_batch_size: ${String(runnerSnapshot.runnerBatchSize)}`,
      `runner_max_parallel: ${String(runnerSnapshot.runnerMaxParallel)}`,
      `logical_threads: ${String(runtimeStats.logicalThreads)}`,
      `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
      `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
      `queue_depth: ${String(runtimeStats.queueDepth)}`,
      `policy_mode: ${runtimeStats.policyMode}`,
      `role_policy_path: ${runtimeStats.rolePolicyPath}`,
      `workspace_root: ${runtimeStats.workdomainRoot}`,
      `projects_root: ${runtimeStats.projectsRoot}`,
      `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
      `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
      `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
      `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
      `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
      `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
      `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
      `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
      `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
      `acl_denied_count: ${String(runtimeStats.aclDeniedCount)}`,
      `acl_last_denied_at: ${runtimeStats.aclLastDeniedAt || "(none)"}`,
      `runner_lock_mtime: ${lockMtime || "(none)"}`,
      `runtime_consistency: ${consistencySnapshot.runtimeConsistency}`,
      `runtime_signature: ${consistencySnapshot.runtimeSignature || "(none)"}`,
      `runtime_expected_signature: ${consistencySnapshot.runtimeExpectedSignature || "(none)"}`,
      `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
      `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
      `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
      `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
      runnerSnapshot.runnerStatus === "degraded" && cfg.runnerFallbackEnabled
        ? "runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10"
        : "runner_fallback_hint: (none)",
      top.length > 0 ? "top_active:" : "top_active: (none)",
      ...top,
    ].join("\n");
  }

  if (!/^[A-Za-z0-9._-]+$/u.test(taskId)) {
    return `invalid task_id\n\n${params.renderOrchestrateHelp()}`;
  }

  const taskDir = `${paths.taskFoldersRoot}/${taskId}`;
  const metaPath = `${taskDir}/meta.json`;
  const logPath = `${taskDir}/log.ndjson`;
  const amendmentsPath = `${taskDir}/amendments.md`;
  if (!(await io.fileExists(metaPath))) {
    return `task not found: ${taskId}`;
  }

  const meta = await io.readJsonOrDefault<Record<string, unknown>>(metaPath, {});
  const events = await io.readNdjson(logPath);
  let amendmentCount = 0;
  let lastAmendment = "";
  if (await io.fileExists(amendmentsPath)) {
    const raw = await io.readText(amendmentsPath);
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    amendmentCount = lines.length;
    lastAmendment = (lines[lines.length - 1] ?? "").replace(/^- /u, "");
  }
  const recent = events.slice(-3).map((entry) => {
    const action = String(entry.action ?? "UNKNOWN");
    const afterState = String(entry.after_state ?? "");
    const timestamp = String(entry.timestamp ?? "");
    return `${timestamp} ${action} ${afterState}`.trim();
  });
  const [lockMtime, runtimeStats, externalRunner] = await Promise.all([
    runtime.getRunnerLockMtime(),
    runtime.loadExecutionRuntime(),
    runtime.getExternalRunnerStatus(),
  ]);
  const consistencySnapshot = runtime.getConsistencySnapshot();

  return renderTaskStatusResponse(
    buildTaskStatusResponseParams({
      taskId,
      meta,
      runnerStatus: runnerSnapshot.runnerStatus,
      runnerLastTickAt: runnerSnapshot.runnerLastTickAt,
      runnerLastTickResult: runnerSnapshot.runnerLastTickResult,
      runnerLastTickError: runnerSnapshot.runnerLastTickError,
      runnerIntervalSec: runnerSnapshot.runnerIntervalSec,
      runnerExecutionMode: runnerSnapshot.runnerExecutionMode,
      runnerBatchSize: runnerSnapshot.runnerBatchSize,
      runnerMaxParallel: runnerSnapshot.runnerMaxParallel,
      runtimeStats,
      lockMtime,
      runtimeConsistency: consistencySnapshot.runtimeConsistency,
      runtimeSignature: consistencySnapshot.runtimeSignature,
      runtimeExpectedSignature: consistencySnapshot.runtimeExpectedSignature,
      externalRunner,
      runnerFallbackEnabled: cfg.runnerFallbackEnabled,
      amendmentCount,
      lastAmendment,
      recent,
    }),
  );
}
