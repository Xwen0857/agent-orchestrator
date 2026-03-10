export type RuntimeStatsSnapshot = {
  logicalThreads: number;
  effectiveWorkerThreads: number;
  parallelLimit: number;
  queueDepth: number;
  policyMode: string;
  workdomainRoot: string;
  projectsRoot: string;
  aclDeniedCount: number;
  aclLastDeniedAt: string;
  sandboxEnabled: boolean;
  commitGuardEnabled: boolean;
  kbImportConfirmRequired: boolean;
  kbImportAutoEnabled: boolean;
  workspaceSyncSensitivity: string;
  skillMcpIsolationEnabled: boolean;
  protectOrchestratorConfig: boolean;
  projectRuntimeProfile: string;
  orchestratorRuntimeProfile: string;
};

export type ExternalRunnerSnapshot = {
  running: boolean;
  pid: number;
  lastTickAt: string;
  lastExitCode: string;
};

export type TaskStatusResponseParams = {
  taskId: string;
  meta: Record<string, unknown>;
  runnerStatus: string;
  runnerLastTickAt: string;
  runnerLastTickResult: string;
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeStats: RuntimeStatsSnapshot;
  resolvedMode?: string;
  planningDecision: Record<string, unknown>;
  splitUnitsPlanned: number;
  acl: Record<string, unknown>;
  aggregate: Record<string, unknown>;
  executionRoles: Record<string, unknown>;
  lockMtime: string;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerSnapshot;
  runnerFallbackEnabled: boolean;
  amendmentCount: number;
  lastAmendment: string;
  amendmentSource: "task_meta" | "none";
  legacyMirrorPresent?: boolean;
  plannerReplanStatus: string;
  plannerReplanExecutionStatus: string;
  amendmentWatermark: {
    headVersion: number;
    applyingVersion: number;
    consumedVersion: number;
  } | null;
  recent: string[];
};

export type RunSuccessResponseParams = {
  taskId: string;
  sessionKeyForRun: string;
  summaryId: string;
  summaryPath: string;
  payload: Record<string, unknown>;
  singleWorkerId: string;
  strategyPath: string;
  basePath: string;
  runnerStatus: string;
  runnerLastTickAt: string;
  runnerLastTickResult: string;
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeStats: RuntimeStatsSnapshot;
  resolvedMode?: string;
  planningDecision: Record<string, unknown>;
  splitUnitsPlanned: number;
  meta: Record<string, unknown>;
  workspaceConfigSource: string;
  workspaceValidated: boolean;
  aggregate: Record<string, unknown>;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerSnapshot;
  runnerFallbackEnabled: boolean;
  checklistText: string;
  scriptTrace: string[];
  llmUsed: boolean;
  llmReason: string;
  llmAuthMode: string;
  llmKeySource: string;
};

function renderRunnerFallbackHint(status: string, enabled: boolean): string {
  return status === "degraded" && enabled
    ? "runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10"
    : "runner_fallback_hint: (none)";
}

function resolveAggregateAuditStatus(
  meta: Record<string, unknown>,
  aggregate: Record<string, unknown>,
): string {
  const explicit = meta.aggregate_audit_status;
  if (explicit != null) {
    return String(explicit);
  }
  const publishStatus = String(aggregate.publish_status ?? "");
  if (publishStatus === "audited_pass" || publishStatus === "published") {
    return "PASS";
  }
  if (publishStatus === "audited_fail" || publishStatus === "rolled_back") {
    return "FAIL";
  }
  return "(none)";
}

export function renderTaskStatusResponse(params: TaskStatusResponseParams): string {
  const {
    taskId,
    meta,
    runnerStatus,
    runnerLastTickAt,
    runnerLastTickResult,
    runnerLastTickError,
    runnerIntervalSec,
    runnerExecutionMode,
    runnerBatchSize,
    runnerMaxParallel,
    runtimeStats,
    planningDecision,
    splitUnitsPlanned,
    acl,
    aggregate,
    executionRoles,
    lockMtime,
    runtimeConsistency,
    runtimeSignature,
    runtimeExpectedSignature,
    externalRunner,
    runnerFallbackEnabled,
    amendmentCount,
    lastAmendment,
    amendmentSource,
    legacyMirrorPresent,
    plannerReplanStatus,
    plannerReplanExecutionStatus,
    amendmentWatermark,
    recent,
  } = params;

  return [
    `task_id: ${taskId}`,
    `state: ${String(meta.state ?? "UNKNOWN")}`,
    `version: ${String(meta.version ?? "n/a")}`,
    `scheduler_status: ${runnerStatus}`,
    `last_tick_at: ${runnerLastTickAt || "(none)"}`,
    `last_tick_result: ${runnerLastTickResult}${runnerLastTickError ? ` (${runnerLastTickError})` : ""}`,
    `runner_interval_sec: ${String(runnerIntervalSec)}`,
    `runner_execution_mode: ${runnerExecutionMode}`,
    `runner_batch_size: ${String(runnerBatchSize)}`,
    `runner_max_parallel: ${String(runnerMaxParallel)}`,
    `logical_threads: ${String(runtimeStats.logicalThreads)}`,
    `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
    `decision_source: ${String(planningDecision.decision_source ?? "(none)")}`,
    `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
    `children_count: ${String(Array.isArray(meta.children) ? meta.children.length : 0)}`,
    `split_units_planned: ${String(splitUnitsPlanned)}`,
    `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
    `queue_depth: ${String(runtimeStats.queueDepth)}`,
    `policy_mode: ${runtimeStats.policyMode}`,
    `role_policy_version: ${String(meta.role_constraints_version ?? "unknown")}`,
    `work_domain_id: ${String(meta.work_domain_id ?? "(none)")}`,
    `workspace_root: ${String(meta.workspace_root ?? runtimeStats.workdomainRoot)}`,
    `workspace_config_source: ${String(meta.workspace_config_source ?? "runtime_default")}`,
    `workspace_validated: ${String((meta.workspace_validated as boolean | undefined) === false ? "false" : "true")}`,
    `planning_actor: ${String(executionRoles.planning_actor ?? "planner-core")}`,
    `scheduling_actor: ${String(executionRoles.scheduling_actor ?? "scheduler-ops")}`,
    `actor_compat_mode: ${String((executionRoles.compat_mode as boolean | undefined) ? "true" : "false")}`,
    `actor_compat_hits: ${String(executionRoles.compat_hits ?? 0)}`,
    `aggregate_publish_status: ${String(aggregate.publish_status ?? "none")}`,
    `aggregate_manifest: ${String(aggregate.manifest_path ?? "(none)")}`,
    `aggregate_audit_status: ${resolveAggregateAuditStatus(meta, aggregate)}`,
    `aggregate_collisions_count: ${String(meta.aggregate_collisions_count ?? 0)}`,
    `aggregate_last_block_reason: ${String(aggregate.last_block_reason ?? "(none)")}`,
    `run_root: ${String(meta.run_root ?? "(none)")}`,
    `project_id: ${String(meta.project_id ?? "prj_default")}`,
    `orchestrate_session_key: ${String(meta.orchestrate_session_key ?? "(none)")}`,
    `summary_id: ${String(meta.summary_id ?? "(none)")}`,
    `summary_path: ${String(meta.summary_path ?? "(none)")}`,
    `input_source: ${String(meta.input_source ?? "(none)")}`,
    `acl_denied_count: ${String(acl.denied_count ?? runtimeStats.aclDeniedCount)}`,
    `acl_last_denied_at: ${String((acl.last_denied_at ?? runtimeStats.aclLastDeniedAt) || "(none)")}`,
    `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
    `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
    `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
    `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
    `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
    `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
    `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
    `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
    `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
    `workspace_user_change_seq: ${String(meta.workspace_user_change_seq ?? 0)}`,
    `workspace_last_synced_seq: ${String(meta.workspace_last_synced_seq ?? 0)}`,
    `runner_lock_mtime: ${lockMtime || "(none)"}`,
    `runtime_consistency: ${runtimeConsistency || "(none)"}`,
    `runtime_signature: ${runtimeSignature || "(none)"}`,
    `runtime_expected_signature: ${runtimeExpectedSignature || "(none)"}`,
    `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
    `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
    `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
    `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
    renderRunnerFallbackHint(runnerStatus, runnerFallbackEnabled),
    `amendments: ${String(amendmentCount)}`,
    amendmentCount > 0 ? `last_amendment: ${lastAmendment}` : "last_amendment: (none)",
    `amendment_source: ${amendmentSource}`,
    `legacy_mirror_present: ${legacyMirrorPresent ? "true" : "false"}`,
    `planner_replan_status: ${plannerReplanStatus || "(none)"}`,
    `planner_replan_execution_status: ${plannerReplanExecutionStatus || "(none)"}`,
    amendmentWatermark
      ? `amendment_watermark: ${amendmentWatermark.headVersion}/${amendmentWatermark.applyingVersion}/${amendmentWatermark.consumedVersion}`
      : "amendment_watermark: (none)",
    recent.length > 0 ? "recent_events:" : "recent_events: (none)",
    ...recent.map((line) => `- ${line}`),
  ].join("\n");
}

export function renderRunSuccessResponse(params: RunSuccessResponseParams): string {
  const {
    taskId,
    sessionKeyForRun,
    summaryId,
    summaryPath,
    payload,
    singleWorkerId,
    strategyPath,
    basePath,
    runnerStatus,
    runnerLastTickAt,
    runnerLastTickResult,
    runnerLastTickError,
    runnerIntervalSec,
    runnerExecutionMode,
    runnerBatchSize,
    runnerMaxParallel,
    runtimeStats,
    planningDecision,
    splitUnitsPlanned,
    meta,
    workspaceConfigSource,
    workspaceValidated,
    aggregate,
    runtimeConsistency,
    runtimeSignature,
    runtimeExpectedSignature,
    externalRunner,
    runnerFallbackEnabled,
    checklistText,
    scriptTrace,
    llmUsed,
    llmReason,
    llmAuthMode,
    llmKeySource,
  } = params;

  return [
    `task_id: ${taskId}`,
    `orchestrate_session_key: ${sessionKeyForRun}`,
    `summary_id: ${summaryId}`,
    `summary_path: ${summaryPath}`,
    `state: ${String(payload.state ?? "(none)")}`,
    `version: ${String(payload.version ?? "(none)")}`,
    `worker: ${singleWorkerId}`,
    `strategy: ${strategyPath}`,
    `dashboard: ${basePath}`,
    `scheduler_status: ${runnerStatus}`,
    `last_tick_at: ${runnerLastTickAt || "(pending)"}`,
    `last_tick_result: ${runnerLastTickResult}${runnerLastTickError ? ` (${runnerLastTickError})` : ""}`,
    `runner_interval_sec: ${String(runnerIntervalSec)}`,
    `runner_execution_mode: ${runnerExecutionMode}`,
    `runner_batch_size: ${String(runnerBatchSize)}`,
    `runner_max_parallel: ${String(runnerMaxParallel)}`,
    `logical_threads: ${String(runtimeStats.logicalThreads)}`,
    `effective_worker_threads: ${String(runtimeStats.effectiveWorkerThreads)}`,
    `decision_source: ${String(planningDecision.decision_source ?? "manual_override")}`,
    `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
    `split_units_planned: ${String(splitUnitsPlanned)}`,
    `parallel_limit: ${String(runtimeStats.parallelLimit)}`,
    `queue_depth: ${String(runtimeStats.queueDepth)}`,
    `policy_mode: ${runtimeStats.policyMode}`,
    `role_policy_version: ${String(meta.role_constraints_version ?? "unknown")}`,
    `work_domain_id: ${String(meta.work_domain_id ?? "(none)")}`,
    `workspace_root: ${String(meta.workspace_root ?? runtimeStats.workdomainRoot)}`,
    `workspace_config_source: ${workspaceConfigSource}`,
    `workspace_validated: ${workspaceValidated ? "true" : "false"}`,
    `planning_actor: ${String(payload.planning_actor ?? "(none)")}`,
    `scheduling_actor: ${String(payload.scheduling_actor ?? "(none)")}`,
    `actor_compat_mode: ${String(payload.actor_compat_mode ? "true" : "false")}`,
    `actor_compat_hits: ${String(payload.actor_compat_hits ?? 0)}`,
    `aggregate_publish_status: ${String(aggregate.publish_status ?? "none")}`,
    `aggregate_manifest: ${String(aggregate.manifest_path ?? "(none)")}`,
    `aggregate_audit_status: ${String(payload.aggregate_audit_status ?? "(none)")}`,
    `aggregate_collisions_count: ${String(payload.aggregate_collisions_count ?? 0)}`,
    `aggregate_last_block_reason: ${String(aggregate.last_block_reason ?? "(none)")}`,
    `run_root: ${String(meta.run_root ?? "(none)")}`,
    `project_id: ${String(meta.project_id ?? "prj_default")}`,
    `runtime_consistency: ${runtimeConsistency || "(none)"}`,
    `runtime_signature: ${runtimeSignature || "(none)"}`,
    `runtime_expected_signature: ${runtimeExpectedSignature || "(none)"}`,
    `external_runner_running: ${externalRunner.running ? "true" : "false"}`,
    `external_runner_pid: ${externalRunner.pid > 0 ? String(externalRunner.pid) : "(none)"}`,
    `external_runner_last_tick_at: ${externalRunner.lastTickAt || "(none)"}`,
    `external_runner_last_exit_code: ${externalRunner.lastExitCode || "(none)"}`,
    renderRunnerFallbackHint(runnerStatus, runnerFallbackEnabled),
    `acl_denied_count: ${String((meta.acl as Record<string, unknown> | undefined)?.denied_count ?? runtimeStats.aclDeniedCount)}`,
    `acl_last_denied_at: ${String(((meta.acl as Record<string, unknown> | undefined)?.last_denied_at ?? runtimeStats.aclLastDeniedAt) || "(none)")}`,
    `sandbox_status: ${runtimeStats.sandboxEnabled ? "enabled" : "disabled"}`,
    `commit_guard_status: ${runtimeStats.commitGuardEnabled ? "enabled" : "disabled"}`,
    `kb_import_confirm_required: ${runtimeStats.kbImportConfirmRequired ? "true" : "false"}`,
    `kb_import_auto_enabled: ${runtimeStats.kbImportAutoEnabled ? "true" : "false"}`,
    `workspace_sync_sensitivity: ${runtimeStats.workspaceSyncSensitivity}`,
    `skill_mcp_isolation_enabled: ${runtimeStats.skillMcpIsolationEnabled ? "true" : "false"}`,
    `protect_orchestrator_config: ${runtimeStats.protectOrchestratorConfig ? "true" : "false"}`,
    `project_runtime_profile: ${runtimeStats.projectRuntimeProfile}`,
    `orchestrator_runtime_profile: ${runtimeStats.orchestratorRuntimeProfile}`,
    `workspace_user_change_seq: ${String(meta.workspace_user_change_seq ?? 0)}`,
    `workspace_last_synced_seq: ${String(meta.workspace_last_synced_seq ?? 0)}`,
    `llm_planner: ${llmUsed ? "enabled" : `fallback(${llmReason})`}`,
    `llm_auth_mode: ${llmAuthMode}`,
    `llm_key_source: ${llmKeySource || "(none)"}`,
    "",
    checklistText,
    "",
    ...scriptTrace,
  ].join("\n");
}
