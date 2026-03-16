// Boundary rule:
// Planner semantics must come from projection. Keep this module as response param composition only.
import { type RunSuccessResponseParams, type TaskStatusResponseParams } from "./orchestrate-response.js";
import { projectPlannerView } from "./orchestrate-planner-projection.js";
import { extractWorkerRuntimeCoordinationSignals } from "./orchestrate-runtime-contract.js";

type RuntimeStatsInput = TaskStatusResponseParams["runtimeStats"];
type ExternalRunnerInput = TaskStatusResponseParams["externalRunner"];

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function buildTaskStatusResponseParams(input: {
  taskId: string;
  meta: Record<string, unknown>;
  splitPlan?: Record<string, unknown>;
  runnerStatus: string;
  runnerLastTickAt: string;
  runnerLastTickResult: string;
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeStats: RuntimeStatsInput;
  lockMtime: string;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerInput;
  runnerFallbackEnabled: boolean;
  amendmentCount: number;
  lastAmendment: string;
  recent: string[];
}): TaskStatusResponseParams {
  const { meta } = input;
  const splitUnitsPlanned = asPositiveInt(meta.split_units_planned, 1);
  const plannerProjection = projectPlannerView({
    planningDecisionRaw: meta.planning_decision,
    splitPlanRaw: input.splitPlan,
  });
  const acl = extractObject(meta.acl);
  const aggregate = extractObject(meta.aggregate);
  const executionRoles = extractObject(meta.execution_roles);
  const workerSignals = extractWorkerRuntimeCoordinationSignals(meta);

  return {
    ...input,
    initialSplitStrategy: plannerProjection.initialPartition.strategy,
    initialMetaUnits: plannerProjection.initialPartition.modules,
    initialPartitionExpanded: plannerProjection.initialPartition.expanded,
    initialDecouplingPrinciple: plannerProjection.decoupling.principle,
    initialDecouplingConfidence: plannerProjection.decoupling.confidence,
    initialDecouplingRationale: plannerProjection.decoupling.rationale,
    workerRefinementRequired: plannerProjection.workerRefinement.required,
    workerRefinementScope: plannerProjection.workerRefinement.scope,
    workerRefinementStrategy: plannerProjection.workerRefinement.strategy,
    workerRefinementPrinciple: plannerProjection.workerRefinement.principle,
    workerRefinementComponentCandidates: plannerProjection.workerRefinement.componentCandidates,
    granularityGuardrailTriggered: plannerProjection.decoupling.guardrailTriggered,
    granularityGuardrailNotes: plannerProjection.decoupling.guardrailNotes,
    planningDecision: plannerProjection.planningDecision,
    splitPlan: {
      ...plannerProjection.splitPlan,
      planner_hint_contract_version: plannerProjection.dependency.plannerHintContractVersion,
    },
    plannerContractErrorCode: plannerProjection.plannerContractError?.code,
    plannerContractErrorField: plannerProjection.plannerContractError?.field,
    plannerContractErrorDetail: plannerProjection.plannerContractError?.detail,
    splitUnitsPlanned,
    acl,
    aggregate,
    executionRoles,
    workerBudgetLane: workerSignals.budget_lane ?? "(none)",
    workerConvergenceClass: workerSignals.convergence_class ?? "(none)",
    workerReclaimReason: workerSignals.reclaim_reason ?? "(none)",
    selectedTemplateId: workerSignals.selected_template_id ?? "(none)",
    selectedTemplateOrigin: workerSignals.selected_template_origin ?? "(none)",
    selectedTemplateSourceId: workerSignals.selected_template_source_id ?? "(none)",
    selectedTemplateVersion: workerSignals.template_version ?? "(none)",
    selectedTemplateRegistrationSource: workerSignals.registration_source ?? "(none)",
    selectedTemplateDeliveryMode: workerSignals.delivery_mode ?? "(none)",
    selectedTemplateKind: workerSignals.template_kind ?? "(none)",
    governancePolicyId: workerSignals.governance_policy_id ?? "(none)",
    resultContractVersion: workerSignals.result_contract_version ?? "(none)",
    allowedTemplateOrigins: workerSignals.allowed_template_origins,
    customRegistrationRequired: workerSignals.custom_registration_required,
    workerStageId: workerSignals.worker_stage_id ?? "(none)",
    workerStageRoot: workerSignals.worker_stage_root ?? "(none)",
    workerStageProfile: workerSignals.worker_stage_profile ?? "(none)",
    workerStageIsolationMode: workerSignals.worker_stage_isolation_mode ?? "(none)",
    workerStageRuntimeClass: workerSignals.worker_stage_runtime_class ?? "(none)",
    workerStageAllowedExecutionMode: workerSignals.worker_stage_allowed_execution_mode ?? "(none)",
    workerStageMaxBytes: workerSignals.worker_stage_max_bytes,
    workerStageMaxFileCount: workerSignals.worker_stage_max_file_count,
    workerStageMaxSingleFileBytes: workerSignals.worker_stage_max_single_file_bytes,
    workerStageOverflowPolicy: workerSignals.worker_stage_overflow_policy ?? "(none)",
    workerStageBytesUsed: workerSignals.worker_stage_bytes_used,
    workerStageFileCount: workerSignals.worker_stage_file_count,
    workerStageOverflowStatus: workerSignals.worker_stage_overflow_status ?? "(none)",
    workerStageRetentionPolicy: workerSignals.worker_stage_retention_policy ?? "(none)",
    workerStageExportedArtifactCount: workerSignals.worker_stage_exported_artifact_count,
    workerStageLastExportStatus: workerSignals.worker_stage_last_export_status ?? "(none)",
    workerStageLastExportManifestClass: workerSignals.worker_stage_last_export_manifest_class ?? "(none)",
    workerStageLastFaultClass: workerSignals.worker_stage_last_fault_class ?? "(none)",
    workerStageRetentionResult: workerSignals.worker_stage_retention_result,
    workerStageLastCleanupAt: workerSignals.worker_stage_last_cleanup_at ?? "(none)",
    workerStageLastRetainedArtifactIds: workerSignals.worker_stage_last_retained_artifact_ids,
    customRuntimeGateStatus: workerSignals.custom_runtime_gate_status ?? "(none)",
    customCapabilityGateReason: workerSignals.custom_capability_gate_reason ?? "(none)",
    workerStageArchiveReady: workerSignals.worker_stage_archive_ready,
    workerStageReclaimReady: workerSignals.worker_stage_reclaim_ready,
    workerStagePurgeReady: workerSignals.worker_stage_purge_ready,
    workerStageRetentionDecision: workerSignals.worker_stage_retention_decision ?? "(none)",
    clusterRoot: workerSignals.cluster_root ?? "(none)",
    defaultMessageType: workerSignals.default_message_type ?? "(none)",
    defaultTargetRoleTypes: workerSignals.default_target_role_types,
    semanticTopology: workerSignals.semantic_topology,
    implementationTopology: workerSignals.implementation_topology,
    clusterProjection: workerSignals.cluster_projection,
    taskClusterId: workerSignals.task_cluster_id ?? "(none)",
    taskClusterMailboxCounts: workerSignals.task_cluster_mailbox_counts,
    taskClusterLastMessageType: workerSignals.task_cluster_last_message_type ?? "(none)",
    keeperFeedbackTypes: workerSignals.keeper_feedback_types,
    keeperFeedbackFingerprints: workerSignals.keeper_feedback_fingerprints,
    keeperLastSubmittedAt: workerSignals.keeper_last_submitted_at ?? "(none)",
    workerRebuildReady: workerSignals.runtime_control.rebuild_ready,
    workerRebuildReason: workerSignals.runtime_control.rebuild_reason ?? "(none)",
    workerLastFaultAction: workerSignals.runtime_control.last_worker_fault_action ?? "(none)",
    workerFaultRetryable: workerSignals.runtime_control.worker_fault_retryable,
    workerFaultRequiresRebuild: workerSignals.runtime_control.worker_fault_requires_rebuild,
    workerLastFaultActionApplied: workerSignals.runtime_control.last_fault_action_applied ?? "(none)",
    workerFaultActuationMode: workerSignals.runtime_control.fault_actuation_mode ?? "(none)",
    workerFaultActionBlockedByPolicy: workerSignals.runtime_control.fault_action_blocked_by_policy,
    workerFaultClass: workerSignals.runtime_control.worker_fault_class ?? "(none)",
    workerArchiveReady: workerSignals.runtime_control.archive_ready,
    workerReclaimReady: workerSignals.runtime_control.reclaim_ready,
    workerPurgeReady: workerSignals.runtime_control.purge_ready,
    workerRetentionDecision: workerSignals.runtime_control.retention_decision ?? "(none)",
  };
}

export function buildRunSuccessResponseParams(input: {
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
  runtimeStats: RuntimeStatsInput;
  meta: Record<string, unknown>;
  splitPlan?: Record<string, unknown>;
  workspaceConfigSourceDefault: string;
  workspaceValidatedDefault: boolean;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerInput;
  runnerFallbackEnabled: boolean;
  checklistText: string;
  scriptTrace: string[];
  llmUsed: boolean;
  llmReason: string;
  llmAuthMode: string;
  llmKeySource: string;
}): RunSuccessResponseParams {
  const { meta } = input;
  const splitUnitsPlanned = asPositiveInt(meta.split_units_planned, 1);
  const plannerProjection = projectPlannerView({
    planningDecisionRaw: meta.planning_decision,
    splitPlanRaw: input.splitPlan,
  });
  const aggregate = extractObject(meta.aggregate);
  const workerSignals = extractWorkerRuntimeCoordinationSignals(meta);

  return {
    taskId: input.taskId,
    sessionKeyForRun: input.sessionKeyForRun,
    summaryId: input.summaryId,
    summaryPath: input.summaryPath,
    payload: input.payload,
    singleWorkerId: input.singleWorkerId,
    strategyPath: input.strategyPath,
    basePath: input.basePath,
    runnerStatus: input.runnerStatus,
    runnerLastTickAt: input.runnerLastTickAt,
    runnerLastTickResult: input.runnerLastTickResult,
    runnerLastTickError: input.runnerLastTickError,
    runnerIntervalSec: input.runnerIntervalSec,
    runnerExecutionMode: input.runnerExecutionMode,
    runnerBatchSize: input.runnerBatchSize,
    runnerMaxParallel: input.runnerMaxParallel,
    runtimeStats: input.runtimeStats,
    initialSplitStrategy: plannerProjection.initialPartition.strategy,
    initialMetaUnits: plannerProjection.initialPartition.modules,
    initialPartitionExpanded: plannerProjection.initialPartition.expanded,
    initialDecouplingPrinciple: plannerProjection.decoupling.principle,
    initialDecouplingConfidence: plannerProjection.decoupling.confidence,
    initialDecouplingRationale: plannerProjection.decoupling.rationale,
    workerRefinementRequired: plannerProjection.workerRefinement.required,
    workerRefinementScope: plannerProjection.workerRefinement.scope,
    workerRefinementStrategy: plannerProjection.workerRefinement.strategy,
    workerRefinementPrinciple: plannerProjection.workerRefinement.principle,
    workerRefinementComponentCandidates: plannerProjection.workerRefinement.componentCandidates,
    granularityGuardrailTriggered: plannerProjection.decoupling.guardrailTriggered,
    granularityGuardrailNotes: plannerProjection.decoupling.guardrailNotes,
    planningDecision: plannerProjection.planningDecision,
    splitPlan: {
      ...plannerProjection.splitPlan,
      planner_hint_contract_version: plannerProjection.dependency.plannerHintContractVersion,
    },
    plannerContractErrorCode: plannerProjection.plannerContractError?.code,
    plannerContractErrorField: plannerProjection.plannerContractError?.field,
    plannerContractErrorDetail: plannerProjection.plannerContractError?.detail,
    splitUnitsPlanned,
    meta,
    workspaceConfigSource: String(
      meta.workspace_config_source ?? input.workspaceConfigSourceDefault,
    ),
    workspaceValidated: Boolean(
      (meta.workspace_validated as boolean | undefined) ?? input.workspaceValidatedDefault,
    ),
    aggregate,
    runtimeConsistency: input.runtimeConsistency,
    runtimeSignature: input.runtimeSignature,
    runtimeExpectedSignature: input.runtimeExpectedSignature,
    externalRunner: input.externalRunner,
    runnerFallbackEnabled: input.runnerFallbackEnabled,
    checklistText: input.checklistText,
    scriptTrace: input.scriptTrace,
    llmUsed: input.llmUsed,
    llmReason: input.llmReason,
    llmAuthMode: input.llmAuthMode,
    llmKeySource: input.llmKeySource,
    workerBudgetLane: workerSignals.budget_lane ?? "(none)",
    workerConvergenceClass: workerSignals.convergence_class ?? "(none)",
    workerReclaimReason: workerSignals.reclaim_reason ?? "(none)",
    selectedTemplateId: workerSignals.selected_template_id ?? "(none)",
    selectedTemplateOrigin: workerSignals.selected_template_origin ?? "(none)",
    selectedTemplateSourceId: workerSignals.selected_template_source_id ?? "(none)",
    selectedTemplateVersion: workerSignals.template_version ?? "(none)",
    selectedTemplateRegistrationSource: workerSignals.registration_source ?? "(none)",
    selectedTemplateDeliveryMode: workerSignals.delivery_mode ?? "(none)",
    selectedTemplateKind: workerSignals.template_kind ?? "(none)",
    governancePolicyId: workerSignals.governance_policy_id ?? "(none)",
    resultContractVersion: workerSignals.result_contract_version ?? "(none)",
    allowedTemplateOrigins: workerSignals.allowed_template_origins,
    customRegistrationRequired: workerSignals.custom_registration_required,
    workerStageId: workerSignals.worker_stage_id ?? "(none)",
    workerStageRoot: workerSignals.worker_stage_root ?? "(none)",
    workerStageProfile: workerSignals.worker_stage_profile ?? "(none)",
    workerStageIsolationMode: workerSignals.worker_stage_isolation_mode ?? "(none)",
    workerStageRuntimeClass: workerSignals.worker_stage_runtime_class ?? "(none)",
    workerStageAllowedExecutionMode: workerSignals.worker_stage_allowed_execution_mode ?? "(none)",
    workerStageMaxBytes: workerSignals.worker_stage_max_bytes,
    workerStageMaxFileCount: workerSignals.worker_stage_max_file_count,
    workerStageMaxSingleFileBytes: workerSignals.worker_stage_max_single_file_bytes,
    workerStageOverflowPolicy: workerSignals.worker_stage_overflow_policy ?? "(none)",
    workerStageBytesUsed: workerSignals.worker_stage_bytes_used,
    workerStageFileCount: workerSignals.worker_stage_file_count,
    workerStageOverflowStatus: workerSignals.worker_stage_overflow_status ?? "(none)",
    workerStageRetentionPolicy: workerSignals.worker_stage_retention_policy ?? "(none)",
    workerStageExportedArtifactCount: workerSignals.worker_stage_exported_artifact_count,
    workerStageLastExportStatus: workerSignals.worker_stage_last_export_status ?? "(none)",
    workerStageLastExportManifestClass: workerSignals.worker_stage_last_export_manifest_class ?? "(none)",
    workerStageLastFaultClass: workerSignals.worker_stage_last_fault_class ?? "(none)",
    workerStageRetentionResult: workerSignals.worker_stage_retention_result,
    workerStageLastCleanupAt: workerSignals.worker_stage_last_cleanup_at ?? "(none)",
    workerStageLastRetainedArtifactIds: workerSignals.worker_stage_last_retained_artifact_ids,
    customRuntimeGateStatus: workerSignals.custom_runtime_gate_status ?? "(none)",
    customCapabilityGateReason: workerSignals.custom_capability_gate_reason ?? "(none)",
    workerStageArchiveReady: workerSignals.worker_stage_archive_ready,
    workerStageReclaimReady: workerSignals.worker_stage_reclaim_ready,
    workerStagePurgeReady: workerSignals.worker_stage_purge_ready,
    workerStageRetentionDecision: workerSignals.worker_stage_retention_decision ?? "(none)",
    clusterRoot: workerSignals.cluster_root ?? "(none)",
    defaultMessageType: workerSignals.default_message_type ?? "(none)",
    defaultTargetRoleTypes: workerSignals.default_target_role_types,
    semanticTopology: workerSignals.semantic_topology,
    implementationTopology: workerSignals.implementation_topology,
    clusterProjection: workerSignals.cluster_projection,
    taskClusterId: workerSignals.task_cluster_id ?? "(none)",
    taskClusterMailboxCounts: workerSignals.task_cluster_mailbox_counts,
    taskClusterLastMessageType: workerSignals.task_cluster_last_message_type ?? "(none)",
    keeperFeedbackTypes: workerSignals.keeper_feedback_types,
    keeperFeedbackFingerprints: workerSignals.keeper_feedback_fingerprints,
    keeperLastSubmittedAt: workerSignals.keeper_last_submitted_at ?? "(none)",
    workerRebuildReady: workerSignals.runtime_control.rebuild_ready,
    workerRebuildReason: workerSignals.runtime_control.rebuild_reason ?? "(none)",
    workerLastFaultAction: workerSignals.runtime_control.last_worker_fault_action ?? "(none)",
    workerFaultRetryable: workerSignals.runtime_control.worker_fault_retryable,
    workerFaultRequiresRebuild: workerSignals.runtime_control.worker_fault_requires_rebuild,
    workerLastFaultActionApplied: workerSignals.runtime_control.last_fault_action_applied ?? "(none)",
    workerFaultActuationMode: workerSignals.runtime_control.fault_actuation_mode ?? "(none)",
    workerFaultActionBlockedByPolicy: workerSignals.runtime_control.fault_action_blocked_by_policy,
    workerFaultClass: workerSignals.runtime_control.worker_fault_class ?? "(none)",
    workerArchiveReady: workerSignals.runtime_control.archive_ready,
    workerReclaimReady: workerSignals.runtime_control.reclaim_ready,
    workerPurgeReady: workerSignals.runtime_control.purge_ready,
    workerRetentionDecision: workerSignals.runtime_control.retention_decision ?? "(none)",
  };
}
