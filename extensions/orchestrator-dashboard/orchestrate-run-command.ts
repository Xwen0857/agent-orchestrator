import path from "node:path";
import {
  buildOperationId,
  buildStrategyFromSummary,
  buildTaskId,
  type OrchestrateStrategy,
} from "./orchestrate-command.js";
import { resolveWorkspaceConfigForRun } from "./orchestrate-path.js";
import {
  buildSummaryFilePath,
  getRunnableSummary,
  resolveConversationSessionKey,
  validateRunCommandPayload,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";
import {
  renderRunSuccessResponse,
  type ExternalRunnerSnapshot,
  type RuntimeStatsSnapshot,
} from "./orchestrate-response.js";
import { buildRunSuccessResponseParams } from "./orchestrate-view-model.js";
import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";
import type { RunnerSnapshot } from "./orchestrate-runner-runtime.js";

type RunPaths = {
  orchestrateRequestsDir: string;
  taskFoldersRoot: string;
};

type HandleRunSubcommandParams = {
  payload: string;
  ctx: {
    channel?: string;
    senderId?: string;
    messageThreadId?: string | number;
    sessionKey?: string;
    commandTargetSessionKey?: string;
  };
  repoRoot: string;
  basePath: string;
  paths: RunPaths;
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  readPathState: () => Promise<import("./orchestrate-path.js").PathState>;
  readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
  writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "create_task_from_strategy"
      | "planner_entry"
      | "transition_task_state"
      | "dashboard_summary";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  buildWorkerIdFromTaskId: (taskId: string) => string;
  trimOutput: (value: string) => string;
  loadExecutionRuntime: () => Promise<RuntimeStatsSnapshot & { projectsRoot: string }>;
  ensureRunnerStarted: () => Promise<{ schedulerStatus: string; lastTickAt: string; intervalSec: number }>;
  getExternalRunnerStatus: () => Promise<ExternalRunnerSnapshot>;
  runtime: {
    getRunnerSnapshot: () => RunnerSnapshot;
    getConsistencySnapshot: () => RuntimeConsistencySnapshot;
    runnerFallbackEnabled: boolean;
  };
  renderRequiredConfigChecklist: () => string;
};

export async function handleRunSubcommand(
  params: HandleRunSubcommandParams,
): Promise<string> {
  const payloadError = validateRunCommandPayload(params.payload);
  if (payloadError) {
    return payloadError;
  }
  const sessionKeyForRun = resolveConversationSessionKey(params.ctx);
  if (!sessionKeyForRun) {
    return "orchestrate run failed: missing session key";
  }
  const session = await params.readOrchestrateSession(sessionKeyForRun);
  const runnableSummary = getRunnableSummary(session);
  if (!runnableSummary.ok) {
    return runnableSummary.error;
  }
  const activeSession = session as OrchestrateSessionState;
  const latestSummary = runnableSummary.summary;
  const requestedMode = latestSummary.content.requested_mode;
  const taskId = buildTaskId(latestSummary.content.task_goal);

  const runtimeStatsForWorkspace = await params.loadExecutionRuntime();
  let workspaceResolved: {
    projectId: string;
    workspaceRoot: string;
    source: import("./orchestrate-path.js").WorkspaceConfigSource;
    validated: boolean;
  };
  try {
    workspaceResolved = resolveWorkspaceConfigForRun({
      repoRoot: params.repoRoot,
      projectsRootRel: runtimeStatsForWorkspace.projectsRoot,
      pathState: await params.readPathState(),
      projectIdFromFlag: latestSummary.content.project_id,
      workspaceRootFromFlag: latestSummary.content.workspace_root,
      taskId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `orchestrate run failed: ${message}`;
  }

  const strategyInitial = buildStrategyFromSummary({
    summary: latestSummary.content,
    taskId,
    channel: params.ctx.channel ?? "cli",
    senderId: params.ctx.senderId,
    sessionKey: sessionKeyForRun,
    messageThreadId:
      typeof params.ctx.messageThreadId === "number" ? params.ctx.messageThreadId : undefined,
    workspace: {
      project_id: workspaceResolved.projectId,
      workspace_root: workspaceResolved.workspaceRoot,
      source: workspaceResolved.source,
    },
  });

  const operationId = buildOperationId({
    subcommand: "run",
    sessionKey: sessionKeyForRun,
    messageThreadId:
      typeof params.ctx.messageThreadId === "number" ? params.ctx.messageThreadId : undefined,
    request: strategyInitial.raw_request,
  });
  const llmPlan = {
    strategy: strategyInitial,
    used: false,
    reason: "session_summary",
    authMode: "auto" as const,
    keySource: "",
  };
  const strategy: OrchestrateStrategy = llmPlan.strategy;
  const strategyPath = path.join(params.paths.orchestrateRequestsDir, `${taskId}.strategy.json`);
  await params.writeJsonAtomic(strategyPath, strategy);
  const summaryPath = buildSummaryFilePath(
    params.paths.orchestrateRequestsDir,
    sessionKeyForRun,
    latestSummary.summary_id,
  );
  const taskDir = path.join(params.paths.taskFoldersRoot, taskId);
  const taskDirArg = path.relative(params.repoRoot, taskDir);
  const strategyPathArg = path.relative(params.repoRoot, strategyPath);
  const scriptTrace: string[] = [];
  const singleWorkerId = params.buildWorkerIdFromTaskId(taskId);

  try {
    const created = await params.runWhitelistedScript({
      repoRoot: params.repoRoot,
      scriptName: "create_task_from_strategy",
      args: [strategyPathArg],
    });
    scriptTrace.push(
      `create_task_from_strategy: ${params.trimOutput(created.stdout || created.stderr || "ok")}`,
    );

    const createdMetaPath = path.join(taskDir, "meta.json");
    const createdMeta = await params.readJsonOrDefault<Record<string, unknown>>(createdMetaPath, {});
    await params.writeJsonAtomic(createdMetaPath, {
      ...createdMeta,
      requested_mode: requestedMode,
      orchestrate_session_key: sessionKeyForRun,
      summary_id: latestSummary.summary_id,
      summary_path: summaryPath,
      input_source: "session_summary",
    });
    await params.writeJsonAtomic(strategyPath, {
      ...strategy,
      status: "drafted",
      summary_id: latestSummary.summary_id,
      summary_path: summaryPath,
      input_source: "session_summary",
    });

    const now = new Date().toISOString();
    await params.writeOrchestrateSession({
      ...activeSession,
      status: "RUNNING",
      updated_at: now,
      latest_summary: {
        ...latestSummary,
        status: "consumed",
      },
      last_run: {
        task_id: taskId,
        started_at: now,
        summary_id: latestSummary.summary_id,
      },
    });
    await params.emitEvent("orchestrate.session.run_started", {
      session_key: sessionKeyForRun,
      summary_id: latestSummary.summary_id,
      summary_path: summaryPath,
      task_id: taskId,
    });

    const planned = await params.runWhitelistedScript({
      repoRoot: params.repoRoot,
      scriptName: "planner_entry",
      args: ["--task-dir", taskDirArg, "--requested-mode", requestedMode],
    });
    scriptTrace.push(`planner_entry: ${params.trimOutput(planned.stdout || planned.stderr || "ok")}`);

    const planningActor = "planner-core";
    const transitions: Array<{ from: string; to: string; reason: string }> = [
      { from: "CREATED", to: "PLANNED", reason: "orchestrate-run planned" },
      { from: "PLANNED", to: "ASSIGNED", reason: "orchestrate-run assigned" },
    ];
    for (const t of transitions) {
      const transition = await params.runWhitelistedScript({
        repoRoot: params.repoRoot,
        scriptName: "transition_task_state",
        args: [
          taskDirArg,
          planningActor,
          `${operationId}:${t.from.toLowerCase()}-${t.to.toLowerCase()}`,
          t.from,
          t.to,
          t.reason.replace(/\s+/g, "_"),
        ],
      });
      scriptTrace.push(
        `transition_task_state ${t.from}->${t.to}: ${params.trimOutput(
          transition.stdout || transition.stderr || "ok",
        )}`,
      );
    }

    const dashboard = await params.runWhitelistedScript({
      repoRoot: params.repoRoot,
      scriptName: "dashboard_summary",
      args: [],
    });
    scriptTrace.push(`dashboard_summary: ${params.trimOutput(dashboard.stdout || dashboard.stderr || "ok")}`);

    await params.writeJsonAtomic(strategyPath, {
      ...strategy,
      status: "applied",
      summary_id: latestSummary.summary_id,
      summary_path: summaryPath,
      input_source: "session_summary",
    });

    const meta = await params.readJsonOrDefault<Record<string, unknown>>(
      path.join(taskDir, "meta.json"),
      {},
    );
    const runnerInfo = await params.ensureRunnerStarted();
    const [runtimeStats, externalRunner] = await Promise.all([
      params.loadExecutionRuntime(),
      params.getExternalRunnerStatus(),
    ]);
    const requestedModeResolved = String(meta.requested_mode ?? requestedMode);
    const runnerSnapshot = params.runtime.getRunnerSnapshot();
    const consistencySnapshot = params.runtime.getConsistencySnapshot();
    const planningDecisionMeta =
      meta.planning_decision &&
      typeof meta.planning_decision === "object" &&
      !Array.isArray(meta.planning_decision)
        ? (meta.planning_decision as Record<string, unknown>)
        : {};
    const aggregateMeta =
      meta.aggregate && typeof meta.aggregate === "object" && !Array.isArray(meta.aggregate)
        ? (meta.aggregate as Record<string, unknown>)
        : {};
    const executionRoles =
      meta.execution_roles &&
      typeof meta.execution_roles === "object" &&
      !Array.isArray(meta.execution_roles)
        ? (meta.execution_roles as Record<string, unknown>)
        : {};
    const appliedPayload = {
      task_id: taskId,
      orchestrate_session_key: sessionKeyForRun,
      summary_id: latestSummary.summary_id,
      summary_path: summaryPath,
      operation_id: operationId,
      state: String(meta.state ?? "UNKNOWN"),
      version: Number(meta.version ?? 0),
      strategy_path: strategyPath,
      dashboard_path: params.basePath,
      scheduler_status: runnerInfo.schedulerStatus,
      last_tick_at: runnerInfo.lastTickAt,
      last_tick_result: runnerSnapshot.runnerLastTickResult,
      last_tick_error_summary: runnerSnapshot.runnerLastTickError,
      runner_interval_sec: runnerInfo.intervalSec,
      runner_execution_mode: runnerSnapshot.runnerExecutionMode,
      runner_batch_size: runnerSnapshot.runnerBatchSize,
      runner_max_parallel: runnerSnapshot.runnerMaxParallel,
      logical_threads: runtimeStats.logicalThreads,
      effective_worker_threads: runtimeStats.effectiveWorkerThreads,
      requested_mode: requestedModeResolved,
      resolved_mode: String(
        meta.execution_mode ??
          (Array.isArray(meta.children) && meta.children.length > 0 ? "multi" : "single"),
      ),
      decision_source: String(planningDecisionMeta.decision_source ?? "manual_override"),
      decision_reason: String(planningDecisionMeta.decision_reason ?? ""),
      split_units_planned: Number(meta.split_units_planned ?? 1),
      parallel_limit: runtimeStats.parallelLimit,
      queue_depth: runtimeStats.queueDepth,
      policy_mode: runtimeStats.policyMode,
      role_policy_version: String(meta.role_constraints_version ?? "unknown"),
      work_domain_id: String(meta.work_domain_id ?? "(none)"),
      workspace_root: String(meta.workspace_root ?? runtimeStats.workdomainRoot),
      workspace_config_source: String(meta.workspace_config_source ?? workspaceResolved.source),
      workspace_validated: Boolean(
        (meta.workspace_validated as boolean | undefined) ?? workspaceResolved.validated,
      ),
      planning_actor: String(executionRoles.planning_actor ?? "planner-core"),
      scheduling_actor: String(executionRoles.scheduling_actor ?? "scheduler-ops"),
      actor_compat_mode: Boolean(executionRoles.compat_mode ?? false),
      actor_compat_hits: Number(executionRoles.compat_hits ?? 0),
      aggregate_publish_status: String(aggregateMeta.publish_status ?? "none"),
      aggregate_manifest: String(aggregateMeta.manifest_path ?? ""),
      aggregate_audit_status: String(
        (meta.aggregate_audit_status as string | undefined) ??
          ((aggregateMeta.publish_status === "audited_pass" ||
            aggregateMeta.publish_status === "published")
            ? "PASS"
            : aggregateMeta.publish_status === "audited_fail" ||
                aggregateMeta.publish_status === "rolled_back"
              ? "FAIL"
              : ""),
      ),
      aggregate_collisions_count: Number(meta.aggregate_collisions_count ?? 0),
      aggregate_last_block_reason: String(aggregateMeta.last_block_reason ?? ""),
      acl_denied_count: Number(
        (meta.acl as Record<string, unknown> | undefined)?.denied_count ?? runtimeStats.aclDeniedCount,
      ),
      acl_last_denied_at: String(
        (meta.acl as Record<string, unknown> | undefined)?.last_denied_at ??
          runtimeStats.aclLastDeniedAt,
      ),
      sandbox_status: runtimeStats.sandboxEnabled ? "enabled" : "disabled",
      commit_guard_status: runtimeStats.commitGuardEnabled ? "enabled" : "disabled",
      kb_import_confirm_required: runtimeStats.kbImportConfirmRequired,
      kb_import_auto_enabled: runtimeStats.kbImportAutoEnabled,
      workspace_sync_sensitivity: runtimeStats.workspaceSyncSensitivity,
      skill_mcp_isolation_enabled: runtimeStats.skillMcpIsolationEnabled,
      protect_orchestrator_config: runtimeStats.protectOrchestratorConfig,
      project_runtime_profile: runtimeStats.projectRuntimeProfile,
      orchestrator_runtime_profile: runtimeStats.orchestratorRuntimeProfile,
      workspace_user_change_seq: Number(meta.workspace_user_change_seq ?? 0),
      workspace_last_synced_seq: Number(meta.workspace_last_synced_seq ?? 0),
      project_id: String(meta.project_id ?? "prj_default"),
      run_root: String(meta.run_root ?? "(none)"),
      runtime_consistency: consistencySnapshot.runtimeConsistency,
      runtime_signature: consistencySnapshot.runtimeSignature || "",
      runtime_expected_signature: consistencySnapshot.runtimeExpectedSignature || "",
      external_runner_running: externalRunner.running,
      external_runner_pid: externalRunner.pid,
      external_runner_last_tick_at: externalRunner.lastTickAt,
      external_runner_last_exit_code: externalRunner.lastExitCode,
      llm_used: llmPlan.used,
      llm_reason: llmPlan.reason,
      llm_auth_mode: llmPlan.authMode,
      llm_key_source: llmPlan.keySource || "",
    };
    await params.emitEvent("orchestrate.run.applied", appliedPayload);
    if (appliedPayload.work_domain_id && appliedPayload.work_domain_id !== "(none)") {
      await params.emitEvent("orchestrate.workdomain.allocated", {
        task_id: taskId,
        work_domain_id: appliedPayload.work_domain_id,
        workspace_root: appliedPayload.workspace_root,
        role_policy_version: appliedPayload.role_policy_version,
      });
      await params.emitEvent("orchestrate.workdomain.sync_completed", {
        task_id: taskId,
        work_domain_id: appliedPayload.work_domain_id,
        sync_strategy: "copy_on_submit",
      });
    }

    return renderRunSuccessResponse(
      buildRunSuccessResponseParams({
        taskId,
        sessionKeyForRun,
        summaryId: latestSummary.summary_id,
        summaryPath,
        payload: appliedPayload,
        singleWorkerId,
        strategyPath,
        basePath: params.basePath,
        runnerStatus: runnerInfo.schedulerStatus,
        runnerLastTickAt: runnerInfo.lastTickAt,
        runnerLastTickResult: runnerSnapshot.runnerLastTickResult,
        runnerLastTickError: runnerSnapshot.runnerLastTickError,
        runnerIntervalSec: runnerInfo.intervalSec,
        runnerExecutionMode: runnerSnapshot.runnerExecutionMode,
        runnerBatchSize: runnerSnapshot.runnerBatchSize,
        runnerMaxParallel: runnerSnapshot.runnerMaxParallel,
        runtimeStats,
        requestedModeDefault: requestedModeResolved,
        meta,
        workspaceConfigSourceDefault: workspaceResolved.source,
        workspaceValidatedDefault: workspaceResolved.validated,
        runtimeConsistency: consistencySnapshot.runtimeConsistency,
        runtimeSignature: consistencySnapshot.runtimeSignature,
        runtimeExpectedSignature: consistencySnapshot.runtimeExpectedSignature,
        externalRunner,
        runnerFallbackEnabled: params.runtime.runnerFallbackEnabled,
        checklistText: params.renderRequiredConfigChecklist(),
        scriptTrace,
        llmUsed: llmPlan.used,
        llmReason: llmPlan.reason,
        llmAuthMode: llmPlan.authMode,
        llmKeySource: llmPlan.keySource,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await params.emitEvent("orchestrate.run.failed", {
      task_id: taskId,
      operation_id: operationId,
      error: message,
    });
    return `orchestrate run failed: ${message}\nstrategy: ${strategyPath}`;
  }
}
