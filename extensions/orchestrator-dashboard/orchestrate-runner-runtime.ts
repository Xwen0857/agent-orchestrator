import path from "node:path";
import fs from "node:fs/promises";
import type { ExternalRunnerSnapshot } from "./orchestrate-response.js";
import { runSchedulerKernelTick } from "./orchestrate-scheduler-kernel.js";
import { extractSchedulerConfig } from "./orchestrate-scheduler-contract.js";

const RUNNER_DEGRADED_THRESHOLD = 3;

export type RunnerSnapshot = {
  runnerStatus: "started" | "already_running" | "degraded";
  runnerLastTickAt: string;
  runnerLastTickResult: "ok" | "failed" | "none";
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runnerTimerActive: boolean;
};

export type RunnerRuntimeController = {
  ensureRunnerStarted: () => Promise<{
    schedulerStatus: "started" | "already_running" | "degraded";
    lastTickAt: string;
    intervalSec: number;
  }>;
  getExternalRunnerStatus: () => Promise<ExternalRunnerSnapshot>;
  getRunnerLockMtime: () => Promise<string>;
  getSnapshot: () => RunnerSnapshot;
  kickoffOnStartup: () => void;
};

export type BuildRunnerRuntimeControllerParams = {
  repoRoot: string;
  runnerLockPath: string;
  externalRunnerScriptPath: string;
  startupConsistencyPromise: Promise<unknown>;
  cfg: {
    runnerEnabled: boolean;
    runnerFallbackEnabled: boolean;
    runnerFallbackMode: "external_daemon" | "none";
    runnerIntervalSec: number;
    runnerExecutionMode: "local_threads" | "container" | "distributed";
    runnerBatchSize: number;
    runnerMaxParallel: number;
    runnerTasksRootArg: string;
    executionRuntimePath: string;
  };
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readText: (targetPath: string) => Promise<string>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    runScript: (
      scriptPath: string,
      args: string[],
      cwd: string,
    ) => Promise<{ stdout: string; stderr: string }>;
  };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "orchestrate_multi_once"
      | "transition_task_state"
      | "append_task_event"
      | "dashboard_summary"
      | "agent_dispatch"
      | "kb_submit_candidate";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  trimOutput: (value: string, maxChars?: number) => string;
};

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

function asString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function buildRunnerRuntimeController(
  params: BuildRunnerRuntimeControllerParams,
): RunnerRuntimeController {
  let runnerTimer: NodeJS.Timeout | null = null;
  let runnerTickRunning = false;
  let runnerLastTickAt = "";
  let runnerLastTickResult: "ok" | "failed" | "none" = "none";
  let runnerLastTickError = "";
  let runnerConsecutiveFailures = 0;
  let runnerStatus: "started" | "already_running" | "degraded" = "degraded";
  let kernelRollbackActive = false;
  let kernelConsecutiveTickFailures = 0;
  let previousQueueDepth = 0;
  let queueGrowthConsecutiveBreaches = 0;
  let schedulerRuntimeConsistency: "ok" | "mismatch" | "unknown" = "unknown";

  void params.startupConsistencyPromise
    .then((result) => {
      schedulerRuntimeConsistency = normalizeSchedulerRuntimeConsistency(result);
    })
    .catch(() => {
      schedulerRuntimeConsistency = "unknown";
    });

  const getRunnerLockMtime = async (): Promise<string> => {
    try {
      const stat = await fs.stat(params.runnerLockPath);
      return stat.mtime.toISOString();
    } catch {
      return "";
    }
  };

  const readRunnerLockInfo = async (): Promise<{ pid: number; heartbeatIso: string }> => {
    try {
      const content = await params.io.readText(params.runnerLockPath);
      const lines = content.split(/\r?\n/u);
      const pidRaw = String(lines[0] ?? "").trim();
      const heartbeatIso = String(lines[1] ?? "").trim();
      const pid = Number(pidRaw);
      return {
        pid: Number.isFinite(pid) && pid > 0 ? pid : 0,
        heartbeatIso,
      };
    } catch {
      return { pid: 0, heartbeatIso: "" };
    }
  };

  const isRunnerHeartbeatFresh = (heartbeatIso: string): boolean => {
    if (!heartbeatIso) {
      return false;
    }
    const heartbeatMs = Date.parse(heartbeatIso);
    if (!Number.isFinite(heartbeatMs)) {
      return false;
    }
    const ageMs = Date.now() - heartbeatMs;
    const staleMs = Math.max(params.cfg.runnerIntervalSec * 3000, 30_000);
    return ageMs >= 0 && ageMs <= staleMs;
  };

  const isProcessAlive = (pid: number): boolean => {
    if (!Number.isFinite(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const isRunnerLockHeldByOtherLiveProcess = async (): Promise<boolean> => {
    const { pid, heartbeatIso } = await readRunnerLockInfo();
    return (
      pid > 0 &&
      pid !== process.pid &&
      isProcessAlive(pid) &&
      isRunnerHeartbeatFresh(heartbeatIso)
    );
  };

  const refreshRunnerStatusFromLock = async (): Promise<void> => {
    if (await isRunnerLockHeldByOtherLiveProcess()) {
      runnerStatus = "already_running";
    } else {
      runnerStatus = "degraded";
    }
  };

  const refreshRunnerLock = async (): Promise<void> => {
    const payload = `${process.pid}\n${new Date().toISOString()}\n`;
    await fs.writeFile(params.runnerLockPath, payload, "utf8");
  };

  const acquireRunnerLock = async (): Promise<boolean> => {
    await fs.mkdir(path.dirname(params.runnerLockPath), { recursive: true });
    const payload = `${process.pid}\n${new Date().toISOString()}\n`;
    try {
      const handle = await fs.open(params.runnerLockPath, "wx");
      await handle.writeFile(payload, "utf8");
      await handle.close();
      return true;
    } catch {
      const lockInfo = await readRunnerLockInfo();
      const parsedPid = lockInfo.pid;
      if (Number.isFinite(parsedPid) && parsedPid > 0) {
        if (parsedPid === process.pid) {
          await refreshRunnerLock();
          return true;
        }
        try {
          process.kill(parsedPid, 0);
          if (isRunnerHeartbeatFresh(lockInfo.heartbeatIso)) {
            return false;
          }
          await fs.unlink(params.runnerLockPath);
          const handle = await fs.open(params.runnerLockPath, "wx");
          await handle.writeFile(payload, "utf8");
          await handle.close();
          return true;
        } catch {
          // stale lock; reclaim below
        }
      }
      try {
        await fs.unlink(params.runnerLockPath);
      } catch {
        return false;
      }
      try {
        const handle = await fs.open(params.runnerLockPath, "wx");
        await handle.writeFile(payload, "utf8");
        await handle.close();
        return true;
      } catch {
        return false;
      }
    }
  };

  const getExternalRunnerStatus = async (): Promise<ExternalRunnerSnapshot> => {
    if (!params.cfg.runnerFallbackEnabled || params.cfg.runnerFallbackMode !== "external_daemon") {
      return { running: false, pid: 0, lastTickAt: "", lastExitCode: "" };
    }
    if (!(await params.io.fileExists(params.externalRunnerScriptPath))) {
      return { running: false, pid: 0, lastTickAt: "", lastExitCode: "" };
    }
    try {
      const result = await params.io.runScript(
        params.externalRunnerScriptPath,
        ["status", "--json"],
        params.repoRoot,
      );
      const parsed = JSON.parse(String(result.stdout || "{}")) as Record<string, unknown>;
      return {
        running: asBoolean(parsed.running, false),
        pid: asPositiveInt(parsed.pid, 0),
        lastTickAt: asString(parsed.last_tick_at, ""),
        lastExitCode: asString(parsed.last_exit_code, ""),
      };
    } catch {
      return { running: false, pid: 0, lastTickAt: "", lastExitCode: "" };
    }
  };

  const tickRunner = async (): Promise<void> => {
    if (runnerTickRunning) {
      return;
    }
    runnerTickRunning = true;
    try {
      const runtimeRaw = await params.io.readJsonOrDefault<Record<string, unknown>>(
        params.cfg.executionRuntimePath,
        {},
      );
      const schedulerCfg = extractSchedulerConfig(runtimeRaw);
      const useKernelPath = schedulerCfg.scheduler_kernel_v2_enabled && !kernelRollbackActive;
      let onceResult: { stdout: string; stderr: string };
      if (useKernelPath) {
        const result = await runSchedulerKernelTick({
          repoRoot: params.repoRoot,
          tasksRootArg: params.cfg.runnerTasksRootArg,
          mode: params.cfg.runnerExecutionMode,
          maxParallel: params.cfg.runnerMaxParallel,
          maxTasks: params.cfg.runnerBatchSize,
          runtimeConsistency: schedulerRuntimeConsistency,
          runWhitelistedScript: params.runWhitelistedScript,
          emitEvent: params.emitEvent,
        });
        onceResult = {
          stdout: JSON.stringify(result),
          stderr: "",
        };
      } else {
        onceResult = await params.runWhitelistedScript({
          repoRoot: params.repoRoot,
          scriptName: "orchestrate_multi_once",
          args: [
            params.cfg.runnerTasksRootArg,
            "--mode",
            params.cfg.runnerExecutionMode,
            "--max-parallel",
            String(params.cfg.runnerMaxParallel),
            "--max-tasks",
            String(params.cfg.runnerBatchSize),
          ],
          timeoutMs: 60_000,
          maxBufferBytes: 2 * 1024 * 1024,
        });
      }
      runnerLastTickAt = new Date().toISOString();
      runnerLastTickResult = "ok";
      runnerLastTickError = "";
      runnerConsecutiveFailures = 0;
      runnerStatus = "started";
      let parsedTick: Record<string, unknown> = {};
      try {
        parsedTick = JSON.parse(onceResult.stdout || "{}") as Record<string, unknown>;
      } catch {
        parsedTick = {};
      }
      await refreshRunnerLock();
      await params.emitEvent("orchestrate.runner.tick_ok", {
        interval_sec: params.cfg.runnerIntervalSec,
        execution_mode: params.cfg.runnerExecutionMode,
        scheduler_path: useKernelPath ? "kernel_v2" : "legacy_script",
        runtime_consistency: schedulerRuntimeConsistency,
        batch_size: params.cfg.runnerBatchSize,
        max_parallel: params.cfg.runnerMaxParallel,
        output: params.trimOutput(onceResult.stdout || onceResult.stderr || "ok", 240),
        last_tick_at: runnerLastTickAt,
        logical_threads: asPositiveInt(parsedTick.logical_threads, 4),
        effective_worker_threads: asPositiveInt(parsedTick.effective_worker_threads, 1),
        parallel_limit: asPositiveInt(parsedTick.parallel_limit, params.cfg.runnerMaxParallel),
        queue_depth: asPositiveInt(parsedTick.queue_depth, 0),
        policy_mode: asString(parsedTick.policy_mode, "enforce"),
        sandbox_status: asString(parsedTick.sandbox_status, "enabled"),
        commit_guard_status: asString(parsedTick.commit_guard_status, "enabled"),
        kb_import_confirm_required: asString(parsedTick.kb_import_confirm_required, "true"),
        kb_import_auto_enabled: asString(parsedTick.kb_import_auto_enabled, "false"),
        workspace_sync_sensitivity: asString(parsedTick.workspace_sync_sensitivity, "MEDIUM"),
        acl_denied_count: asPositiveInt(parsedTick.acl_denied_count, 0),
        acl_last_denied_at: asString(parsedTick.acl_last_denied_at, ""),
      });

      if (useKernelPath) {
        const softFailed = asPositiveInt(parsedTick.failed, 0) > 0 || asString(parsedTick.status, "ok") !== "ok";
        kernelConsecutiveTickFailures = softFailed ? kernelConsecutiveTickFailures + 1 : 0;

        const queueDepth = asPositiveInt(parsedTick.queue_depth, 0);
        const queueGrowth = Math.max(0, queueDepth - previousQueueDepth);
        previousQueueDepth = queueDepth;
        if (queueGrowth > schedulerCfg.rollback_guard.max_queue_depth_growth) {
          queueGrowthConsecutiveBreaches += 1;
        } else {
          queueGrowthConsecutiveBreaches = 0;
        }

        const successRateRaw = Number(parsedTick.dispatch_success_rate);
        const successRate = Number.isFinite(successRateRaw) ? successRateRaw : 1;
        const successRateBreached = successRate < schedulerCfg.rollback_guard.min_dispatch_success_rate;
        const maxFailuresBreached =
          kernelConsecutiveTickFailures >= schedulerCfg.rollback_guard.max_consecutive_tick_failures;
        const queueGrowthBreached = queueGrowthConsecutiveBreaches >= 3;

        if (maxFailuresBreached || successRateBreached || queueGrowthBreached) {
          kernelRollbackActive = true;
          await params.emitEvent("orchestrate.scheduler.rollback_triggered", {
            reason: maxFailuresBreached
              ? "consecutive_tick_failures"
              : successRateBreached
                ? "dispatch_success_rate_below_threshold"
                : "queue_depth_growth_breach",
            max_consecutive_tick_failures: schedulerCfg.rollback_guard.max_consecutive_tick_failures,
            min_dispatch_success_rate: schedulerCfg.rollback_guard.min_dispatch_success_rate,
            max_queue_depth_growth: schedulerCfg.rollback_guard.max_queue_depth_growth,
            observed_consecutive_tick_failures: kernelConsecutiveTickFailures,
            observed_dispatch_success_rate: successRate,
            observed_queue_depth_growth: queueGrowth,
          });
        }
      }

      if (parsedTick.throttled === true) {
        await params.emitEvent("orchestrate.parallel.throttled", {
          requested_parallel: params.cfg.runnerMaxParallel,
          applied_parallel: asPositiveInt(parsedTick.parallel_limit, params.cfg.runnerMaxParallel),
          effective_worker_threads: asPositiveInt(parsedTick.effective_worker_threads, 1),
          last_tick_at: runnerLastTickAt,
        });
      }
      if (asPositiveInt(parsedTick.acl_denied_count, 0) > 0) {
        await params.emitEvent("orchestrate.acl.denied", {
          acl_denied_count: asPositiveInt(parsedTick.acl_denied_count, 0),
          acl_last_denied_at: asString(parsedTick.acl_last_denied_at, ""),
          policy_mode: asString(parsedTick.policy_mode, "enforce"),
        });
      }
    } catch (err) {
      runnerLastTickAt = new Date().toISOString();
      runnerLastTickResult = "failed";
      runnerConsecutiveFailures += 1;
      if (runnerConsecutiveFailures >= RUNNER_DEGRADED_THRESHOLD) {
        runnerStatus = "degraded";
      }
      const message = err instanceof Error ? err.message : String(err);
      runnerLastTickError = params.trimOutput(message, 400);
      await params.emitEvent("orchestrate.runner.tick_failed", {
        interval_sec: params.cfg.runnerIntervalSec,
        execution_mode: params.cfg.runnerExecutionMode,
        batch_size: params.cfg.runnerBatchSize,
        max_parallel: params.cfg.runnerMaxParallel,
        error: runnerLastTickError,
        consecutive_failures: runnerConsecutiveFailures,
        last_tick_at: runnerLastTickAt,
        status: runnerStatus,
      });
    } finally {
      try {
        await refreshRunnerLock();
      } catch {
        // ignore lock heartbeat write errors
      }
      runnerTickRunning = false;
    }
  };

  const ensureRunnerStarted: RunnerRuntimeController["ensureRunnerStarted"] = async () => {
    if (!params.cfg.runnerEnabled) {
      runnerStatus = "degraded";
      return {
        schedulerStatus: "degraded",
        lastTickAt: runnerLastTickAt,
        intervalSec: params.cfg.runnerIntervalSec,
      };
    }
    if (runnerTimer) {
      runnerStatus = runnerStatus === "degraded" ? "degraded" : "already_running";
      return {
        schedulerStatus: runnerStatus,
        lastTickAt: runnerLastTickAt,
        intervalSec: params.cfg.runnerIntervalSec,
      };
    }

    const lockAcquired = await acquireRunnerLock();
    if (!lockAcquired) {
      await refreshRunnerStatusFromLock();
      return {
        schedulerStatus: runnerStatus,
        lastTickAt: runnerLastTickAt,
        intervalSec: params.cfg.runnerIntervalSec,
      };
    }

    runnerStatus = "started";
    await params.emitEvent("orchestrate.runner.started", {
      interval_sec: params.cfg.runnerIntervalSec,
      execution_mode: params.cfg.runnerExecutionMode,
      batch_size: params.cfg.runnerBatchSize,
      max_parallel: params.cfg.runnerMaxParallel,
      lock_path: params.runnerLockPath,
    });

    runnerTimer = setInterval(() => {
      void tickRunner();
    }, params.cfg.runnerIntervalSec * 1000);
    void tickRunner();

    return {
      schedulerStatus: "started",
      lastTickAt: runnerLastTickAt,
      intervalSec: params.cfg.runnerIntervalSec,
    };
  };

  const kickoffOnStartup = (): void => {
    void params.startupConsistencyPromise.then(async (result) => {
      if (!result || !params.cfg.runnerEnabled) {
        return;
      }
      try {
        await ensureRunnerStarted();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await params.emitEvent("orchestrate.runner.start_failed", {
          stage: "plugin_startup",
          error: params.trimOutput(message, 400),
        });
      }
    });
  };

  return {
    ensureRunnerStarted,
    getExternalRunnerStatus,
    getRunnerLockMtime,
    getSnapshot: () => ({
      runnerStatus,
      runnerLastTickAt,
      runnerLastTickResult,
      runnerLastTickError,
      runnerIntervalSec: params.cfg.runnerIntervalSec,
      runnerExecutionMode: params.cfg.runnerExecutionMode,
      runnerBatchSize: params.cfg.runnerBatchSize,
      runnerMaxParallel: params.cfg.runnerMaxParallel,
      runnerTimerActive: Boolean(runnerTimer),
    }),
    kickoffOnStartup,
  };
}

export function normalizeSchedulerRuntimeConsistency(value: unknown): "ok" | "mismatch" | "unknown" {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const candidate = String((value as { runtimeConsistency?: unknown }).runtimeConsistency ?? "").trim();
  if (candidate === "ok" || candidate === "mismatch") {
    return candidate;
  }
  return "unknown";
}
