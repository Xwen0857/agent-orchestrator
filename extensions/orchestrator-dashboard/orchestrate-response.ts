import {
  extractRuntimeReplanSignals,
  extractWorkerRuntimeCoordinationSignals,
} from "./orchestrate-runtime-contract.js";
import { buildDependencyHintsFromRefinementPartitionRaw } from "./orchestrate-planner-hints-contract.js";

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
  initialSplitStrategy: string;
  initialMetaUnits: number;
  initialPartitionExpanded: boolean;
  initialDecouplingPrinciple: string;
  initialDecouplingConfidence: string;
  initialDecouplingRationale: string[];
  workerRefinementRequired: boolean;
  workerRefinementScope: string;
  workerRefinementStrategy: string;
  workerRefinementPrinciple: string;
  workerRefinementComponentCandidates: string[];
  granularityGuardrailTriggered: boolean;
  granularityGuardrailNotes: string[];
  planningDecision: Record<string, unknown>;
  splitPlan: Record<string, unknown>;
  plannerContractErrorCode?: string;
  plannerContractErrorField?: string;
  plannerContractErrorDetail?: string;
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
  recent: string[];
  workerBudgetLane: string;
  workerConvergenceClass: string;
  workerReclaimReason: string;
  selectedTemplateId: string;
  selectedTemplateOrigin: string;
  selectedTemplateSourceId: string;
  selectedTemplateVersion: string;
  selectedTemplateRegistrationSource: string;
  selectedTemplateDeliveryMode: string;
  selectedTemplateKind: string;
  governancePolicyId: string;
  resultContractVersion: string;
  allowedTemplateOrigins: string[];
  customRegistrationRequired: boolean;
  workerStageId: string;
  workerStageRoot: string;
  workerStageProfile: string;
  workerStageIsolationMode: string;
  workerStageRuntimeClass: string;
  workerStageAllowedExecutionMode: string;
  workerStageMaxBytes: number;
  workerStageMaxFileCount: number;
  workerStageMaxSingleFileBytes: number;
  workerStageOverflowPolicy: string;
  workerStageBytesUsed: number;
  workerStageFileCount: number;
  workerStageOverflowStatus: string;
  workerStageRetentionPolicy: string;
  workerStageExportedArtifactCount: number;
  workerStageLastExportStatus: string;
  workerStageLastExportManifestClass: string;
  workerStageLastFaultClass: string;
  workerStageRetentionResult: Record<string, unknown>;
  workerStageLastCleanupAt: string;
  workerStageLastRetainedArtifactIds: string[];
  customRuntimeGateStatus: string;
  customCapabilityGateReason?: string;
  workerStageArchiveReady?: boolean;
  workerStageReclaimReady?: boolean;
  workerStagePurgeReady?: boolean;
  workerStageRetentionDecision?: string;
  clusterRoot: string;
  defaultMessageType: string;
  defaultTargetRoleTypes: string[];
  semanticTopology: Record<string, unknown>;
  implementationTopology: Record<string, unknown>;
  clusterProjection: Record<string, unknown>;
  taskClusterId: string;
  taskClusterMailboxCounts: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
  taskClusterLastMessageType: string;
  keeperFeedbackTypes: string[];
  keeperFeedbackFingerprints: string[];
  keeperLastSubmittedAt: string;
  workerRebuildReady: boolean;
  workerRebuildReason: string;
  workerLastFaultAction: string;
  workerFaultRetryable: boolean;
  workerFaultRequiresRebuild: boolean;
  workerLastFaultActionApplied: string;
  workerFaultActuationMode: string;
  workerFaultActionBlockedByPolicy: boolean;
  workerFaultClass: string;
  workerArchiveReady?: boolean;
  workerReclaimReady?: boolean;
  workerPurgeReady?: boolean;
  workerRetentionDecision?: string;
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
  initialSplitStrategy: string;
  initialMetaUnits: number;
  initialPartitionExpanded: boolean;
  initialDecouplingPrinciple: string;
  initialDecouplingConfidence: string;
  initialDecouplingRationale: string[];
  workerRefinementRequired: boolean;
  workerRefinementScope: string;
  workerRefinementStrategy: string;
  workerRefinementPrinciple: string;
  workerRefinementComponentCandidates: string[];
  granularityGuardrailTriggered: boolean;
  granularityGuardrailNotes: string[];
  planningDecision: Record<string, unknown>;
  splitPlan: Record<string, unknown>;
  plannerContractErrorCode?: string;
  plannerContractErrorField?: string;
  plannerContractErrorDetail?: string;
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
  workerBudgetLane: string;
  workerConvergenceClass: string;
  workerReclaimReason: string;
  selectedTemplateId: string;
  selectedTemplateOrigin: string;
  selectedTemplateSourceId: string;
  selectedTemplateVersion: string;
  selectedTemplateRegistrationSource: string;
  selectedTemplateDeliveryMode: string;
  selectedTemplateKind: string;
  governancePolicyId: string;
  resultContractVersion: string;
  allowedTemplateOrigins: string[];
  customRegistrationRequired: boolean;
  workerStageId: string;
  workerStageRoot: string;
  workerStageProfile: string;
  workerStageIsolationMode: string;
  workerStageRuntimeClass: string;
  workerStageAllowedExecutionMode: string;
  workerStageMaxBytes: number;
  workerStageMaxFileCount: number;
  workerStageMaxSingleFileBytes: number;
  workerStageOverflowPolicy: string;
  workerStageBytesUsed: number;
  workerStageFileCount: number;
  workerStageOverflowStatus: string;
  workerStageRetentionPolicy: string;
  workerStageExportedArtifactCount: number;
  workerStageLastExportStatus: string;
  workerStageLastExportManifestClass: string;
  workerStageLastFaultClass: string;
  workerStageRetentionResult: Record<string, unknown>;
  workerStageLastCleanupAt: string;
  workerStageLastRetainedArtifactIds: string[];
  customRuntimeGateStatus: string;
  customCapabilityGateReason?: string;
  workerStageArchiveReady?: boolean;
  workerStageReclaimReady?: boolean;
  workerStagePurgeReady?: boolean;
  workerStageRetentionDecision?: string;
  clusterRoot: string;
  defaultMessageType: string;
  defaultTargetRoleTypes: string[];
  semanticTopology: Record<string, unknown>;
  implementationTopology: Record<string, unknown>;
  clusterProjection: Record<string, unknown>;
  taskClusterId: string;
  taskClusterMailboxCounts: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
  taskClusterLastMessageType: string;
  keeperFeedbackTypes: string[];
  keeperFeedbackFingerprints: string[];
  keeperLastSubmittedAt: string;
  workerRebuildReady: boolean;
  workerRebuildReason: string;
  workerLastFaultAction: string;
  workerFaultRetryable: boolean;
  workerFaultRequiresRebuild: boolean;
  workerLastFaultActionApplied: string;
  workerFaultActuationMode: string;
  workerFaultActionBlockedByPolicy: boolean;
  workerFaultClass: string;
  workerArchiveReady?: boolean;
  workerReclaimReady?: boolean;
  workerPurgeReady?: boolean;
  workerRetentionDecision?: string;
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

function renderSplitPlanSummary(splitPlan: Record<string, unknown>): string[] {
  const initialPartition =
    splitPlan.initial_partition &&
    typeof splitPlan.initial_partition === "object" &&
    !Array.isArray(splitPlan.initial_partition)
      ? (splitPlan.initial_partition as Record<string, unknown>)
      : {};
  const refinementPartition =
    splitPlan.refinement_partition &&
    typeof splitPlan.refinement_partition === "object" &&
    !Array.isArray(splitPlan.refinement_partition)
      ? (splitPlan.refinement_partition as Record<string, unknown>)
      : {};
  const modules = Array.isArray(initialPartition.modules) ? initialPartition.modules.length : 0;
  const leafUnits = Array.isArray(refinementPartition.leaf_units)
    ? refinementPartition.leaf_units.length
    : 0;
  const leafUnitEntries = Array.isArray(refinementPartition.leaf_units)
    ? (refinementPartition.leaf_units as Array<Record<string, unknown>>)
    : [];
  const componentCandidates = Array.isArray(refinementPartition.component_candidates)
    ? refinementPartition.component_candidates.length
    : 0;
  const componentBoundLeafs = leafUnitEntries.filter((leaf) => {
    const value = leaf.component_candidate;
    return typeof value === "string" && value.length > 0;
  }).length;
  const dependencyHints = buildDependencyHintsFromRefinementPartitionRaw(refinementPartition);
  const inputScope = String(refinementPartition.input_scope ?? "(none)");

  return [
    `planner_phase: ${String(splitPlan.planner_phase || "(none)")}`,
    `decomposition_strategy: ${String(splitPlan.decomposition_strategy || "(none)")}`,
    `release_policy: ${String(splitPlan.release_policy || "(none)")}`,
    `initial_partition_strategy: ${String(initialPartition.strategy ?? "(none)")}`,
    `initial_partition_modules: ${String(modules)}`,
    `refinement_partition_strategy: ${String(refinementPartition.strategy ?? "(none)")}`,
    `refinement_input_scope: ${inputScope}`,
    `refinement_component_candidates: ${String(componentCandidates)}`,
    `refinement_component_bound_leafs: ${String(componentBoundLeafs)}`,
    `refinement_dependency_mode: ${dependencyHints.mode}`,
    `refinement_dependency_roots: ${String(dependencyHints.roots)}`,
    `refinement_dependency_blocked: ${String(dependencyHints.blocked)}`,
    `refinement_dependency_links: ${String(dependencyHints.links)}`,
    `refinement_cross_module_links: ${String(dependencyHints.cross_module_links)}`,
    `refinement_dependency_note: ${dependencyHints.note}`,
    `planner_hint_contract_version: ${String(splitPlan.planner_hint_contract_version ?? "(none)")}`,
    `refinement_leaf_units: ${String(leafUnits)}`,
  ];
}

function renderReplanSummary(meta: Record<string, unknown>): string[] {
  const replan = extractRuntimeReplanSignals(meta);
  return [
    `planner_replan_status: ${replan.status ?? "(none)"}`,
    `planner_replan_impact: ${replan.impact ?? "(none)"}`,
    `planner_replan_worker_policy: ${replan.worker_policy ?? "(none)"}`,
    `runtime_replan_consume_status: ${replan.execution_status ?? "(none)"}`,
    `planner_replan_scope_summary: ${replan.scope_summary.join(", ") || "(none)"}`,
    `planner_replan_requested_at: ${replan.requested_at ?? "(none)"}`,
    `planner_replan_applied_at: ${replan.applied_at ?? "(none)"}`,
    `runtime_replan_consumed_at: ${replan.consumed_at ?? "(none)"}`,
    `runtime_replan_resumed_at: ${replan.resumed_at ?? "(none)"}`,
  ];
}

function renderWorkerRuntimeSummary(meta: Record<string, unknown>): string[] {
  const worker = extractWorkerRuntimeCoordinationSignals(meta);
  return [
    `worker_budget_lane: ${worker.budget_lane ?? "(none)"}`,
    `worker_convergence_class: ${worker.convergence_class ?? "(none)"}`,
    `worker_reclaim_reason: ${worker.reclaim_reason ?? "(none)"}`,
    `worker_selected_template_id: ${worker.selected_template_id ?? "(none)"}`,
    `worker_selected_template_origin: ${worker.selected_template_origin ?? "(none)"}`,
    `worker_selected_template_source_id: ${worker.selected_template_source_id ?? "(none)"}`,
    `worker_selected_template_version: ${worker.template_version ?? "(none)"}`,
    `worker_selected_template_registration_source: ${worker.registration_source ?? "(none)"}`,
    `worker_delivery_mode: ${worker.delivery_mode ?? "(none)"}`,
    `worker_template_kind: ${worker.template_kind ?? "(none)"}`,
    `worker_governance_policy_id: ${worker.governance_policy_id ?? "(none)"}`,
    `worker_result_contract_version: ${worker.result_contract_version ?? "(none)"}`,
    `worker_allowed_template_origins: ${worker.allowed_template_origins.join(", ") || "(none)"}`,
    `worker_custom_registration_required: ${worker.custom_registration_required ? "true" : "false"}`,
    `workerStage_id: ${worker.worker_stage_id ?? "(none)"}`,
    `workerStage_root: ${worker.worker_stage_root ?? "(none)"}`,
    `workerStage_profile: ${worker.worker_stage_profile ?? "(none)"}`,
    `workerStage_isolation_mode: ${worker.worker_stage_isolation_mode ?? "(none)"}`,
    `workerStage_runtime_class: ${worker.worker_stage_runtime_class ?? "(none)"}`,
    `workerStage_allowed_execution_mode: ${worker.worker_stage_allowed_execution_mode ?? "(none)"}`,
    `workerStage_max_bytes: ${String(worker.worker_stage_max_bytes)}`,
    `workerStage_max_file_count: ${String(worker.worker_stage_max_file_count)}`,
    `workerStage_max_single_file_bytes: ${String(worker.worker_stage_max_single_file_bytes)}`,
    `workerStage_overflow_policy: ${worker.worker_stage_overflow_policy ?? "(none)"}`,
    `workerStage_bytes_used: ${String(worker.worker_stage_bytes_used)}`,
    `workerStage_file_count: ${String(worker.worker_stage_file_count)}`,
    `workerStage_overflow_status: ${worker.worker_stage_overflow_status ?? "(none)"}`,
    `workerStage_retention_policy: ${worker.worker_stage_retention_policy ?? "(none)"}`,
    `workerStage_exported_artifact_count: ${String(worker.worker_stage_exported_artifact_count)}`,
    `workerStage_last_export_status: ${worker.worker_stage_last_export_status ?? "(none)"}`,
    `workerStage_last_export_manifest_class: ${worker.worker_stage_last_export_manifest_class ?? "(none)"}`,
    `workerStage_last_fault_class: ${worker.worker_stage_last_fault_class ?? "(none)"}`,
    `workerStage_retention_result: ${JSON.stringify(worker.worker_stage_retention_result)}`,
    `workerStage_last_cleanup_at: ${worker.worker_stage_last_cleanup_at ?? "(none)"}`,
    `workerStage_last_retained_artifact_ids: ${worker.worker_stage_last_retained_artifact_ids.join(", ") || "(none)"}`,
    `worker_custom_runtime_gate_status: ${worker.custom_runtime_gate_status ?? "(none)"}`,
    `worker_custom_capability_gate_reason: ${worker.custom_capability_gate_reason ?? "(none)"}`,
    `workerStage_archive_ready: ${worker.worker_stage_archive_ready ? "true" : "false"}`,
    `workerStage_reclaim_ready: ${worker.worker_stage_reclaim_ready ? "true" : "false"}`,
    `workerStage_purge_ready: ${worker.worker_stage_purge_ready ? "true" : "false"}`,
    `workerStage_retention_decision: ${worker.worker_stage_retention_decision ?? "(none)"}`,
    `worker_default_message_type: ${worker.default_message_type ?? "(none)"}`,
    `worker_default_target_role_types: ${worker.default_target_role_types.join(", ") || "(none)"}`,
    `worker_semantic_topology: ${JSON.stringify(worker.semantic_topology)}`,
    `worker_implementation_topology: ${JSON.stringify(worker.implementation_topology)}`,
    `worker_cluster_projection: ${JSON.stringify(worker.cluster_projection)}`,
    `task_cluster_id: ${worker.task_cluster_id ?? "(none)"}`,
    `task_cluster_root: ${worker.cluster_root ?? "(none)"}`,
    `task_cluster_mailbox_counts: published=${worker.task_cluster_mailbox_counts.published},acknowledged=${worker.task_cluster_mailbox_counts.acknowledged},consumed=${worker.task_cluster_mailbox_counts.consumed},archived=${worker.task_cluster_mailbox_counts.archived}`,
    `task_cluster_last_message_type: ${worker.task_cluster_last_message_type ?? "(none)"}`,
    `keeper_feedback_types: ${worker.keeper_feedback_types.join(", ") || "(none)"}`,
    `keeper_feedback_fingerprints: ${worker.keeper_feedback_fingerprints.join(", ") || "(none)"}`,
    `keeper_last_submitted_at: ${worker.keeper_last_submitted_at ?? "(none)"}`,
    `worker_rebuild_ready: ${worker.runtime_control.rebuild_ready ? "true" : "false"}`,
    `worker_rebuild_reason: ${worker.runtime_control.rebuild_reason ?? "(none)"}`,
    `worker_last_fault_action: ${worker.runtime_control.last_worker_fault_action ?? "(none)"}`,
    `worker_fault_retryable: ${worker.runtime_control.worker_fault_retryable ? "true" : "false"}`,
    `worker_fault_requires_rebuild: ${worker.runtime_control.worker_fault_requires_rebuild ? "true" : "false"}`,
    `worker_last_fault_action_applied: ${worker.runtime_control.last_fault_action_applied ?? "(none)"}`,
    `worker_fault_actuation_mode: ${worker.runtime_control.fault_actuation_mode ?? "(none)"}`,
    `worker_fault_action_blocked_by_policy: ${worker.runtime_control.fault_action_blocked_by_policy ? "true" : "false"}`,
    `worker_fault_class: ${worker.runtime_control.worker_fault_class ?? "(none)"}`,
    `worker_archive_ready: ${worker.runtime_control.archive_ready ? "true" : "false"}`,
    `worker_reclaim_ready: ${worker.runtime_control.reclaim_ready ? "true" : "false"}`,
    `worker_purge_ready: ${worker.runtime_control.purge_ready ? "true" : "false"}`,
    `worker_retention_decision: ${worker.runtime_control.retention_decision ?? "(none)"}`,
  ];
}

function extractDecisionLayerContext(
  planningDecision: Record<string, unknown>,
  splitPlan: Record<string, unknown>,
): {
  metaDecomposition: Record<string, unknown>;
  workerRefinement: Record<string, unknown>;
  granularityGuardrails: Record<string, unknown>;
} {
  const splitPlanDecisionContext =
    splitPlan.decision_context &&
    typeof splitPlan.decision_context === "object" &&
    !Array.isArray(splitPlan.decision_context)
      ? (splitPlan.decision_context as Record<string, unknown>)
      : {};
  const metaDecomposition =
    planningDecision.meta_decomposition &&
    typeof planningDecision.meta_decomposition === "object" &&
    !Array.isArray(planningDecision.meta_decomposition)
      ? (planningDecision.meta_decomposition as Record<string, unknown>)
      : splitPlanDecisionContext.meta_decomposition &&
            typeof splitPlanDecisionContext.meta_decomposition === "object" &&
            !Array.isArray(splitPlanDecisionContext.meta_decomposition)
        ? (splitPlanDecisionContext.meta_decomposition as Record<string, unknown>)
        : {};
  const workerRefinement =
    planningDecision.worker_refinement &&
    typeof planningDecision.worker_refinement === "object" &&
    !Array.isArray(planningDecision.worker_refinement)
      ? (planningDecision.worker_refinement as Record<string, unknown>)
      : splitPlanDecisionContext.worker_refinement &&
            typeof splitPlanDecisionContext.worker_refinement === "object" &&
            !Array.isArray(splitPlanDecisionContext.worker_refinement)
        ? (splitPlanDecisionContext.worker_refinement as Record<string, unknown>)
        : {};
  const granularityGuardrails =
    planningDecision.granularity_guardrails &&
    typeof planningDecision.granularity_guardrails === "object" &&
    !Array.isArray(planningDecision.granularity_guardrails)
      ? (planningDecision.granularity_guardrails as Record<string, unknown>)
      : splitPlanDecisionContext.granularity_guardrails &&
            typeof splitPlanDecisionContext.granularity_guardrails === "object" &&
            !Array.isArray(splitPlanDecisionContext.granularity_guardrails)
        ? (splitPlanDecisionContext.granularity_guardrails as Record<string, unknown>)
        : {};
  return {
    metaDecomposition,
    workerRefinement,
    granularityGuardrails,
  };
}

function extractPlannerDecisionContext(
  planningDecision: Record<string, unknown>,
  splitPlan: Record<string, unknown>,
): Record<string, unknown> {
  const splitPlanDecisionContext =
    splitPlan.decision_context &&
    typeof splitPlan.decision_context === "object" &&
    !Array.isArray(splitPlan.decision_context)
      ? (splitPlan.decision_context as Record<string, unknown>)
      : {};
  const tokenPriorityContext =
    planningDecision.token_priority_context &&
    typeof planningDecision.token_priority_context === "object" &&
    !Array.isArray(planningDecision.token_priority_context)
      ? (planningDecision.token_priority_context as Record<string, unknown>)
      : splitPlanDecisionContext.token_priority_context &&
            typeof splitPlanDecisionContext.token_priority_context === "object" &&
            !Array.isArray(splitPlanDecisionContext.token_priority_context)
        ? (splitPlanDecisionContext.token_priority_context as Record<string, unknown>)
        : {};
  const mcpSignals =
    planningDecision.mcp_soft_boundary_signals &&
    typeof planningDecision.mcp_soft_boundary_signals === "object" &&
    !Array.isArray(planningDecision.mcp_soft_boundary_signals)
      ? (planningDecision.mcp_soft_boundary_signals as Record<string, unknown>)
      : splitPlanDecisionContext.mcp_soft_boundary_signals &&
            typeof splitPlanDecisionContext.mcp_soft_boundary_signals === "object" &&
            !Array.isArray(splitPlanDecisionContext.mcp_soft_boundary_signals)
        ? (splitPlanDecisionContext.mcp_soft_boundary_signals as Record<string, unknown>)
        : {};

  return {
    llmRole: String(planningDecision.llm_role ?? splitPlanDecisionContext.llm_role ?? "(none)"),
    llmDecisionUsed:
      typeof planningDecision.llm_decision_used === "boolean"
        ? planningDecision.llm_decision_used
        : typeof splitPlanDecisionContext.llm_decision_used === "boolean"
          ? splitPlanDecisionContext.llm_decision_used
          : null,
    tokenPriorityContext,
    mcpSignals,
    agentContractVersion: String(
      planningDecision.agent_contract_version ?? splitPlanDecisionContext.agent_contract_version ?? "(none)",
    ),
  };
}

function renderPlannerAgentSummary(
  planningDecision: Record<string, unknown>,
  splitPlan: Record<string, unknown>,
): string[] {
  const plannerContext = extractPlannerDecisionContext(planningDecision, splitPlan);
  const tokenPriorityContext = plannerContext.tokenPriorityContext as Record<string, unknown>;
  const mcpSignals = plannerContext.mcpSignals as Record<string, unknown>;

  return [
    `planner_llm_role: ${plannerContext.llmRole}`,
    `planner_llm_used: ${plannerContext.llmDecisionUsed === null ? "(none)" : plannerContext.llmDecisionUsed ? "true" : "false"}`,
    `planner_token_tier: ${String(tokenPriorityContext.tier ?? "(none)")}`,
    `planner_effective_tokens: ${String(tokenPriorityContext.effective_planning_tokens ?? "(none)")}`,
    `planner_inline_override_applied: ${typeof tokenPriorityContext.inline_override_applied === "boolean" ? (tokenPriorityContext.inline_override_applied ? "true" : "false") : "(none)"}`,
    `planner_mcp_mode: ${String(mcpSignals.mode ?? "(none)")}`,
    `planner_mcp_isolation_enabled: ${typeof mcpSignals.isolation_enabled === "boolean" ? (mcpSignals.isolation_enabled ? "true" : "false") : "(none)"}`,
    `planner_orchestrator_profile: ${String(mcpSignals.orchestrator_profile_name ?? "(none)")}`,
    `planner_project_profile: ${String(mcpSignals.project_profile_name ?? "(none)")}`,
    `planner_agent_contract_version: ${plannerContext.agentContractVersion}`,
  ];
}

function renderPlannerDecompositionSummary(
  params: {
    initialSplitStrategy: string;
    initialMetaUnits: number;
    initialPartitionExpanded: boolean;
    initialDecouplingPrinciple: string;
    initialDecouplingConfidence: string;
    initialDecouplingRationale: string[];
    workerRefinementRequired: boolean;
    workerRefinementScope: string;
    workerRefinementStrategy: string;
    workerRefinementPrinciple: string;
    workerRefinementComponentCandidates: string[];
    granularityGuardrailTriggered: boolean;
    granularityGuardrailNotes: string[];
    planningDecision: Record<string, unknown>;
    splitPlan: Record<string, unknown>;
  },
): string[] {
  const { initialSplitStrategy, initialMetaUnits, initialPartitionExpanded, initialDecouplingPrinciple, initialDecouplingConfidence, initialDecouplingRationale, workerRefinementRequired, workerRefinementScope, workerRefinementStrategy, workerRefinementPrinciple, workerRefinementComponentCandidates, granularityGuardrailTriggered, granularityGuardrailNotes, planningDecision, splitPlan } =
    params;
  const { metaDecomposition, workerRefinement, granularityGuardrails } = extractDecisionLayerContext(
    planningDecision,
    splitPlan,
  );
  const fallbackRationale = Array.isArray(metaDecomposition.decoupling_rationale)
    ? metaDecomposition.decoupling_rationale.map((entry) => String(entry)).filter(Boolean)
    : [];
  const guardrailNotes = granularityGuardrailNotes.length
    ? granularityGuardrailNotes
    : Array.isArray(granularityGuardrails.guardrail_notes)
      ? granularityGuardrails.guardrail_notes.map((entry) => String(entry)).filter(Boolean)
      : [];
  const refinementComponents = workerRefinementComponentCandidates.length
    ? workerRefinementComponentCandidates
    : Array.isArray(workerRefinement.component_candidates)
      ? workerRefinement.component_candidates.map((entry) => String(entry)).filter(Boolean)
      : [];
  return [
    `initial_partition_strategy: ${initialSplitStrategy || String(metaDecomposition.decomposition_strategy ?? "(none)")}`,
    `initial_meta_units: ${String(initialMetaUnits)}`,
    `initial_partition_expanded: ${initialPartitionExpanded ? "true" : "false"}`,
    `initial_decoupling_principle: ${initialDecouplingPrinciple || String(metaDecomposition.primary_principle ?? "(none)")}`,
    `initial_decoupling_confidence: ${initialDecouplingConfidence || String(metaDecomposition.decoupling_confidence ?? "(none)")}`,
    `initial_decoupling_rationale: ${(initialDecouplingRationale.length ? initialDecouplingRationale : fallbackRationale).join(", ") || "(none)"}`,
    `worker_refinement_required: ${workerRefinementRequired ? "true" : workerRefinement.required === true ? "true" : "(none)"}`,
    `worker_refinement_scope: ${workerRefinementScope || String(workerRefinement.refinement_scope ?? "(none)")}`,
    `worker_refinement_strategy: ${workerRefinementStrategy || String(workerRefinement.refinement_strategy ?? "(none)")}`,
    `worker_refinement_principle: ${workerRefinementPrinciple || String(workerRefinement.primary_principle ?? "(none)")}`,
    `worker_refinement_component_candidates: ${refinementComponents.join(", ") || "(none)"}`,
    `granularity_guardrail_triggered: ${(
      granularityGuardrailTriggered || granularityGuardrails.guardrail_triggered === true
    )
      ? "true"
      : "false"}`,
    `granularity_guardrail_notes: ${guardrailNotes.join(", ") || "(none)"}`,
  ];
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
    initialSplitStrategy,
    initialMetaUnits,
    initialPartitionExpanded,
    initialDecouplingPrinciple,
    initialDecouplingConfidence,
    initialDecouplingRationale,
    workerRefinementRequired,
    workerRefinementScope,
    workerRefinementStrategy,
    workerRefinementPrinciple,
    workerRefinementComponentCandidates,
    granularityGuardrailTriggered,
    granularityGuardrailNotes,
    planningDecision,
    splitPlan,
    plannerContractErrorCode,
    plannerContractErrorField,
    plannerContractErrorDetail,
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
    recent,
    workerBudgetLane,
    workerConvergenceClass,
    workerReclaimReason,
    selectedTemplateId,
    selectedTemplateOrigin,
    selectedTemplateSourceId,
    selectedTemplateVersion,
    selectedTemplateRegistrationSource,
    selectedTemplateDeliveryMode,
    selectedTemplateKind,
    governancePolicyId,
    resultContractVersion,
    allowedTemplateOrigins,
    customRegistrationRequired,
    workerStageId,
    workerStageRoot,
    workerStageProfile,
    workerStageIsolationMode,
    workerStageRuntimeClass,
    workerStageAllowedExecutionMode,
    workerStageMaxBytes,
    workerStageMaxFileCount,
    workerStageMaxSingleFileBytes,
    workerStageOverflowPolicy,
    workerStageBytesUsed,
    workerStageFileCount,
    workerStageOverflowStatus,
    workerStageRetentionPolicy,
    workerStageExportedArtifactCount,
    workerStageLastExportStatus,
    workerStageLastExportManifestClass,
    workerStageLastFaultClass,
    workerStageRetentionResult,
    workerStageLastCleanupAt,
    workerStageLastRetainedArtifactIds,
    customRuntimeGateStatus,
    customCapabilityGateReason,
    workerStageArchiveReady,
    workerStageReclaimReady,
    workerStagePurgeReady,
    workerStageRetentionDecision,
    clusterRoot,
    defaultMessageType,
    defaultTargetRoleTypes,
    semanticTopology,
    implementationTopology,
    clusterProjection,
    taskClusterId,
    taskClusterMailboxCounts,
    taskClusterLastMessageType,
    keeperFeedbackTypes,
    keeperFeedbackFingerprints,
    keeperLastSubmittedAt,
    workerRebuildReady,
    workerRebuildReason,
    workerLastFaultAction,
    workerFaultRetryable,
    workerFaultRequiresRebuild,
    workerLastFaultActionApplied,
    workerFaultActuationMode,
    workerFaultActionBlockedByPolicy,
    workerFaultClass,
    workerArchiveReady,
    workerReclaimReady,
    workerPurgeReady,
    workerRetentionDecision,
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
    "planner_ingress: auto-only",
    `decision_source: ${String(planningDecision.decision_source ?? "(none)")}`,
    `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
    `planner_contract_error_code: ${plannerContractErrorCode ?? "(none)"}`,
    `planner_contract_error_field: ${plannerContractErrorField ?? "(none)"}`,
    `planner_contract_error_detail: ${plannerContractErrorDetail ?? "(none)"}`,
    ...renderReplanSummary(meta),
    ...renderWorkerRuntimeSummary({
      ...meta,
      worker_budget: { ...(meta.worker_budget as Record<string, unknown> | undefined), budget_lane: workerBudgetLane },
        worker_convergence: {
          ...(meta.worker_convergence as Record<string, unknown> | undefined),
          convergence_class: workerConvergenceClass,
          reclaim_reason: workerReclaimReason,
        },
        worker_runtime: {
          ...(meta.worker_runtime as Record<string, unknown> | undefined),
          selected_template_id: selectedTemplateId,
          selected_template_origin: selectedTemplateOrigin,
          selected_template_source_id: selectedTemplateSourceId,
          template_version: selectedTemplateVersion,
          registration_source: selectedTemplateRegistrationSource,
          delivery_mode: selectedTemplateDeliveryMode,
          template_kind: selectedTemplateKind,
          governance_policy_id: governancePolicyId,
          result_contract_version: resultContractVersion,
          allowed_template_origins: allowedTemplateOrigins,
          custom_registration_required: customRegistrationRequired,
          custom_runtime_gate_status: customRuntimeGateStatus,
          custom_capability_gate_reason: customCapabilityGateReason,
          default_message_type: defaultMessageType,
          default_target_role_types: defaultTargetRoleTypes,
          semantic_topology: semanticTopology,
          implementation_topology: implementationTopology,
          cluster_projection: clusterProjection,
        },
        worker_stage: {
          ...(meta.worker_stage as Record<string, unknown> | undefined),
          worker_stage_id: workerStageId,
          worker_stage_root: workerStageRoot,
          worker_stage_profile: workerStageProfile,
          stage_isolation_mode: workerStageIsolationMode,
          stage_runtime_class: workerStageRuntimeClass,
          allowed_execution_mode: workerStageAllowedExecutionMode,
          allocation: {
            ...((
              (meta.worker_stage as Record<string, unknown> | undefined)?.allocation as
                | Record<string, unknown>
                | undefined
            ) ?? {}),
            worker_stage_max_bytes: workerStageMaxBytes,
            worker_stage_max_file_count: workerStageMaxFileCount,
            worker_stage_max_single_file_bytes: workerStageMaxSingleFileBytes,
            worker_stage_overflow_policy: workerStageOverflowPolicy,
            worker_stage_bytes_used: workerStageBytesUsed,
            worker_stage_file_count: workerStageFileCount,
            worker_stage_overflow_status: workerStageOverflowStatus,
          },
          retention: {
            ...((
              (meta.worker_stage as Record<string, unknown> | undefined)?.retention as
                | Record<string, unknown>
                | undefined
            ) ?? {}),
            worker_stage_retention_policy: workerStageRetentionPolicy,
            worker_stage_exported_artifact_count: workerStageExportedArtifactCount,
            worker_stage_last_export_status: workerStageLastExportStatus,
            worker_stage_last_export_manifest_class: workerStageLastExportManifestClass,
            worker_stage_last_fault_class: workerStageLastFaultClass,
            worker_stage_retention_result: workerStageRetentionResult,
            worker_stage_last_cleanup_at: workerStageLastCleanupAt,
            worker_stage_last_retained_artifact_ids: workerStageLastRetainedArtifactIds,
            worker_stage_archive_ready: workerStageArchiveReady,
            worker_stage_reclaim_ready: workerStageReclaimReady,
            worker_stage_purge_ready: workerStagePurgeReady,
            worker_stage_retention_decision: workerStageRetentionDecision,
          },
        },
      task_cluster: {
        ...(meta.task_cluster as Record<string, unknown> | undefined),
        cluster_id: taskClusterId,
        cluster_root: clusterRoot,
        mailbox_counters: taskClusterMailboxCounts,
        last_published_message_type: taskClusterLastMessageType,
      },
      keeper_feedback: {
        ...(meta.keeper_feedback as Record<string, unknown> | undefined),
        feedback_types: keeperFeedbackTypes,
        submitted_fingerprints: keeperFeedbackFingerprints,
        last_submitted_at: keeperLastSubmittedAt,
      },
      runtime_worker_control: {
        ...(meta.runtime_worker_control as Record<string, unknown> | undefined),
        rebuild_ready: workerRebuildReady,
        rebuild_reason: workerRebuildReason,
        last_worker_fault_action: workerLastFaultAction,
        worker_fault_retryable: workerFaultRetryable,
        worker_fault_requires_rebuild: workerFaultRequiresRebuild,
        last_fault_action_applied: workerLastFaultActionApplied,
        fault_actuation_mode: workerFaultActuationMode,
        fault_action_blocked_by_policy: workerFaultActionBlockedByPolicy,
        worker_fault_class: workerFaultClass,
        archive_ready: workerArchiveReady,
        reclaim_ready: workerReclaimReady,
        purge_ready: workerPurgeReady,
        retention_decision: workerRetentionDecision,
      },
    }),
    ...renderPlannerDecompositionSummary({
      initialSplitStrategy,
      initialMetaUnits,
      initialPartitionExpanded,
      initialDecouplingPrinciple,
      initialDecouplingConfidence,
      initialDecouplingRationale,
      workerRefinementRequired,
      workerRefinementScope,
      workerRefinementStrategy,
      workerRefinementPrinciple,
      workerRefinementComponentCandidates,
      granularityGuardrailTriggered,
      granularityGuardrailNotes,
      planningDecision,
      splitPlan,
    }),
    ...renderPlannerAgentSummary(planningDecision, splitPlan),
    ...renderSplitPlanSummary(splitPlan),
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
    initialSplitStrategy,
    initialMetaUnits,
    initialPartitionExpanded,
    initialDecouplingPrinciple,
    initialDecouplingConfidence,
    initialDecouplingRationale,
    workerRefinementRequired,
    workerRefinementScope,
    workerRefinementStrategy,
    workerRefinementPrinciple,
    workerRefinementComponentCandidates,
    granularityGuardrailTriggered,
    granularityGuardrailNotes,
    planningDecision,
    splitPlan,
    plannerContractErrorCode,
    plannerContractErrorField,
    plannerContractErrorDetail,
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
    workerBudgetLane,
    workerConvergenceClass,
    workerReclaimReason,
    selectedTemplateId,
    selectedTemplateOrigin,
    selectedTemplateSourceId,
    selectedTemplateVersion,
    selectedTemplateRegistrationSource,
    selectedTemplateDeliveryMode,
    selectedTemplateKind,
    governancePolicyId,
    resultContractVersion,
    allowedTemplateOrigins,
    customRegistrationRequired,
    workerStageId,
    workerStageRoot,
    workerStageProfile,
    workerStageIsolationMode,
    workerStageRuntimeClass,
    workerStageAllowedExecutionMode,
    workerStageMaxBytes,
    workerStageMaxFileCount,
    workerStageMaxSingleFileBytes,
    workerStageOverflowPolicy,
    workerStageBytesUsed,
    workerStageFileCount,
    workerStageOverflowStatus,
    workerStageRetentionPolicy,
    workerStageExportedArtifactCount,
    workerStageLastExportStatus,
    workerStageLastExportManifestClass,
    workerStageLastFaultClass,
    workerStageRetentionResult,
    workerStageLastCleanupAt,
    workerStageLastRetainedArtifactIds,
    customRuntimeGateStatus,
    customCapabilityGateReason,
    workerStageArchiveReady,
    workerStageReclaimReady,
    workerStagePurgeReady,
    workerStageRetentionDecision,
    clusterRoot,
    defaultMessageType,
    defaultTargetRoleTypes,
    semanticTopology,
    implementationTopology,
    clusterProjection,
    taskClusterId,
    taskClusterMailboxCounts,
    taskClusterLastMessageType,
    keeperFeedbackTypes,
    keeperFeedbackFingerprints,
    keeperLastSubmittedAt,
    workerRebuildReady,
    workerRebuildReason,
    workerLastFaultAction,
    workerFaultRetryable,
    workerFaultRequiresRebuild,
    workerLastFaultActionApplied,
    workerFaultActuationMode,
    workerFaultActionBlockedByPolicy,
    workerFaultClass,
    workerArchiveReady,
    workerReclaimReady,
    workerPurgeReady,
    workerRetentionDecision,
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
    "planner_ingress: auto-only",
    `decision_source: ${String(planningDecision.decision_source ?? "manual_override")}`,
    `decision_reason: ${String(planningDecision.decision_reason ?? "(none)")}`,
    `planner_contract_error_code: ${plannerContractErrorCode ?? "(none)"}`,
    `planner_contract_error_field: ${plannerContractErrorField ?? "(none)"}`,
    `planner_contract_error_detail: ${plannerContractErrorDetail ?? "(none)"}`,
    ...renderWorkerRuntimeSummary({
      ...meta,
      worker_budget: { ...(meta.worker_budget as Record<string, unknown> | undefined), budget_lane: workerBudgetLane },
        worker_convergence: {
          ...(meta.worker_convergence as Record<string, unknown> | undefined),
          convergence_class: workerConvergenceClass,
          reclaim_reason: workerReclaimReason,
        },
        worker_runtime: {
          ...(meta.worker_runtime as Record<string, unknown> | undefined),
          selected_template_id: selectedTemplateId,
          selected_template_origin: selectedTemplateOrigin,
          selected_template_source_id: selectedTemplateSourceId,
          template_version: selectedTemplateVersion,
          registration_source: selectedTemplateRegistrationSource,
          delivery_mode: selectedTemplateDeliveryMode,
          template_kind: selectedTemplateKind,
          governance_policy_id: governancePolicyId,
          result_contract_version: resultContractVersion,
          allowed_template_origins: allowedTemplateOrigins,
          custom_registration_required: customRegistrationRequired,
          custom_runtime_gate_status: customRuntimeGateStatus,
          custom_capability_gate_reason: customCapabilityGateReason,
          default_message_type: defaultMessageType,
          default_target_role_types: defaultTargetRoleTypes,
          semantic_topology: semanticTopology,
          implementation_topology: implementationTopology,
          cluster_projection: clusterProjection,
        },
        worker_stage: {
          ...(meta.worker_stage as Record<string, unknown> | undefined),
          worker_stage_id: workerStageId,
          worker_stage_root: workerStageRoot,
          worker_stage_profile: workerStageProfile,
          stage_isolation_mode: workerStageIsolationMode,
          stage_runtime_class: workerStageRuntimeClass,
          allowed_execution_mode: workerStageAllowedExecutionMode,
          allocation: {
            ...((
              (meta.worker_stage as Record<string, unknown> | undefined)?.allocation as
                | Record<string, unknown>
                | undefined
            ) ?? {}),
            worker_stage_max_bytes: workerStageMaxBytes,
            worker_stage_max_file_count: workerStageMaxFileCount,
            worker_stage_max_single_file_bytes: workerStageMaxSingleFileBytes,
            worker_stage_overflow_policy: workerStageOverflowPolicy,
            worker_stage_bytes_used: workerStageBytesUsed,
            worker_stage_file_count: workerStageFileCount,
            worker_stage_overflow_status: workerStageOverflowStatus,
          },
          retention: {
            ...((
              (meta.worker_stage as Record<string, unknown> | undefined)?.retention as
                | Record<string, unknown>
                | undefined
            ) ?? {}),
            worker_stage_retention_policy: workerStageRetentionPolicy,
            worker_stage_exported_artifact_count: workerStageExportedArtifactCount,
            worker_stage_last_export_status: workerStageLastExportStatus,
            worker_stage_last_export_manifest_class: workerStageLastExportManifestClass,
            worker_stage_last_fault_class: workerStageLastFaultClass,
            worker_stage_retention_result: workerStageRetentionResult,
            worker_stage_last_cleanup_at: workerStageLastCleanupAt,
            worker_stage_last_retained_artifact_ids: workerStageLastRetainedArtifactIds,
            worker_stage_archive_ready: workerStageArchiveReady,
            worker_stage_reclaim_ready: workerStageReclaimReady,
            worker_stage_purge_ready: workerStagePurgeReady,
            worker_stage_retention_decision: workerStageRetentionDecision,
          },
        },
      task_cluster: {
        ...(meta.task_cluster as Record<string, unknown> | undefined),
        cluster_id: taskClusterId,
        cluster_root: clusterRoot,
        mailbox_counters: taskClusterMailboxCounts,
        last_published_message_type: taskClusterLastMessageType,
      },
      keeper_feedback: {
        ...(meta.keeper_feedback as Record<string, unknown> | undefined),
        feedback_types: keeperFeedbackTypes,
        submitted_fingerprints: keeperFeedbackFingerprints,
        last_submitted_at: keeperLastSubmittedAt,
      },
      runtime_worker_control: {
        ...(meta.runtime_worker_control as Record<string, unknown> | undefined),
        rebuild_ready: workerRebuildReady,
        rebuild_reason: workerRebuildReason,
        last_worker_fault_action: workerLastFaultAction,
        worker_fault_retryable: workerFaultRetryable,
        worker_fault_requires_rebuild: workerFaultRequiresRebuild,
        last_fault_action_applied: workerLastFaultActionApplied,
        fault_actuation_mode: workerFaultActuationMode,
        fault_action_blocked_by_policy: workerFaultActionBlockedByPolicy,
        worker_fault_class: workerFaultClass,
        archive_ready: workerArchiveReady,
        reclaim_ready: workerReclaimReady,
        purge_ready: workerPurgeReady,
        retention_decision: workerRetentionDecision,
      },
    }),
    ...renderPlannerDecompositionSummary({
      initialSplitStrategy,
      initialMetaUnits,
      initialPartitionExpanded,
      initialDecouplingPrinciple,
      initialDecouplingConfidence,
      initialDecouplingRationale,
      workerRefinementRequired,
      workerRefinementScope,
      workerRefinementStrategy,
      workerRefinementPrinciple,
      workerRefinementComponentCandidates,
      granularityGuardrailTriggered,
      granularityGuardrailNotes,
      planningDecision,
      splitPlan,
    }),
    ...renderPlannerAgentSummary(planningDecision, splitPlan),
    ...renderSplitPlanSummary(splitPlan),
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
