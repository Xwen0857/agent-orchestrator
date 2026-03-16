import path from "node:path";

export const WORKER_BUDGET_LANE_TYPES = ["fast", "degraded", "reclaim_pending"] as const;
export const WORKER_CONVERGENCE_CLASSES = [
  "task_complete",
  "milestone_complete",
  "partial_deliverable",
  "stalled",
  "not_converged",
] as const;
export const WORKER_RECLAIM_REASONS = [
  "token_budget_exhausted",
  "stalled_no_effective_progress",
  "refinement_too_coarse",
  "refinement_too_fragmented",
  "dependency_blocked",
  "runtime_capability_insufficient",
] as const;
export const TASK_CLUSTER_MESSAGE_TYPES = [
  "partial_deliverable",
  "dependency_update",
  "handoff_note",
] as const;
export const TASK_CLUSTER_MESSAGE_STATUSES = [
  "published",
  "acknowledged",
  "consumed",
  "archived",
] as const;
export const WORKER_DELIVERY_MODES = ["deterministic_python_bundle", "unsupported_placeholder"] as const;
export const WORKER_KEEPER_FEEDBACK_TYPES = [
  "capacity_allocation_feedback",
  "refinement_quality_feedback",
] as const;
export const WORKER_TRANSACTION_LAYERS = ["create", "update", "validate", "repair", "handoff"] as const;
export const WORKER_ACTION_LAYERS = ["implement", "test", "debug", "integrate"] as const;
export const WORKER_ARTIFACT_LAYERS = ["code", "document_reserved", "image_reserved"] as const;
export const WORKER_ROLE_LAYERS = [
  "frontend",
  "backend",
  "ui",
  "database",
  "data",
  "infra",
  "script_automation",
] as const;
export const WORKER_TECH_LAYERS = [
  "typescript",
  "javascript",
  "python",
  "golang",
  "java",
  "sql",
  "generic",
] as const;
export const WORKER_FRAMEWORK_LAYERS = [
  "react",
  "vue",
  "nextjs",
  "nestjs",
  "fastapi",
  "django",
  "gin",
  "echo",
  "spring",
  "mybatis",
  "sqlalchemy",
  "generic",
] as const;
export const WORKER_TEMPLATE_KINDS = ["base", "artifact", "role", "concrete", "placeholder"] as const;
export const WORKER_CLUSTER_PROJECTION_MODES = ["by_semantic", "by_implementation", "by_hybrid"] as const;
export const WORKER_CUSTOM_OVERLAY_FIELDS = [
  "delivery_expectations",
  "default_test_mode",
  "default_target_role_types",
] as const;
export const WORKER_TEMPLATE_ORIGINS = ["builtin", "custom"] as const;
export const WORKER_WORKSPACE_PROFILES = ["light", "normal", "heavy"] as const;
export const COARSE_TEMPLATE_ROLE_DOMAIN_GROUPS = [
  "engineering",
  "writing",
  "visual",
  "audio",
  "video",
  "planning",
  "operations",
] as const;
export const WORKSPACE_MOUNT_ACCESS_MODES = ["read_only", "read_write", "write_only", "append_only"] as const;
export const WORKSPACE_OVERFLOW_POLICIES = ["block_write", "truncate_temp_only", "signal_and_reclaim"] as const;
export const WORKSPACE_RETENTION_POLICIES = [
  "retain_delivery_only",
  "retain_all",
  "purge_all",
  "retain_evidence_bundle",
] as const;
export const WORKER_STAGE_ISOLATION_MODES = ["wrapper_enforced", "sandbox_mount", "containerized"] as const;
export const WORKER_STAGE_FAULT_CLASSES = [
  "worker_stage_exhausted",
  "worker_stage_forbidden_write",
  "worker_stage_attachment_policy_violation",
  "worker_stage_export_manifest_invalid",
  "worker_stage_binary_artifact_disallowed",
] as const;
export const WORKER_STAGE_RUNTIME_CLASSES = ["default_shell", "sandbox_reserved", "container_reserved"] as const;
export const WORKER_FAULT_ACTIONS = ["retry", "rebuild", "reclaim", "block", "none"] as const;
export const WORKER_EVIDENCE_PROFILES = [
  "frontend_profile",
  "backend_profile",
  "infra_profile",
  "database_profile",
  "data_profile",
  "script_automation_profile",
] as const;
export const WORKER_RESULT_CONTRACT_VERSION = "worker-template-result-contract-v1" as const;
export const SCHEDULER_WORKER_LIFECYCLE_POLICY_TEMPLATE_ID = "worker_lifecycle_policy_default_v1" as const;

export type WorkerBudgetLaneType = (typeof WORKER_BUDGET_LANE_TYPES)[number];
export type WorkerConvergenceClass = (typeof WORKER_CONVERGENCE_CLASSES)[number];
export type WorkerReclaimReason = (typeof WORKER_RECLAIM_REASONS)[number];
export type TaskClusterMessageType = (typeof TASK_CLUSTER_MESSAGE_TYPES)[number];
export type TaskClusterMessageStatus = (typeof TASK_CLUSTER_MESSAGE_STATUSES)[number];
export type WorkerDeliveryMode = (typeof WORKER_DELIVERY_MODES)[number];
export type WorkerKeeperFeedbackType = (typeof WORKER_KEEPER_FEEDBACK_TYPES)[number];
export type WorkerTransactionLayer = (typeof WORKER_TRANSACTION_LAYERS)[number];
export type WorkerActionLayer = (typeof WORKER_ACTION_LAYERS)[number];
export type WorkerArtifactLayer = (typeof WORKER_ARTIFACT_LAYERS)[number];
export type WorkerRoleLayer = (typeof WORKER_ROLE_LAYERS)[number];
export type WorkerTechLayer = (typeof WORKER_TECH_LAYERS)[number];
export type WorkerFrameworkLayer = (typeof WORKER_FRAMEWORK_LAYERS)[number];
export type WorkerTemplateKind = (typeof WORKER_TEMPLATE_KINDS)[number];
export type WorkerClusterProjectionMode = (typeof WORKER_CLUSTER_PROJECTION_MODES)[number];
export type WorkerCustomOverlayField = (typeof WORKER_CUSTOM_OVERLAY_FIELDS)[number];
export type WorkerTemplateOrigin = (typeof WORKER_TEMPLATE_ORIGINS)[number];
export type WorkerWorkspaceProfile = (typeof WORKER_WORKSPACE_PROFILES)[number];
export type CoarseTemplateRoleDomainGroup = (typeof COARSE_TEMPLATE_ROLE_DOMAIN_GROUPS)[number];
export type CoarseTemplateRoleId = string;
export type WorkspaceMountAccessMode = (typeof WORKSPACE_MOUNT_ACCESS_MODES)[number];
export type WorkspaceOverflowPolicy = (typeof WORKSPACE_OVERFLOW_POLICIES)[number];
export type WorkspaceRetentionPolicy = (typeof WORKSPACE_RETENTION_POLICIES)[number];
export type WorkerStageIsolationMode = (typeof WORKER_STAGE_ISOLATION_MODES)[number];
export type WorkerStageFaultClass = (typeof WORKER_STAGE_FAULT_CLASSES)[number];
export type WorkerStageRuntimeClass = (typeof WORKER_STAGE_RUNTIME_CLASSES)[number];
export type WorkerFaultAction = (typeof WORKER_FAULT_ACTIONS)[number];
export type WorkerEvidenceProfile = (typeof WORKER_EVIDENCE_PROFILES)[number];
export type WorkerCustomOverlayLayer = {
  overlay_id: string;
  overlay_fields: WorkerCustomOverlayField[];
  config: Partial<Record<WorkerCustomOverlayField, unknown>>;
};

export type WorkerSemanticTopology = {
  transaction_layer: WorkerTransactionLayer;
  action_layer: WorkerActionLayer;
  budget_layer: WorkerBudgetLaneType;
  convergence_layer: WorkerConvergenceClass;
};

export type WorkerImplementationTopology = {
  artifact_layer: WorkerArtifactLayer;
  // Long-term semantic center for topology-driven coarse template resolution.
  coarse_template_role?: CoarseTemplateRoleId;
  // Compatibility projection for legacy implementation-role consumers. The
  // topology-owned coarse template classification now lives in
  // `coarse_template_role`.
  role_layer: WorkerRoleLayer;
  tech_layer: WorkerTechLayer;
  // `framework_layer` participates in fine template derivation and should not be
  // treated as a standalone scheduler-owned config layer.
  framework_layer: WorkerFrameworkLayer;
  worker_stage_profile_hint: WorkerWorkspaceProfile;
  custom_overlay_layer: WorkerCustomOverlayLayer;
};

export type WorkerStageContract = {
  schema_version: "worker-stage-contract-v1";
  task_id: string;
  worker_stage_id: string;
  worker_stage_profile: WorkerWorkspaceProfile;
  stage_isolation_mode: WorkerStageIsolationMode;
  stage_runtime_class: WorkerStageRuntimeClass;
  allowed_execution_mode: WorkerDispatchContract["mode"];
  worker_stage_root: string;
  scratch_root: string;
  delivery_root: string;
  inputs_root: string;
  runtime_root: string;
  mount_policy: {
    inputs_root: WorkspaceMountAccessMode;
    scratch_root: WorkspaceMountAccessMode;
    delivery_root: WorkspaceMountAccessMode;
    cluster_mailbox: WorkspaceMountAccessMode;
    authority_paths: WorkspaceMountAccessMode;
  };
  allocation: {
    worker_stage_scope: "per_worker_instance";
    worker_stage_max_bytes: number;
    worker_stage_max_file_count: number;
    worker_stage_max_single_file_bytes: number;
    allow_binary_artifacts: boolean;
    worker_stage_overflow_policy: WorkspaceOverflowPolicy;
  };
  retention: {
    worker_stage_retention_policy: WorkspaceRetentionPolicy;
    success_cleanup_rule: WorkspaceRetentionPolicy;
    failure_cleanup_rule: WorkspaceRetentionPolicy;
    purge_on_success: boolean;
    purge_on_failure: boolean;
  };
};

export type WorkerDeliveryExportRecord = {
  artifact_id: string;
  path: string;
  artifact_type: string;
  size_bytes: number;
  digest_sha256: string;
  export_class: "delivery_manifest";
  exported_at: string;
  consumption_status: "available" | "consumed";
  archive_status: "active" | "archived";
  retention_status: "retained" | "purged" | "archived_only";
  archive_manifest_path?: string;
  consumed_at?: string;
  archived_at?: string;
  purged_at?: string;
  last_lifecycle_action?: string;
};

export type WorkerClusterProjection = {
  schema_version: "worker-cluster-projection-v1";
  semantic_clusters: string[];
  implementation_clusters: string[];
  hybrid_clusters: string[];
};

export type WorkerTemplateSpec = {
  template_id: string;
  template_origin: WorkerTemplateOrigin;
  template_source_id: string;
  template_version: string;
  registration_source: string;
  handler_script: string;
  supported_role_types: WorkerDispatchContract["role_type"][];
  artifact_layer: WorkerArtifactLayer;
  coarse_template_role: CoarseTemplateRoleId;
  role_layer: WorkerRoleLayer;
  tech_layer: WorkerTechLayer;
  framework_layer: WorkerFrameworkLayer;
  mount_tree: string;
  mount_path: string[];
  supported_component_candidates: string[];
  goal_matchers: string[];
  delivery_mode: WorkerDeliveryMode;
  template_kind: WorkerTemplateKind;
  default_message_type: TaskClusterMessageType;
  overlay_capabilities: string[];
  allowed_runtime_classes: WorkerStageRuntimeClass[];
  role_default: boolean;
};

export type WorkerSelectedTemplateSummary = {
  template_id: string;
  template_origin: WorkerTemplateOrigin;
  template_source_id: string;
  template_version: string;
  registration_source: string;
  handler_script: string;
  delivery_mode: WorkerDeliveryMode;
  template_kind: WorkerTemplateKind;
  default_message_type: TaskClusterMessageType;
  default_target_role_types: string[];
};

export type CustomTemplateRegistrationContract = {
  schema_version: "custom-template-registration-contract-v1";
  template_id: string;
  template_origin: "custom";
  template_source_id: string;
  template_version: string;
  registration_source: string;
  registered_at: string;
  enabled: boolean;
  handler_script: string;
  supported_role_types: WorkerDispatchContract["role_type"][];
  artifact_layer: WorkerArtifactLayer;
  coarse_template_role: CoarseTemplateRoleId;
  role_layer: WorkerRoleLayer;
  tech_layer: WorkerTechLayer;
  framework_layer: WorkerFrameworkLayer;
  mount_tree: string;
  mount_path: string[];
  supported_component_candidates: string[];
  goal_matchers: string[];
  delivery_mode: WorkerDeliveryMode;
  template_kind: Extract<WorkerTemplateKind, "concrete" | "placeholder">;
  overlay_capabilities: WorkerCustomOverlayField[];
  allowed_runtime_classes: WorkerStageRuntimeClass[];
  allowed_delivery_modes: WorkerDeliveryMode[];
  allowed_attachment_types: string[];
  allowed_export_classes: WorkerDeliveryExportRecord["export_class"][];
  allowed_execution_mode: WorkerDispatchContract["mode"];
  requires_evidence_profile: WorkerEvidenceProfile;
  role_default: boolean;
};

export type CoarseTemplateRoleRegistryEntry = {
  role_id: CoarseTemplateRoleId;
  display_name: string;
  domain_group: string;
  enabled: boolean;
  description: string;
  builtin: boolean;
  compatibility_role_layer: WorkerRoleLayer;
};

export type CoarseTemplateRoleRegistry = {
  schema_version: "coarse-template-role-registry-v1";
  roles: CoarseTemplateRoleRegistryEntry[];
};

export type TemplateResolutionMountPath = {
  mount_tree: string;
  mount_path: string[];
};

export type WorkerTemplateResultContract = {
  schema_version: typeof WORKER_RESULT_CONTRACT_VERSION;
  summary: string;
  test_command: string;
  changed_files: string[];
  delivery_manifest: string[];
  evidence_notes: string[];
};

export type WorkerLifecyclePolicyTemplate = {
  schema_version: "worker-lifecycle-policy-template-v1";
  policy_id: string;
  enabled: boolean;
  budget_policy: {
    primary_axis: "token";
    allow_degraded_lane: boolean;
    allow_reclaim_pending: boolean;
  };
  template_policy: {
    allow_builtin: boolean;
    allow_custom: boolean;
    require_enabled_custom_registration: boolean;
  };
  overlay_policy: {
    allowed_overlay_fields: WorkerCustomOverlayField[];
  };
  mailbox_policy: {
    default_message_type_by_role: Partial<Record<WorkerRoleLayer, TaskClusterMessageType>>;
    default_target_roles_by_role: Partial<Record<WorkerRoleLayer, string[]>>;
  };
  result_contract_policy: {
    required_result_contract_version: typeof WORKER_RESULT_CONTRACT_VERSION;
    strict_result_validation: boolean;
  };
  worker_stage_policy: {
    worker_stage_scope: "per_worker_instance";
    stage_isolation_mode: WorkerStageIsolationMode;
    stage_runtime_class: WorkerStageRuntimeClass;
    allowed_execution_mode: WorkerDispatchContract["mode"];
    worker_stage_overflow_policy: WorkspaceOverflowPolicy;
    worker_stage_retention_policy: WorkspaceRetentionPolicy;
    success_cleanup_rule: WorkspaceRetentionPolicy;
    failure_cleanup_rule: WorkspaceRetentionPolicy;
    purge_on_success: boolean;
    purge_on_failure: boolean;
    export_policy: {
      allow_delivery_manifest_only: boolean;
      retain_on_success: boolean;
      retain_on_failure: boolean;
      archive_on_tester_consume: boolean;
      archive_failed_export_evidence: boolean;
      retain_export_records_when_stage_purged: boolean;
      purge_artifacts_after_archive: boolean;
      retain_archive_manifest: boolean;
    };
    mailbox_attachment_policy: {
      allow_exported_artifact_references: boolean;
      max_attachment_bytes: number;
      allowed_artifact_types: string[];
    };
    worker_stage_profile_defaults: Record<
      WorkerWorkspaceProfile,
      {
        worker_stage_max_bytes: number;
        worker_stage_max_file_count: number;
        worker_stage_max_single_file_bytes: number;
        allow_binary_artifacts: boolean;
      }
    >;
  };
  fault_handling_policy: Partial<Record<WorkerStageFaultClass, WorkerFaultAction>>;
  evidence_policy: {
    default_profile_by_role: Record<WorkerRoleLayer, WorkerEvidenceProfile>;
    profiles: Record<
      WorkerEvidenceProfile,
      {
        require_summary: boolean;
        require_test_command: boolean;
        require_changed_files: boolean;
        require_evidence_notes: boolean;
        require_runbook: boolean;
        allow_missing_test_command_with_reason: boolean;
      }
    >;
  };
  rebuild_policy: {
    allow_rebuild: boolean;
    rebuild_on_budget_amendment: boolean;
    rebuild_on_refinement_amendment: boolean;
  };
};

export type WorkerLifecycleGovernanceContract = {
  schema_version: "worker-lifecycle-governance-contract-v1";
  policy_id: string;
  task_id: string;
  operation_id: string;
  dispatch_seq: number;
  budget_governance: {
    budget_lane: WorkerBudgetLaneType;
    fast_token_budget: number;
    degraded_token_budget: number;
    reclaim_threshold: number;
    primary_axis: "token";
  };
  template_governance: {
    allowed_template_origins: WorkerTemplateOrigin[];
    require_enabled_custom_registration: boolean;
    selected_template_origin: WorkerTemplateOrigin;
    selected_template_id: string;
    selected_custom_registration_enabled: boolean;
    selected_custom_runtime_gate_status: "not_applicable" | "allowed" | "blocked";
    selected_custom_capability_gate_reason: string;
  };
  overlay_governance: {
    allowed_overlay_fields: WorkerCustomOverlayField[];
    effective_overlay_defaults: Partial<Record<WorkerCustomOverlayField, unknown>>;
  };
  mailbox_governance: {
    default_message_type: TaskClusterMessageType;
    default_target_role_types: string[];
    message_type_allowlist: TaskClusterMessageType[];
  };
  result_governance: {
    required_result_contract_version: typeof WORKER_RESULT_CONTRACT_VERSION;
    strict_result_validation: boolean;
  };
  evidence_governance: {
    evidence_profile: WorkerEvidenceProfile;
    require_summary: boolean;
    require_test_command: boolean;
    require_changed_files: boolean;
    require_evidence_notes: boolean;
    require_runbook: boolean;
    allow_missing_test_command_with_reason: boolean;
  };
  worker_stage_governance: {
    worker_stage_scope: "per_worker_instance";
    worker_stage_profile: WorkerWorkspaceProfile;
    stage_isolation_mode: WorkerStageIsolationMode;
    stage_runtime_class: WorkerStageRuntimeClass;
    allowed_execution_mode: WorkerDispatchContract["mode"];
    worker_stage_max_bytes: number;
    worker_stage_max_file_count: number;
    worker_stage_max_single_file_bytes: number;
    allow_binary_artifacts: boolean;
    worker_stage_overflow_policy: WorkspaceOverflowPolicy;
    worker_stage_retention_policy: WorkspaceRetentionPolicy;
    success_cleanup_rule: WorkspaceRetentionPolicy;
    failure_cleanup_rule: WorkspaceRetentionPolicy;
    purge_on_success: boolean;
    purge_on_failure: boolean;
    export_policy: {
      allow_delivery_manifest_only: boolean;
      retain_on_success: boolean;
      retain_on_failure: boolean;
      archive_on_tester_consume: boolean;
      archive_failed_export_evidence: boolean;
      retain_export_records_when_stage_purged: boolean;
      purge_artifacts_after_archive: boolean;
      retain_archive_manifest: boolean;
    };
    mailbox_attachment_policy: {
      allow_exported_artifact_references: boolean;
      max_attachment_bytes: number;
      allowed_artifact_types: string[];
    };
  };
  rebuild_governance: {
    allow_rebuild: boolean;
    rebuild_on_budget_amendment: boolean;
    rebuild_on_refinement_amendment: boolean;
  };
};

export type WorkerSemanticContract = {
  schema_version: "worker-semantic-contract-v1";
  task_id: string;
  goal: string;
  project_id: string;
  workspace_root: string;
  refinement_route_ref: {
    module_id: string;
    refinement_task_id: string;
  };
  component_candidates: string[];
  refinement_scope: string;
  refinement_strategy: string;
  refinement_principle: string;
  dependency_hint_summary: {
    mode: string;
    roots: number;
    blocked: number;
    links: number;
    cross_module_links: number;
  };
  cluster_derivation_inputs: {
    project_id: string;
    workspace_root: string;
    component_candidates: string[];
  };
  transaction_layer: WorkerTransactionLayer;
  action_layer: WorkerActionLayer;
};

export type WorkerDispatchContract = {
  schema_version: "worker-dispatch-contract-v1";
  task_id: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry" | "recovery";
  mode: "local_threads" | "container" | "distributed";
  role_type: "worker-delivery" | "tester-ephemeral" | "audit-guard" | "unknown";
  operation_id: string;
  dispatch_seq: number;
  retry_count: number;
  queue_priority: number;
  budget_lane: WorkerBudgetLaneType;
  execution_target: WorkerMilestoneSetV1;
  history_handoff: {
    failure_pattern_summary: WorkerFailurePatternSummaryV1;
    failure_pattern_index_refs: string[];
  };
};

export type WorkerMilestoneLevel = "blocking" | "core" | "stretch";
export type WorkerMilestoneStatus = "pending" | "in_progress" | "satisfied" | "missed";

export type WorkerMilestoneV1 = {
  milestone_id: string;
  title: string;
  level: WorkerMilestoneLevel;
  required: boolean;
  status: WorkerMilestoneStatus;
  progress_signal: string;
  completion_evidence: {
    paths: string[];
    markers: string[];
    counts: Record<string, number>;
  };
  window_seconds: number;
};

export type WorkerMilestoneSetV1 = {
  schema_version: "worker-milestone-set-v1";
  set_id: string;
  task_id: string;
  worker_instance_id: string;
  generated_at: string;
  source: "scheduler";
  evaluation_window_seconds: number;
  milestones: WorkerMilestoneV1[];
  summary: {
    total_count: number;
    required_count: number;
    satisfied_count: number;
    required_satisfied_count: number;
    blocking_pending_count: number;
    core_pending_count: number;
    all_required_met: boolean;
    last_progress_at: string;
  };
};

export type WorkerMilestoneProgressSignalV1 = {
  schema_version: "worker-milestone-progress-signal-v1";
  completed_count: number;
  total_count: number;
  reported_at: string;
};

export type WorkerMilestoneCompletionSignalV1 = {
  schema_version: "worker-milestone-completion-signal-v1";
  all_required_met: true;
  reported_at: string;
};

export type SchedulerKeeperAssemblyQueryV1 = {
  schema_version: "scheduler-keeper-assembly-query-v1";
  requested_at: string;
  task_id: string;
  worker_instance_id: string;
  dispatch_lane: WorkerDispatchContract["lane"];
  dispatch_mode: WorkerDispatchContract["mode"];
  refinement_scope: string;
  history_reload_hint: string;
  knowledge_refs: string[];
  milestone_ids: string[];
};

export type SchedulerKeeperAssemblyKnowledgeV1 = {
  schema_version: "scheduler-keeper-assembly-knowledge-v1";
  generated_at: string;
  task_id: string;
  assembly_hints: string[];
  milestone_history: string[];
  task_history: string[];
  cluster_history: string[];
  worker_failure_pattern_summary: WorkerFailurePatternSummaryV1;
};

export type WorkerFailurePatternSummaryV1 = {
  schema_version: "worker-failure-pattern-summary-v1";
  task_id: string;
  worker_instance_id: string;
  summary: {
    pattern_count: number;
    top_risk_note: string;
  };
  patterns: Array<{
    pattern_id: string;
    label: string;
    scope: "instance" | "task" | "cluster";
    severity: "low" | "medium" | "high" | "critical";
    trigger_signals: string[];
    avoid_rules: string[];
    preferred_response: string[];
    related_milestones: string[];
  }>;
  read_contract: {
    mode: "bounded_guidance";
    agent_may_quote_raw_index: false;
    agent_may_request_additional_history: false;
    agent_must_treat_patterns_as_execution_constraints: true;
    agent_must_not_reinterpret_budget_policy: true;
  };
};

export type WorkerBudgetContract = {
  schema_version: "worker-budget-contract-v1";
  task_id: string;
  max_token_cost: number;
  token_cost_used: number;
  fast_token_budget: number;
  degraded_token_budget: number;
  reclaim_threshold: number;
  budget_lane: WorkerBudgetLaneType;
};

export type WorkerConvergenceContract = {
  schema_version: "worker-convergence-contract-v1";
  task_id: string;
  convergence_class: WorkerConvergenceClass;
  convergence_confidence: number;
  progress_delta: number;
  remaining_work_estimate: string;
  reclaim_reason: WorkerReclaimReason | "";
  reported_at: string;
};

export type WorkerCollaborationContract = {
  schema_version: "worker-collaboration-contract-v1";
  task_id: string;
  cluster_id: string;
  memberships: string[];
  cluster_root: string;
  workspace_root: string;
  mailbox_path: string;
  archive_path: string;
  message_type_allowlist: TaskClusterMessageType[];
  default_target_role_types: string[];
  mailbox_counters: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
};

export type WorkerTemplateSelectorInput = {
  schema_version: "worker-template-selector-v1";
  // Compatibility name only: this is the topology-driven template resolution input,
  // not a standalone template-selection authority layer.
  role_type: WorkerDispatchContract["role_type"];
  semantic_topology: WorkerSemanticTopology;
  implementation_topology: WorkerImplementationTopology;
  component_candidates: string[];
  goal: string;
  preferred_template_ids: string[];
};

export type WorkerRuntimeView = {
  schema_version: "worker-runtime-view-v1";
  assembled_at: string;
  task_id: string;
  goal: string;
  workspace_root: string;
  run_root: string;
  work_domain_id: string;
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
  budget: WorkerBudgetContract;
  convergence: WorkerConvergenceContract;
  // These three fields together form the scheduler-owned topology config surface
  // that later drives coarse template classification and finer template derivation.
  semantic_topology: WorkerSemanticTopology;
  implementation_topology: WorkerImplementationTopology;
  cluster_projection: WorkerClusterProjection;
  worker_stage: WorkerStageContract;
  collaboration: WorkerCollaborationContract;
  // Historical compatibility name: this remains a bundled worker governance downlink,
  // not a pure lifecycle-only surface and not the semantic center for scheduler->worker
  // config ownership.
  lifecycle_governance: WorkerLifecycleGovernanceContract;
  // Compatibility name only: this is the template resolution context assembled from
  // topology/lifecycle/milestone inputs plus governance constraints.
  template_selector: WorkerTemplateSelectorInput;
  // Derived output only: selected template is a topology-driven resolution result,
  // not a scheduler-owned config field.
  selected_template: WorkerSelectedTemplateSummary;
};

export type SchedulerDispatchCapabilitySummary = {
  schema_version: "scheduler-agent-dispatch-capability-v1";
  allowed_agent_types: string[];
  default_target_role_types: string[];
  selected_template_id: string;
  selected_template_origin: string;
  custom_runtime_gate_status: "not_applicable" | "allowed" | "blocked";
  custom_capability_gate_reason: string;
  skill_gate_status: "allowed" | "blocked";
  skill_gate_reason: string;
  dispatch_capability_class: "general" | "tester_targeted" | "audit_targeted";
};

export type WorkerRuntimeControlSummary = {
  budget_status: WorkerBudgetLaneType;
  reclaim_requested_at: string;
  rebuild_ready: boolean;
  rebuild_reason: string;
  last_rebuilt_at: string;
  last_worker_fault_action: WorkerFaultAction;
  worker_fault_retryable: boolean;
  worker_fault_requires_rebuild: boolean;
  last_fault_action_applied: WorkerFaultAction;
  fault_actuation_mode: "disabled" | "summary_only" | "enabled";
  fault_action_blocked_by_policy: boolean;
  worker_fault_class: string;
  archive_ready: boolean;
  reclaim_ready: boolean;
  purge_ready: boolean;
  retention_decision: string;
};

const BUILTIN_COARSE_TEMPLATE_ROLE_REGISTRY: CoarseTemplateRoleRegistryEntry[] = [
  {
    role_id: "ui",
    display_name: "UI",
    domain_group: "engineering",
    enabled: true,
    description: "Interface and presentation-oriented implementation work.",
    builtin: true,
    compatibility_role_layer: "ui",
  },
  {
    role_id: "frontend",
    display_name: "Frontend",
    domain_group: "engineering",
    enabled: true,
    description: "Client-side application implementation work.",
    builtin: true,
    compatibility_role_layer: "frontend",
  },
  {
    role_id: "backend",
    display_name: "Backend",
    domain_group: "engineering",
    enabled: true,
    description: "Server-side service and application implementation work.",
    builtin: true,
    compatibility_role_layer: "backend",
  },
  {
    role_id: "database",
    display_name: "Database",
    domain_group: "engineering",
    enabled: true,
    description: "Database schema, query, and migration work.",
    builtin: true,
    compatibility_role_layer: "database",
  },
  {
    role_id: "data",
    display_name: "Data",
    domain_group: "engineering",
    enabled: true,
    description: "Data processing and pipeline implementation work.",
    builtin: true,
    compatibility_role_layer: "data",
  },
  {
    role_id: "infra",
    display_name: "Infra",
    domain_group: "engineering",
    enabled: true,
    description: "Infrastructure and runtime-environment implementation work.",
    builtin: true,
    compatibility_role_layer: "infra",
  },
  {
    role_id: "script_automation",
    display_name: "Script Automation",
    domain_group: "engineering",
    enabled: true,
    description: "Scripted automation and task automation work.",
    builtin: true,
    compatibility_role_layer: "script_automation",
  },
];

// Documentary aliases used to keep scheduler/runtime/worker config boundaries explicit
// without changing the current wire shape. Only lifecycle/milestone/topology are
// scheduler-owned config surfaces. Template/stage governance and artifact retention
// remain derived governance / execution views.
export type LifecycleConfigSurface = {
  // The current wire shape still projects lifecycle semantics through the historical
  // governance bundle. In the explicit model, lifecycle config is the numeric
  // lifecycle-rule surface that feeds that bundle rather than the bundle itself.
  // We keep this as a documentary placeholder until lifecycle numeric fields are
  // broken out of the compatibility bundle into their own machine-facing surface.
  lifecycle_policy_ref: WorkerLifecycleGovernanceContract["policy_id"];
};

// Milestone config is the scheduler-owned execution-target translation layer:
// textual regression goals plus composite quantitative completion requirements.
export type MilestoneConfigSurface = WorkerDispatchContract["execution_target"];

export type TopologyConfigSurface = Pick<
  WorkerRuntimeView,
  "semantic_topology" | "implementation_topology" | "cluster_projection"
>;

// Current explicit coarse template classification lives under topology config.
export type TopologyCoarseTemplateClassification = WorkerImplementationTopology["coarse_template_role"];

// Compatibility shell only: this is the historical governance bundle projected to the
// worker wrapper, not a standalone lifecycle config surface.
export type WorkerGovernanceBundle = WorkerRuntimeView["lifecycle_governance"];

// Derived governance view: this is the topology/lifecycle/milestone-driven governance
// outcome consumed by worker assembly and wrapper launch, not a scheduler-owned config
// surface.
export type TemplateStageGovernanceView = Pick<
  WorkerLifecycleGovernanceContract,
  | "template_governance"
  | "overlay_governance"
  | "mailbox_governance"
  | "result_governance"
  | "evidence_governance"
  | "worker_stage_governance"
  | "rebuild_governance"
>;

// Runtime execution view only: retention/archive/reclaim summaries are template/runtime
// execution signals rather than lifecycle config authority.
export type ArtifactRetentionExecutionSurface = Pick<
  WorkerRuntimeControlSummary,
  "archive_ready" | "reclaim_ready" | "purge_ready" | "retention_decision"
>;

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Math.floor(normalizeNumber(value, fallback));
  return parsed > 0 ? parsed : fallback;
}

function normalizeRatio(value: unknown, fallback: number): number {
  const parsed = normalizeNumber(value, fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function readNestedString(root: Record<string, unknown>, pathSpec: string): string {
  const segments = pathSpec.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return normalizeString(current);
}

function taskMetaOrPlanning(
  taskMeta: Record<string, unknown>,
  taskMetaPath: string,
  fallback: string,
): string {
  const direct = readNestedString(taskMeta, taskMetaPath);
  if (direct) {
    return direct;
  }
  const planningDecision = extractObject(taskMeta.planning_decision);
  const plannerWorkerRuntime = extractObject(planningDecision.worker_runtime);
  const plannerValue = readNestedString(plannerWorkerRuntime, taskMetaPath.replace(/^worker_runtime\./, ""));
  return plannerValue || fallback;
}

export function normalizeBudgetLane(value: unknown): WorkerBudgetLaneType {
  const raw = normalizeString(value);
  return WORKER_BUDGET_LANE_TYPES.includes(raw as WorkerBudgetLaneType)
    ? (raw as WorkerBudgetLaneType)
    : "fast";
}

export function normalizeConvergenceClass(value: unknown): WorkerConvergenceClass {
  const raw = normalizeString(value);
  return WORKER_CONVERGENCE_CLASSES.includes(raw as WorkerConvergenceClass)
    ? (raw as WorkerConvergenceClass)
    : "not_converged";
}

export function normalizeReclaimReason(value: unknown): WorkerReclaimReason | "" {
  const raw = normalizeString(value);
  return WORKER_RECLAIM_REASONS.includes(raw as WorkerReclaimReason)
    ? (raw as WorkerReclaimReason)
    : "";
}

export function normalizeMessageType(value: unknown): TaskClusterMessageType {
  const raw = normalizeString(value);
  return TASK_CLUSTER_MESSAGE_TYPES.includes(raw as TaskClusterMessageType)
    ? (raw as TaskClusterMessageType)
    : "partial_deliverable";
}

export function normalizeMailboxStatus(value: unknown): TaskClusterMessageStatus {
  const raw = normalizeString(value);
  return TASK_CLUSTER_MESSAGE_STATUSES.includes(raw as TaskClusterMessageStatus)
    ? (raw as TaskClusterMessageStatus)
    : "published";
}

export function normalizeKeeperFeedbackType(value: unknown): WorkerKeeperFeedbackType | "" {
  const raw = normalizeString(value);
  return WORKER_KEEPER_FEEDBACK_TYPES.includes(raw as WorkerKeeperFeedbackType)
    ? (raw as WorkerKeeperFeedbackType)
    : "";
}

export function normalizeTransactionLayer(value: unknown): WorkerTransactionLayer {
  const raw = normalizeString(value);
  return WORKER_TRANSACTION_LAYERS.includes(raw as WorkerTransactionLayer)
    ? (raw as WorkerTransactionLayer)
    : "update";
}

export function normalizeActionLayer(value: unknown): WorkerActionLayer {
  const raw = normalizeString(value);
  return WORKER_ACTION_LAYERS.includes(raw as WorkerActionLayer)
    ? (raw as WorkerActionLayer)
    : "implement";
}

export function normalizeArtifactLayer(value: unknown): WorkerArtifactLayer {
  const raw = normalizeString(value);
  return WORKER_ARTIFACT_LAYERS.includes(raw as WorkerArtifactLayer)
    ? (raw as WorkerArtifactLayer)
    : "code";
}

export function normalizeRoleLayer(value: unknown): WorkerRoleLayer {
  const raw = normalizeString(value);
  return WORKER_ROLE_LAYERS.includes(raw as WorkerRoleLayer)
    ? (raw as WorkerRoleLayer)
    : "backend";
}

export function normalizeTechLayer(value: unknown): WorkerTechLayer {
  const raw = normalizeString(value);
  return WORKER_TECH_LAYERS.includes(raw as WorkerTechLayer)
    ? (raw as WorkerTechLayer)
    : "generic";
}

export function normalizeFrameworkLayer(value: unknown): WorkerFrameworkLayer {
  const raw = normalizeString(value);
  return WORKER_FRAMEWORK_LAYERS.includes(raw as WorkerFrameworkLayer)
    ? (raw as WorkerFrameworkLayer)
    : "generic";
}

export function normalizeTemplateKind(value: unknown): WorkerTemplateKind {
  const raw = normalizeString(value);
  return WORKER_TEMPLATE_KINDS.includes(raw as WorkerTemplateKind)
    ? (raw as WorkerTemplateKind)
    : "placeholder";
}

export function normalizeTemplateOrigin(value: unknown): WorkerTemplateOrigin {
  const raw = normalizeString(value);
  return WORKER_TEMPLATE_ORIGINS.includes(raw as WorkerTemplateOrigin)
    ? (raw as WorkerTemplateOrigin)
    : "builtin";
}

export function normalizeWorkspaceProfile(value: unknown): WorkerWorkspaceProfile {
  const raw = normalizeString(value);
  return WORKER_WORKSPACE_PROFILES.includes(raw as WorkerWorkspaceProfile)
    ? (raw as WorkerWorkspaceProfile)
    : "normal";
}

export function normalizeEvidenceProfile(value: unknown): WorkerEvidenceProfile {
  const raw = normalizeString(value);
  return WORKER_EVIDENCE_PROFILES.includes(raw as WorkerEvidenceProfile)
    ? (raw as WorkerEvidenceProfile)
    : "backend_profile";
}

export function normalizeWorkspaceOverflowPolicy(value: unknown): WorkspaceOverflowPolicy {
  const raw = normalizeString(value);
  return WORKSPACE_OVERFLOW_POLICIES.includes(raw as WorkspaceOverflowPolicy)
    ? (raw as WorkspaceOverflowPolicy)
    : "block_write";
}

export function normalizeWorkspaceRetentionPolicy(value: unknown): WorkspaceRetentionPolicy {
  const raw = normalizeString(value);
  return WORKSPACE_RETENTION_POLICIES.includes(raw as WorkspaceRetentionPolicy)
    ? (raw as WorkspaceRetentionPolicy)
    : "retain_delivery_only";
}

export function normalizeClusterProjectionMode(value: unknown): WorkerClusterProjectionMode {
  const raw = normalizeString(value);
  return WORKER_CLUSTER_PROJECTION_MODES.includes(raw as WorkerClusterProjectionMode)
    ? (raw as WorkerClusterProjectionMode)
    : "by_implementation";
}

export function normalizeCustomOverlayLayer(value: unknown): WorkerCustomOverlayLayer {
  const root = extractObject(value);
  const allowedFields = new Set(WORKER_CUSTOM_OVERLAY_FIELDS);
  const overlayFields = Array.isArray(root.overlay_fields)
    ? root.overlay_fields
        .map((item) => normalizeString(item))
        .filter((item): item is WorkerCustomOverlayField => allowedFields.has(item as WorkerCustomOverlayField))
    : [];
  const configRoot = extractObject(root.config);
  const config: WorkerCustomOverlayLayer["config"] = {};
  for (const field of overlayFields) {
    if (field in configRoot) {
      config[field] = configRoot[field];
    }
  }
  return {
    overlay_id: normalizeString(root.overlay_id, "none"),
    overlay_fields: Array.from(new Set(overlayFields)),
    config,
  };
}

const CUSTOM_TEMPLATE_FORBIDDEN_FIELDS = new Set([
  "budget_lane",
  "convergence_class",
  "reclaim_reason",
  "mailbox_status",
  "semantic_topology",
  "cluster_projection",
  "runtime_worker_control",
]);

function normalizeSupportedRoleTypes(value: unknown): WorkerDispatchContract["role_type"][] {
  const allowed = new Set<WorkerDispatchContract["role_type"]>([
    "worker-delivery",
    "tester-ephemeral",
    "audit-guard",
    "unknown",
  ]);
  const items = Array.isArray(value) ? value : [];
  const normalized = items
    .map((item) => normalizeString(item))
    .filter((item): item is WorkerDispatchContract["role_type"] =>
      allowed.has(item as WorkerDispatchContract["role_type"]),
    );
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["worker-delivery"];
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => normalizeString(item))
            .filter(Boolean),
        ),
      )
    : [];
}

function normalizeOptionalIsoDateTime(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeOverlayCapabilities(value: unknown): WorkerCustomOverlayField[] {
  const allowed = new Set(WORKER_CUSTOM_OVERLAY_FIELDS);
  return normalizeStringArray(value).filter((item): item is WorkerCustomOverlayField =>
    allowed.has(item as WorkerCustomOverlayField),
  );
}

function normalizeTemplateOriginList(value: unknown): WorkerTemplateOrigin[] {
  const items = Array.isArray(value) ? value : [];
  const normalized = items
    .map((item) => normalizeTemplateOrigin(item))
    .filter((item, index, all) => all.indexOf(item) === index);
  return normalized.length > 0 ? normalized : ["builtin"];
}

function normalizeTargetRolesByRole(
  value: unknown,
): Partial<Record<WorkerRoleLayer, string[]>> {
  const root = extractObject(value);
  const result: Partial<Record<WorkerRoleLayer, string[]>> = {};
  for (const role of WORKER_ROLE_LAYERS) {
    const normalized = normalizeStringArray(root[role]);
    if (normalized.length > 0) {
      result[role] = normalized;
    }
  }
  return result;
}

function normalizeMessageTypesByRole(
  value: unknown,
): Partial<Record<WorkerRoleLayer, TaskClusterMessageType>> {
  const root = extractObject(value);
  const result: Partial<Record<WorkerRoleLayer, TaskClusterMessageType>> = {};
  for (const role of WORKER_ROLE_LAYERS) {
    if (role in root) {
      result[role] = normalizeMessageType(root[role]);
    }
  }
  return result;
}

function normalizeRuntimeClasses(value: unknown): WorkerStageRuntimeClass[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((item) => normalizeString(item))
    .filter((item): item is WorkerStageRuntimeClass =>
      WORKER_STAGE_RUNTIME_CLASSES.includes(item as WorkerStageRuntimeClass),
    );
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["default_shell"];
}

function normalizeDeliveryModes(value: unknown): WorkerDeliveryMode[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((item) => normalizeString(item))
    .filter((item): item is WorkerDeliveryMode => WORKER_DELIVERY_MODES.includes(item as WorkerDeliveryMode));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["deterministic_python_bundle"];
}

function normalizeExportClasses(value: unknown): WorkerDeliveryExportRecord["export_class"][] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((item) => normalizeString(item))
    .filter((item): item is WorkerDeliveryExportRecord["export_class"] => item === "delivery_manifest");
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["delivery_manifest"];
}

function isConcreteOrPlaceholderTemplateKind(
  value: WorkerTemplateKind,
): value is Extract<WorkerTemplateKind, "concrete" | "placeholder"> {
  return value === "concrete" || value === "placeholder";
}

function normalizeCoarseTemplateRoleId(value: unknown, fallback = "backend"): CoarseTemplateRoleId {
  return normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function normalizeTemplateResolutionMountPath(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) =>
      normalizeString(item)
        .toLowerCase()
        .replace(/[^a-z0-9_/-]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .filter(Boolean);
}

function normalizeDomainGroup(value: unknown, fallback: CoarseTemplateRoleDomainGroup = "engineering"): string {
  const normalized = normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function findCoarseTemplateRoleEntry(
  registry: CoarseTemplateRoleRegistry,
  roleId: CoarseTemplateRoleId,
): CoarseTemplateRoleRegistryEntry | null {
  const normalizedRoleId = normalizeCoarseTemplateRoleId(roleId);
  return registry.roles.find((item) => item.role_id === normalizedRoleId) ?? null;
}

function isCoarseTemplateRoleEnabled(
  registry: CoarseTemplateRoleRegistry,
  roleId: CoarseTemplateRoleId,
): boolean {
  return findCoarseTemplateRoleEntry(registry, roleId)?.enabled === true;
}

function deriveBuiltinTemplateMount(
  spec: {
    template_id: string;
    template_origin: string;
    template_source_id: string;
    template_version: string;
    registration_source: string;
    handler_script: string;
    supported_role_types: string[];
    artifact_layer: string;
    role_layer: string;
    tech_layer: string;
    framework_layer: string;
    supported_component_candidates: string[];
    goal_matchers: string[];
    delivery_mode: string;
    template_kind: string;
    default_message_type: string;
    overlay_capabilities: string[];
    allowed_runtime_classes: string[];
    role_default: boolean;
  },
): WorkerTemplateSpec {
  const compatibilityRoleLayer = normalizeRoleLayer(spec.role_layer);
  const coarseTemplateRole = normalizeCoarseTemplateRoleId(spec.role_layer, compatibilityRoleLayer);
  const entry = findCoarseTemplateRoleEntry(buildBuiltinCoarseTemplateRoleRegistry(), coarseTemplateRole);
  return {
    ...spec,
    template_origin: normalizeTemplateOrigin(spec.template_origin),
    supported_role_types: normalizeSupportedRoleTypes(spec.supported_role_types),
    artifact_layer: normalizeArtifactLayer(spec.artifact_layer),
    coarse_template_role: coarseTemplateRole,
    role_layer: compatibilityRoleLayer,
    tech_layer: normalizeTechLayer(spec.tech_layer),
    framework_layer: normalizeFrameworkLayer(spec.framework_layer),
    mount_tree: entry?.domain_group ?? "engineering",
    mount_path: [coarseTemplateRole],
    delivery_mode: WORKER_DELIVERY_MODES.includes(spec.delivery_mode as WorkerDeliveryMode)
      ? (spec.delivery_mode as WorkerDeliveryMode)
      : "unsupported_placeholder",
    template_kind: normalizeTemplateKind(spec.template_kind),
    default_message_type: normalizeMessageType(spec.default_message_type),
    allowed_runtime_classes: normalizeRuntimeClasses(spec.allowed_runtime_classes),
  };
}

function templateMatchesMountedRole(
  template: Pick<WorkerTemplateSpec, "coarse_template_role" | "mount_path">,
  coarseTemplateRole?: CoarseTemplateRoleId,
): boolean {
  return (
    normalizeCoarseTemplateRoleId(template.coarse_template_role) === normalizeCoarseTemplateRoleId(coarseTemplateRole) &&
    template.mount_path.length > 0 &&
    normalizeCoarseTemplateRoleId(template.mount_path[0]) === normalizeCoarseTemplateRoleId(coarseTemplateRole)
  );
}

function normalizeCustomCoarseTemplateRoleEntry(value: unknown): CoarseTemplateRoleRegistryEntry | null {
  const root = extractObject(value);
  const roleId = normalizeCoarseTemplateRoleId(root.role_id);
  const displayName = normalizeString(root.display_name, roleId);
  const domainGroup = normalizeDomainGroup(root.domain_group);
  const description = normalizeString(root.description);
  const compatibilityRoleLayerRaw = normalizeString(root.compatibility_role_layer, "backend");
  if (!roleId || normalizeRoleLayer(compatibilityRoleLayerRaw) !== compatibilityRoleLayerRaw) {
    return null;
  }
  return {
    role_id: roleId,
    display_name: displayName,
    domain_group: domainGroup,
    enabled: root.enabled !== false,
    description,
    builtin: false,
    compatibility_role_layer: normalizeRoleLayer(compatibilityRoleLayerRaw),
  };
}

export function buildBuiltinCoarseTemplateRoleRegistry(): CoarseTemplateRoleRegistry {
  return {
    schema_version: "coarse-template-role-registry-v1",
    roles: BUILTIN_COARSE_TEMPLATE_ROLE_REGISTRY.map((entry) => ({ ...entry })),
  };
}

export function buildCustomCoarseTemplateRoleRegistry(params?: {
  taskMeta?: Record<string, unknown>;
  registrations?: unknown;
}): CoarseTemplateRoleRegistry {
  const workerRuntime = extractObject(params?.taskMeta?.worker_runtime);
  const registrations = Array.isArray(params?.registrations)
    ? params?.registrations
    : Array.isArray(workerRuntime.custom_coarse_template_roles)
      ? workerRuntime.custom_coarse_template_roles
      : [];
  return {
    schema_version: "coarse-template-role-registry-v1",
    roles: registrations
      .map((item) => normalizeCustomCoarseTemplateRoleEntry(item))
      .filter((item): item is CoarseTemplateRoleRegistryEntry => Boolean(item)),
  };
}

export function buildCoarseTemplateRoleRegistry(params?: {
  taskMeta?: Record<string, unknown>;
  registrations?: unknown;
}): CoarseTemplateRoleRegistry {
  const builtin = buildBuiltinCoarseTemplateRoleRegistry().roles;
  const custom = buildCustomCoarseTemplateRoleRegistry(params).roles;
  const entries = new Map<string, CoarseTemplateRoleRegistryEntry>();
  for (const item of builtin) {
    entries.set(item.role_id, item);
  }
  for (const item of custom) {
    entries.set(item.role_id, item);
  }
  return {
    schema_version: "coarse-template-role-registry-v1",
    roles: Array.from(entries.values()),
  };
}

export function normalizeCustomTemplateRegistration(
  value: unknown,
): CustomTemplateRegistrationContract | null {
  const root = extractObject(value);
  for (const forbiddenField of CUSTOM_TEMPLATE_FORBIDDEN_FIELDS) {
    if (forbiddenField in root) {
      return null;
    }
  }

  const templateId = normalizeString(root.template_id);
  const templateSourceId = normalizeString(root.template_source_id);
  const origin = normalizeTemplateOrigin(root.template_origin || "custom");
  const templateVersion = normalizeString(root.template_version, "v1");
  const registrationSource = normalizeString(root.registration_source, "entry");
  const registeredAt = normalizeOptionalIsoDateTime(root.registered_at);
  const enabled = root.enabled === true;
  const artifactLayerRaw = normalizeString(root.artifact_layer);
  const coarseTemplateRoleRaw = normalizeString(root.coarse_template_role || root.role_layer);
  const roleLayerRaw = normalizeString(root.role_layer);
  const techLayerRaw = normalizeString(root.tech_layer);
  const frameworkLayerRaw = normalizeString(root.framework_layer);
  const mountTree = normalizeDomainGroup(root.mount_tree);
  const mountPath = normalizeTemplateResolutionMountPath(root.mount_path);
  const deliveryModeRaw = normalizeString(root.delivery_mode);
  const templateKindRaw = normalizeString(root.template_kind);

  if (!templateId || !templateSourceId || origin !== "custom") {
    return null;
  }
  if (
    (artifactLayerRaw && normalizeArtifactLayer(artifactLayerRaw) !== artifactLayerRaw) ||
    (roleLayerRaw && normalizeRoleLayer(roleLayerRaw) !== roleLayerRaw) ||
    (techLayerRaw && normalizeTechLayer(techLayerRaw) !== techLayerRaw) ||
    (frameworkLayerRaw && normalizeFrameworkLayer(frameworkLayerRaw) !== frameworkLayerRaw)
  ) {
    return null;
  }
  const deliveryMode = WORKER_DELIVERY_MODES.includes(deliveryModeRaw as WorkerDeliveryMode)
    ? (deliveryModeRaw as WorkerDeliveryMode)
    : null;
  const templateKind = normalizeTemplateKind(templateKindRaw);
  if (!deliveryMode || !isConcreteOrPlaceholderTemplateKind(templateKind)) {
    return null;
  }
  const coarseTemplateRole = normalizeCoarseTemplateRoleId(coarseTemplateRoleRaw);
  if (!coarseTemplateRole || !mountTree || mountPath.length === 0 || mountPath[0] !== coarseTemplateRole) {
    return null;
  }

  const handlerScript = normalizeString(root.handler_script);
  if (templateKind === "concrete" && !handlerScript) {
    return null;
  }

  return {
    schema_version: "custom-template-registration-contract-v1",
    template_id: templateId,
    template_origin: "custom",
    template_source_id: templateSourceId,
    template_version: templateVersion,
    registration_source: registrationSource,
    registered_at: registeredAt,
    enabled,
    handler_script: handlerScript,
    supported_role_types: normalizeSupportedRoleTypes(root.supported_role_types),
    artifact_layer: normalizeArtifactLayer(artifactLayerRaw || "code"),
    coarse_template_role: coarseTemplateRole,
    role_layer: normalizeRoleLayer(roleLayerRaw || "backend"),
    tech_layer: normalizeTechLayer(techLayerRaw || "generic"),
    framework_layer: normalizeFrameworkLayer(frameworkLayerRaw || "generic"),
    mount_tree: mountTree,
    mount_path: mountPath,
    supported_component_candidates: normalizeStringArray(root.supported_component_candidates),
    goal_matchers: normalizeStringArray(root.goal_matchers),
    delivery_mode: deliveryMode,
    template_kind: templateKind,
    overlay_capabilities: normalizeOverlayCapabilities(root.overlay_capabilities),
    allowed_runtime_classes: normalizeRuntimeClasses(root.allowed_runtime_classes),
    allowed_delivery_modes: normalizeDeliveryModes(root.allowed_delivery_modes),
    allowed_attachment_types: normalizeStringArray(root.allowed_attachment_types),
    allowed_export_classes: normalizeExportClasses(root.allowed_export_classes),
    allowed_execution_mode: normalizeDispatchMode(root.allowed_execution_mode),
    requires_evidence_profile: normalizeEvidenceProfile(root.requires_evidence_profile),
    role_default: root.role_default === true,
  };
}
function sanitizeClusterSegment(value: string, fallback: string): string {
  const normalized = normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export function buildWorkerSemanticTopology(params: {
  semantic: WorkerSemanticContract;
  budget: WorkerBudgetContract;
  convergence: WorkerConvergenceContract;
}): WorkerSemanticTopology {
  return {
    transaction_layer: normalizeTransactionLayer(params.semantic.transaction_layer),
    action_layer: normalizeActionLayer(params.semantic.action_layer),
    budget_layer: normalizeBudgetLane(params.budget.budget_lane),
    convergence_layer: normalizeConvergenceClass(params.convergence.convergence_class),
  };
}

export function buildWorkerImplementationTopology(params: {
  semantic: WorkerSemanticContract;
  taskMeta?: Record<string, unknown>;
}): WorkerImplementationTopology {
  const componentSet = new Set(params.semantic.component_candidates.map((item) => normalizeString(item).toLowerCase()));
  let roleLayer: WorkerRoleLayer = "backend";
  let techLayer: WorkerTechLayer = "generic";
  let frameworkLayer: WorkerFrameworkLayer = "generic";
  const workerRuntime = extractObject(params.taskMeta?.worker_runtime);

  if (componentSet.has("frontend_ui") || componentSet.has("frontend")) {
    roleLayer = "frontend";
    techLayer = "typescript";
    frameworkLayer = "react";
  } else if (componentSet.has("ui_surface") || componentSet.has("ui")) {
    roleLayer = "ui";
    techLayer = "typescript";
    frameworkLayer = "react";
  } else if (componentSet.has("database_schema") || componentSet.has("sql_migration")) {
    roleLayer = "database";
    techLayer = "sql";
  } else if (componentSet.has("data_pipeline")) {
    roleLayer = "data";
    techLayer = "python";
  } else if (componentSet.has("infra_runtime")) {
    roleLayer = "infra";
    techLayer = "generic";
  } else if (componentSet.has("script_automation")) {
    roleLayer = "script_automation";
    techLayer = "python";
  } else if (componentSet.has("websocket_calculator") || componentSet.has("calculator_transport")) {
    roleLayer = "backend";
    techLayer = "python";
  }

  const coarseRoleRegistry = buildCoarseTemplateRoleRegistry({ taskMeta: params.taskMeta });
  const runtimeRoleLayer = normalizeRoleLayer(workerRuntime.role_layer);
  const runtimeCoarseTemplateRole = normalizeString(workerRuntime.coarse_template_role)
    ? normalizeCoarseTemplateRoleId(workerRuntime.coarse_template_role, roleLayer)
    : "";
  const runtimeTechLayer = normalizeTechLayer(workerRuntime.tech_layer);
  const runtimeFrameworkLayer = normalizeFrameworkLayer(workerRuntime.framework_layer);
  let workerStageProfileHint: WorkerWorkspaceProfile =
    roleLayer === "data" || roleLayer === "infra" ? "heavy" : roleLayer === "script_automation" ? "light" : "normal";
  if (normalizeString(workerRuntime.role_layer)) {
    roleLayer = runtimeRoleLayer;
  }
  if (normalizeString(workerRuntime.tech_layer)) {
    techLayer = runtimeTechLayer;
  }
  if (normalizeString(workerRuntime.framework_layer)) {
    frameworkLayer = runtimeFrameworkLayer;
  }
  workerStageProfileHint = normalizeWorkspaceProfile(
    workerRuntime.worker_stage_profile_hint ||
      (roleLayer === "data" || roleLayer === "infra"
        ? "heavy"
        : roleLayer === "script_automation"
          ? "light"
      : "normal"),
  );
  let coarseTemplateRole = runtimeCoarseTemplateRole || normalizeCoarseTemplateRoleId(roleLayer, roleLayer);
  if (!isCoarseTemplateRoleEnabled(coarseRoleRegistry, coarseTemplateRole)) {
    coarseTemplateRole = normalizeCoarseTemplateRoleId(roleLayer, roleLayer);
  }
  if (!isCoarseTemplateRoleEnabled(coarseRoleRegistry, coarseTemplateRole)) {
    coarseTemplateRole = "backend";
    roleLayer = "backend";
    techLayer = "generic";
    frameworkLayer = "generic";
  }

  return {
    artifact_layer: normalizeArtifactLayer(workerRuntime.artifact_layer),
    coarse_template_role: coarseTemplateRole,
    role_layer: roleLayer,
    tech_layer: techLayer,
    framework_layer: frameworkLayer,
    worker_stage_profile_hint: workerStageProfileHint,
    custom_overlay_layer: normalizeCustomOverlayLayer(workerRuntime.custom_overlay_layer),
  };
}

export function buildWorkerClusterProjection(params: {
  semantic: WorkerSemanticTopology;
  implementation: WorkerImplementationTopology;
}): WorkerClusterProjection {
  const semanticKey = [
    "semantic",
    params.semantic.transaction_layer,
    params.semantic.action_layer,
  ]
    .map((item) => sanitizeClusterSegment(item, "generic"))
    .join(".");
  const implementationKey = [
    "implementation",
    params.implementation.artifact_layer,
    params.implementation.role_layer,
    params.implementation.tech_layer,
  ]
    .map((item) => sanitizeClusterSegment(item, "generic"))
    .join(".");
  const hybridKey = [
    "hybrid",
    params.implementation.artifact_layer,
    params.implementation.role_layer,
    params.semantic.action_layer,
  ]
    .map((item) => sanitizeClusterSegment(item, "generic"))
    .join(".");
  return {
    schema_version: "worker-cluster-projection-v1",
    semantic_clusters: [semanticKey],
    implementation_clusters: [implementationKey],
    hybrid_clusters: [hybridKey],
  };
}

export function deriveTaskClusterMemberships(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
  implementation?: WorkerImplementationTopology;
  clusterProjection?: WorkerClusterProjection;
}): string[] {
  const roleMembership = `role:${params.dispatch.role_type}`;
  const projectMembership = `project:${params.semantic.project_id}`;
  const workspaceMembership = params.semantic.workspace_root
    ? `workspace:${params.semantic.workspace_root.replace(/[^A-Za-z0-9._/-]+/g, "_")}`
    : "";
  const componentMemberships = params.semantic.component_candidates.map((item) => `component:${item}`);
  const topologyMemberships = params.implementation
    ? [
        `artifact:${params.implementation.artifact_layer}`,
        `impl_role:${params.implementation.role_layer}`,
        `tech:${params.implementation.tech_layer}`,
      ]
    : [];
  const projectionMemberships = params.clusterProjection
    ? [
        ...params.clusterProjection.semantic_clusters.map((item) => `cluster:${item}`),
        ...params.clusterProjection.implementation_clusters.map((item) => `cluster:${item}`),
        ...params.clusterProjection.hybrid_clusters.map((item) => `cluster:${item}`),
      ]
    : [];
  return Array.from(
    new Set(
      [
        roleMembership,
        projectMembership,
        workspaceMembership,
        ...componentMemberships,
        ...topologyMemberships,
        ...projectionMemberships,
      ].filter(Boolean),
    ),
  );
}

export function deriveTaskClusterId(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
  implementation?: WorkerImplementationTopology;
}): string {
  const clusterIdRaw = [
    params.semantic.project_id || "prj_default",
    params.implementation?.artifact_layer || params.dispatch.role_type,
    params.implementation?.role_layer || params.dispatch.role_type,
    params.implementation?.tech_layer || params.semantic.component_candidates[0] || "generic",
  ]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `cluster_${clusterIdRaw || "generic"}`;
}

export function normalizeMailboxCounters(value: unknown): WorkerCollaborationContract["mailbox_counters"] {
  const root = extractObject(value);
  return {
    published: Math.max(0, normalizePositiveInt(root.published, 0)),
    acknowledged: Math.max(0, normalizePositiveInt(root.acknowledged, 0)),
    consumed: Math.max(0, normalizePositiveInt(root.consumed, 0)),
    archived: Math.max(0, normalizePositiveInt(root.archived, 0)),
  };
}

export function buildWorkerRuntimeControlSummary(params: {
  previous?: Record<string, unknown>;
  budgetLane: WorkerBudgetLaneType;
  rebuildReason?: string;
  now: string;
}): WorkerRuntimeControlSummary {
  const previous = extractObject(params.previous);
  const previousBudgetStatus = normalizeBudgetLane(previous.budget_status);
  const reclaimRequestedAt =
    params.budgetLane === "reclaim_pending"
      ? normalizeString(previous.reclaim_requested_at, params.now)
      : "";
  const rebuildReady =
    previous.rebuild_ready === true ||
    (previousBudgetStatus === "reclaim_pending" && params.budgetLane !== "reclaim_pending");
  return {
    budget_status: params.budgetLane,
    reclaim_requested_at: reclaimRequestedAt,
    rebuild_ready: rebuildReady,
    rebuild_reason: rebuildReady
      ? normalizeString(params.rebuildReason || previous.rebuild_reason, "budget_or_refinement_amendment")
      : "",
    last_rebuilt_at: rebuildReady ? params.now : normalizeString(previous.last_rebuilt_at),
    last_worker_fault_action: normalizeFaultAction(previous.last_worker_fault_action),
    worker_fault_retryable: previous.worker_fault_retryable === true,
    worker_fault_requires_rebuild: previous.worker_fault_requires_rebuild === true,
    last_fault_action_applied: normalizeFaultAction(previous.last_fault_action_applied),
    fault_actuation_mode: normalizeFaultActuationMode(previous.fault_actuation_mode),
    fault_action_blocked_by_policy: previous.fault_action_blocked_by_policy === true,
    worker_fault_class: normalizeString(previous.worker_fault_class),
    archive_ready: previous.archive_ready === true,
    reclaim_ready: previous.reclaim_ready === true,
    purge_ready: previous.purge_ready === true,
    retention_decision: normalizeString(previous.retention_decision),
  };
}

function normalizeFaultActuationMode(value: unknown): "disabled" | "summary_only" | "enabled" {
  const raw = normalizeString(value);
  if (raw === "disabled" || raw === "enabled") {
    return raw;
  }
  return "summary_only";
}

function normalizeFaultAction(value: unknown): WorkerFaultAction {
  const raw = normalizeString(value);
  return WORKER_FAULT_ACTIONS.includes(raw as WorkerFaultAction) ? (raw as WorkerFaultAction) : "none";
}

function normalizeDispatchMode(value: unknown): WorkerDispatchContract["mode"] {
  const raw = normalizeString(value);
  return raw === "container" || raw === "distributed" ? raw : "local_threads";
}

function sanitizeWorkerInstanceSegment(value: string, fallback: string): string {
  return (
    normalizeString(value, fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

export function deriveWorkerStageId(params: {
  taskId: string;
  operationId: string;
  dispatchSeq: number;
}): string {
  return [
    "workerstage",
    sanitizeWorkerInstanceSegment(params.taskId, "task"),
    sanitizeWorkerInstanceSegment(params.operationId, "op"),
    String(Math.max(1, params.dispatchSeq)),
  ].join("_");
}

export function buildWorkerStageContract(params: {
  taskDir: string;
  taskMeta?: Record<string, unknown>;
  dispatch: WorkerDispatchContract;
  implementationTopology: WorkerImplementationTopology;
  policyTemplate?: WorkerLifecyclePolicyTemplate;
}): WorkerStageContract {
  const policy = params.policyTemplate ?? buildSchedulerWorkerLifecyclePolicyTemplate();
  const scheduler = extractObject(params.taskMeta?.scheduler);
  const degrade = extractObject(scheduler.degrade);
  const profile = params.implementationTopology.worker_stage_profile_hint;
  const profileDefaults =
    policy.worker_stage_policy.worker_stage_profile_defaults[profile] ??
    policy.worker_stage_policy.worker_stage_profile_defaults.normal;
  const degradedStageCap = Math.max(0, normalizePositiveInt(degrade.current_stage_write_budget_cap, 0));
  const workerStageMaxBytes =
    degradedStageCap > 0
      ? Math.min(profileDefaults.worker_stage_max_bytes, degradedStageCap)
      : profileDefaults.worker_stage_max_bytes;
  const workerStageId = deriveWorkerStageId({
    taskId: params.dispatch.task_id,
    operationId: params.dispatch.operation_id,
    dispatchSeq: params.dispatch.dispatch_seq,
  });
  const workerStageRoot = path.join(params.taskDir, "worker_stages", workerStageId);
  return {
    schema_version: "worker-stage-contract-v1",
    task_id: params.dispatch.task_id,
    worker_stage_id: workerStageId,
    worker_stage_profile: profile,
    stage_isolation_mode: policy.worker_stage_policy.stage_isolation_mode,
    stage_runtime_class: policy.worker_stage_policy.stage_runtime_class,
    allowed_execution_mode: policy.worker_stage_policy.allowed_execution_mode,
    worker_stage_root: workerStageRoot,
    scratch_root: path.join(workerStageRoot, "scratch"),
    delivery_root: path.join(workerStageRoot, "delivery"),
    inputs_root: path.join(workerStageRoot, "inputs"),
    runtime_root: path.join(workerStageRoot, "runtime"),
    mount_policy: {
      inputs_root: "read_only",
      scratch_root: "read_write",
      delivery_root: "write_only",
      cluster_mailbox: "append_only",
      authority_paths: "read_only",
    },
    allocation: {
      worker_stage_scope: policy.worker_stage_policy.worker_stage_scope,
      worker_stage_max_bytes: workerStageMaxBytes,
      worker_stage_max_file_count: profileDefaults.worker_stage_max_file_count,
      worker_stage_max_single_file_bytes: profileDefaults.worker_stage_max_single_file_bytes,
      allow_binary_artifacts: profileDefaults.allow_binary_artifacts,
      worker_stage_overflow_policy: policy.worker_stage_policy.worker_stage_overflow_policy,
    },
    retention: {
      worker_stage_retention_policy: policy.worker_stage_policy.worker_stage_retention_policy,
      success_cleanup_rule: policy.worker_stage_policy.success_cleanup_rule,
      failure_cleanup_rule: policy.worker_stage_policy.failure_cleanup_rule,
      purge_on_success: policy.worker_stage_policy.purge_on_success,
      purge_on_failure: policy.worker_stage_policy.purge_on_failure,
    },
  };
}

export function buildSchedulerWorkerLifecyclePolicyTemplate(): WorkerLifecyclePolicyTemplate {
  return {
    schema_version: "worker-lifecycle-policy-template-v1",
    policy_id: SCHEDULER_WORKER_LIFECYCLE_POLICY_TEMPLATE_ID,
    enabled: true,
    budget_policy: {
      primary_axis: "token",
      allow_degraded_lane: true,
      allow_reclaim_pending: true,
    },
    template_policy: {
      allow_builtin: true,
      allow_custom: true,
      require_enabled_custom_registration: true,
    },
    overlay_policy: {
      allowed_overlay_fields: [...WORKER_CUSTOM_OVERLAY_FIELDS],
    },
    mailbox_policy: {
      default_message_type_by_role: {
        frontend: "partial_deliverable",
        backend: "partial_deliverable",
        ui: "partial_deliverable",
        database: "partial_deliverable",
        data: "dependency_update",
        infra: "handoff_note",
        script_automation: "handoff_note",
      },
      default_target_roles_by_role: {
        frontend: ["tester-ephemeral"],
        backend: ["tester-ephemeral"],
        ui: ["tester-ephemeral"],
        database: ["tester-ephemeral"],
        data: ["worker-delivery"],
        infra: ["tester-ephemeral", "audit-guard"],
        script_automation: ["tester-ephemeral", "audit-guard"],
      },
    },
    result_contract_policy: {
      required_result_contract_version: WORKER_RESULT_CONTRACT_VERSION,
      strict_result_validation: true,
    },
    worker_stage_policy: {
      worker_stage_scope: "per_worker_instance",
      stage_isolation_mode: "wrapper_enforced",
      stage_runtime_class: "default_shell",
      allowed_execution_mode: "local_threads",
      worker_stage_overflow_policy: "block_write",
      worker_stage_retention_policy: "retain_delivery_only",
      success_cleanup_rule: "retain_delivery_only",
      failure_cleanup_rule: "retain_evidence_bundle",
      purge_on_success: true,
      purge_on_failure: false,
      export_policy: {
        allow_delivery_manifest_only: true,
        retain_on_success: true,
        retain_on_failure: true,
        archive_on_tester_consume: true,
        archive_failed_export_evidence: true,
        retain_export_records_when_stage_purged: true,
        purge_artifacts_after_archive: false,
        retain_archive_manifest: true,
      },
      mailbox_attachment_policy: {
        allow_exported_artifact_references: true,
        max_attachment_bytes: 5_000_000,
        allowed_artifact_types: ["text/plain", "text/markdown", "application/json", "application/x-python"],
      },
      worker_stage_profile_defaults: {
        light: {
          worker_stage_max_bytes: 256_000,
          worker_stage_max_file_count: 32,
          worker_stage_max_single_file_bytes: 64_000,
          allow_binary_artifacts: false,
        },
        normal: {
          worker_stage_max_bytes: 1_000_000,
          worker_stage_max_file_count: 128,
          worker_stage_max_single_file_bytes: 256_000,
          allow_binary_artifacts: false,
        },
        heavy: {
          worker_stage_max_bytes: 5_000_000,
          worker_stage_max_file_count: 512,
          worker_stage_max_single_file_bytes: 1_000_000,
          allow_binary_artifacts: false,
        },
      },
    },
    fault_handling_policy: {
      worker_stage_exhausted: "rebuild",
      worker_stage_forbidden_write: "block",
      worker_stage_attachment_policy_violation: "block",
      worker_stage_export_manifest_invalid: "block",
      worker_stage_binary_artifact_disallowed: "block",
    },
    evidence_policy: {
      default_profile_by_role: {
        frontend: "frontend_profile",
        backend: "backend_profile",
        ui: "frontend_profile",
        database: "database_profile",
        data: "data_profile",
        infra: "infra_profile",
        script_automation: "script_automation_profile",
      },
      profiles: {
        frontend_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: true,
          allow_missing_test_command_with_reason: false,
        },
        backend_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: true,
          allow_missing_test_command_with_reason: false,
        },
        infra_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: true,
          allow_missing_test_command_with_reason: false,
        },
        database_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: false,
          allow_missing_test_command_with_reason: false,
        },
        data_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: false,
          allow_missing_test_command_with_reason: false,
        },
        script_automation_profile: {
          require_summary: true,
          require_test_command: true,
          require_changed_files: true,
          require_evidence_notes: true,
          require_runbook: false,
          allow_missing_test_command_with_reason: false,
        },
      },
    },
    rebuild_policy: {
      allow_rebuild: true,
      rebuild_on_budget_amendment: true,
      rebuild_on_refinement_amendment: true,
    },
  };
}

export function buildWorkerLifecycleGovernanceContract(params: {
  taskMeta: Record<string, unknown>;
  budget: WorkerBudgetContract;
  dispatch: WorkerDispatchContract;
  implementationTopology: WorkerImplementationTopology;
  workerStage: WorkerStageContract;
  collaboration: WorkerCollaborationContract;
  selectedTemplate: WorkerSelectedTemplateSummary;
  policyTemplate?: WorkerLifecyclePolicyTemplate;
}): WorkerLifecycleGovernanceContract {
  const policy = params.policyTemplate ?? buildSchedulerWorkerLifecyclePolicyTemplate();
  const allowedTemplateOrigins = normalizeTemplateOriginList([
    ...(policy.template_policy.allow_builtin ? ["builtin"] : []),
    ...(policy.template_policy.allow_custom ? ["custom"] : []),
  ]);
  const overlayFields = new Set(policy.overlay_policy.allowed_overlay_fields);
  const effectiveOverlayDefaults: Partial<Record<WorkerCustomOverlayField, unknown>> = {};
  for (const field of params.implementationTopology.custom_overlay_layer.overlay_fields) {
    if (overlayFields.has(field) && field in params.implementationTopology.custom_overlay_layer.config) {
      effectiveOverlayDefaults[field] = params.implementationTopology.custom_overlay_layer.config[field];
    }
  }

  const registrationItems = Array.isArray(extractObject(params.taskMeta.worker_runtime).custom_template_registrations)
    ? (extractObject(params.taskMeta.worker_runtime).custom_template_registrations as unknown[])
    : [];
  const normalizedRegistrations = registrationItems
    .map((item) => normalizeCustomTemplateRegistration(item))
    .filter((item): item is CustomTemplateRegistrationContract => Boolean(item));
  const selectedCustomRegistration =
    params.selectedTemplate.template_origin !== "custom"
      ? null
      : normalizedRegistrations.find(
          (item) =>
            item.template_id === params.selectedTemplate.template_id &&
            item.template_source_id === params.selectedTemplate.template_source_id,
        ) ?? null;
  const selectedCustomRegistrationEnabled =
    params.selectedTemplate.template_origin !== "custom" ? true : selectedCustomRegistration?.enabled === true;
  const selectedCustomRuntimeGateStatus =
    params.selectedTemplate.template_origin !== "custom"
      ? "not_applicable"
      : selectedCustomRegistration &&
          selectedCustomRegistration.allowed_runtime_classes.includes(params.workerStage.stage_runtime_class)
        ? "allowed"
        : "blocked";
  const evidenceProfile =
    policy.evidence_policy.default_profile_by_role[params.implementationTopology.role_layer] ?? "backend_profile";
  const effectiveEvidencePolicy = policy.evidence_policy.profiles[evidenceProfile] ?? policy.evidence_policy.profiles.backend_profile;
  const mailboxAttachmentTypes = policy.worker_stage_policy.mailbox_attachment_policy.allowed_artifact_types;
  const selectedCustomCapabilityGateReason =
    params.selectedTemplate.template_origin !== "custom"
      ? ""
      : !selectedCustomRegistration
        ? "missing_custom_registration"
        : !selectedCustomRegistration.allowed_runtime_classes.includes(params.workerStage.stage_runtime_class)
          ? "runtime_class_mismatch"
          : !selectedCustomRegistration.allowed_delivery_modes.includes(params.selectedTemplate.delivery_mode)
            ? "delivery_mode_mismatch"
            : selectedCustomRegistration.allowed_execution_mode !== params.workerStage.allowed_execution_mode
              ? "execution_mode_mismatch"
              : !selectedCustomRegistration.allowed_export_classes.includes("delivery_manifest")
                ? "export_class_mismatch"
                : selectedCustomRegistration.allowed_attachment_types.length > 0 &&
                    mailboxAttachmentTypes.some(
                      (item) => !selectedCustomRegistration.allowed_attachment_types.includes(item),
                    )
                  ? "attachment_type_mismatch"
                  : selectedCustomRegistration.requires_evidence_profile !== evidenceProfile
                    ? "evidence_profile_mismatch"
                    : "";
  const selectedCustomCapabilityGateStatus =
    params.selectedTemplate.template_origin !== "custom"
      ? "not_applicable"
      : selectedCustomCapabilityGateReason
        ? "blocked"
        : selectedCustomRuntimeGateStatus;

  const mailboxDefaultMessage =
    policy.mailbox_policy.default_message_type_by_role[params.implementationTopology.role_layer] ??
    params.selectedTemplate.default_message_type;
  const mailboxDefaultTargets =
    params.collaboration.default_target_role_types.length > 0
      ? params.collaboration.default_target_role_types
      : policy.mailbox_policy.default_target_roles_by_role[params.implementationTopology.role_layer] ?? [];

  return {
    schema_version: "worker-lifecycle-governance-contract-v1",
    policy_id: policy.policy_id,
    task_id: params.dispatch.task_id,
    operation_id: params.dispatch.operation_id,
    dispatch_seq: params.dispatch.dispatch_seq,
    budget_governance: {
      budget_lane: params.budget.budget_lane,
      fast_token_budget: params.budget.fast_token_budget,
      degraded_token_budget: params.budget.degraded_token_budget,
      reclaim_threshold: params.budget.reclaim_threshold,
      primary_axis: policy.budget_policy.primary_axis,
    },
    template_governance: {
      allowed_template_origins: allowedTemplateOrigins,
      require_enabled_custom_registration: policy.template_policy.require_enabled_custom_registration,
      selected_template_origin: params.selectedTemplate.template_origin,
      selected_template_id: params.selectedTemplate.template_id,
      selected_custom_registration_enabled: selectedCustomRegistrationEnabled,
      selected_custom_runtime_gate_status: selectedCustomCapabilityGateStatus,
      selected_custom_capability_gate_reason: selectedCustomCapabilityGateReason,
    },
    overlay_governance: {
      allowed_overlay_fields: [...policy.overlay_policy.allowed_overlay_fields],
      effective_overlay_defaults: effectiveOverlayDefaults,
    },
    mailbox_governance: {
      default_message_type: mailboxDefaultMessage,
      default_target_role_types: mailboxDefaultTargets,
      message_type_allowlist: [...params.collaboration.message_type_allowlist],
    },
    result_governance: {
      required_result_contract_version: policy.result_contract_policy.required_result_contract_version,
      strict_result_validation: policy.result_contract_policy.strict_result_validation,
    },
    evidence_governance: {
      evidence_profile: evidenceProfile,
      require_summary: effectiveEvidencePolicy.require_summary,
      require_test_command: effectiveEvidencePolicy.require_test_command,
      require_changed_files: effectiveEvidencePolicy.require_changed_files,
      require_evidence_notes: effectiveEvidencePolicy.require_evidence_notes,
      require_runbook: effectiveEvidencePolicy.require_runbook,
      allow_missing_test_command_with_reason: effectiveEvidencePolicy.allow_missing_test_command_with_reason,
    },
    worker_stage_governance: {
      worker_stage_scope: params.workerStage.allocation.worker_stage_scope,
      worker_stage_profile: params.workerStage.worker_stage_profile,
      stage_isolation_mode: params.workerStage.stage_isolation_mode,
      stage_runtime_class: params.workerStage.stage_runtime_class,
      allowed_execution_mode: params.workerStage.allowed_execution_mode,
      worker_stage_max_bytes: params.workerStage.allocation.worker_stage_max_bytes,
      worker_stage_max_file_count: params.workerStage.allocation.worker_stage_max_file_count,
      worker_stage_max_single_file_bytes: params.workerStage.allocation.worker_stage_max_single_file_bytes,
      allow_binary_artifacts: params.workerStage.allocation.allow_binary_artifacts,
      worker_stage_overflow_policy: params.workerStage.allocation.worker_stage_overflow_policy,
      worker_stage_retention_policy: params.workerStage.retention.worker_stage_retention_policy,
      success_cleanup_rule: params.workerStage.retention.success_cleanup_rule,
      failure_cleanup_rule: params.workerStage.retention.failure_cleanup_rule,
      purge_on_success: params.workerStage.retention.purge_on_success,
      purge_on_failure: params.workerStage.retention.purge_on_failure,
      export_policy: {
        allow_delivery_manifest_only: policy.worker_stage_policy.export_policy.allow_delivery_manifest_only,
        retain_on_success: policy.worker_stage_policy.export_policy.retain_on_success,
        retain_on_failure: policy.worker_stage_policy.export_policy.retain_on_failure,
        archive_on_tester_consume: policy.worker_stage_policy.export_policy.archive_on_tester_consume,
        archive_failed_export_evidence: policy.worker_stage_policy.export_policy.archive_failed_export_evidence,
        retain_export_records_when_stage_purged:
          policy.worker_stage_policy.export_policy.retain_export_records_when_stage_purged,
        purge_artifacts_after_archive: policy.worker_stage_policy.export_policy.purge_artifacts_after_archive,
        retain_archive_manifest: policy.worker_stage_policy.export_policy.retain_archive_manifest,
      },
      mailbox_attachment_policy: {
        allow_exported_artifact_references:
          policy.worker_stage_policy.mailbox_attachment_policy.allow_exported_artifact_references,
        max_attachment_bytes: policy.worker_stage_policy.mailbox_attachment_policy.max_attachment_bytes,
        allowed_artifact_types: [...policy.worker_stage_policy.mailbox_attachment_policy.allowed_artifact_types],
      },
    },
    rebuild_governance: {
      allow_rebuild: policy.rebuild_policy.allow_rebuild,
      rebuild_on_budget_amendment: policy.rebuild_policy.rebuild_on_budget_amendment,
      rebuild_on_refinement_amendment: policy.rebuild_policy.rebuild_on_refinement_amendment,
    },
  };
}

export const buildDefaultWorkerLifecyclePolicyTemplate = buildSchedulerWorkerLifecyclePolicyTemplate;

export function buildKeeperFeedbackSummary(params: {
  view: WorkerRuntimeView;
  taskMeta: Record<string, unknown>;
}): Record<string, unknown> {
  const previous = extractObject(params.taskMeta.keeper_feedback);
  const feedbackTypes: WorkerKeeperFeedbackType[] = [];
  let keeperReason = "";
  if (params.view.budget.budget_lane === "reclaim_pending") {
    feedbackTypes.push("capacity_allocation_feedback");
    keeperReason = "token_budget_exhausted";
  }
  if (params.view.convergence.convergence_class === "stalled") {
    feedbackTypes.push("refinement_quality_feedback");
    keeperReason = params.view.convergence.reclaim_reason || keeperReason || "stalled_no_effective_progress";
  }
  return {
    feedback_types: feedbackTypes,
    last_feedback_at: feedbackTypes.length > 0 ? params.view.assembled_at : "",
    reason: keeperReason,
    submitted_candidates: Array.isArray(previous.submitted_candidates)
      ? previous.submitted_candidates
      : [],
    submitted_fingerprints: Array.isArray(previous.submitted_fingerprints)
      ? previous.submitted_fingerprints
      : [],
    last_submitted_at: normalizeString(previous.last_submitted_at),
  };
}

export function buildKeeperFeedbackFingerprint(params: {
  feedbackType: WorkerKeeperFeedbackType;
  reason: string;
  projectId: string;
  componentCandidates: string[];
  budgetLane: WorkerBudgetLaneType;
}): string {
  return [
    params.feedbackType,
    params.reason || "none",
    params.projectId || "prj_default",
    params.componentCandidates.join("+") || "generic",
    params.budgetLane,
  ]
    .map((item) =>
      normalizeString(item)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    )
    .join("__");
}

export function buildWorkerBaseTemplateRegistry(): WorkerTemplateSpec[] {
  return [
    {
      template_id: "worker_base_template",
      template_origin: "builtin",
      template_source_id: "builtin:worker_base_template",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery", "tester-ephemeral", "audit-guard", "unknown"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      template_kind: "base",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
  ].map((item) => deriveBuiltinTemplateMount(item));
}

export function buildWorkerArtifactTemplateRegistry(): WorkerTemplateSpec[] {
  return [
    {
      template_id: "artifact_code_template",
      template_origin: "builtin",
      template_source_id: "builtin:artifact_code_template",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery", "tester-ephemeral"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      template_kind: "artifact",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "artifact_document_reserved_template",
      template_origin: "builtin",
      template_source_id: "builtin:artifact_document_reserved_template",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "document_reserved",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      template_kind: "artifact",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "artifact_image_reserved_template",
      template_origin: "builtin",
      template_source_id: "builtin:artifact_image_reserved_template",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "image_reserved",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      template_kind: "artifact",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
  ].map((item) => deriveBuiltinTemplateMount(item));
}

export function buildWorkerRoleTemplateRegistry(): WorkerTemplateSpec[] {
  return [
    {
      template_id: "role_code_frontend",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_frontend",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "frontend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["frontend_ui", "frontend"],
      goal_matchers: ["frontend"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "role_code_backend",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_backend",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["websocket_calculator", "calculator_transport"],
      goal_matchers: ["backend"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: true,
    },
    {
      template_id: "role_code_ui",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_ui",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "ui",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["ui_surface", "ui"],
      goal_matchers: ["ui"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "role_code_database",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_database",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "database",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["database_schema", "sql_migration"],
      goal_matchers: ["database", "sql"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "role_code_data",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_data",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "data",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["data_pipeline"],
      goal_matchers: ["data"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "dependency_update",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "role_code_infra",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_infra",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "infra",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["infra_runtime"],
      goal_matchers: ["infra"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "role_code_script_automation",
      template_origin: "builtin",
      template_source_id: "builtin:role_code_script_automation",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "script_automation",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["script_automation"],
      goal_matchers: ["script", "automation"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "role",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
  ].map((item) => deriveBuiltinTemplateMount(item));
}

export function buildWorkerExecutableTemplateRegistry(): WorkerTemplateSpec[] {
  return [
    {
      template_id: "websocket_calculator",
      template_origin: "builtin",
      template_source_id: "builtin:websocket_calculator",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/websocket_calculator.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "python",
      framework_layer: "generic",
      supported_component_candidates: ["websocket_calculator", "calculator_transport"],
      goal_matchers: ["websocket", "calculator"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_frontend_typescript_react",
      template_origin: "builtin",
      template_source_id: "builtin:code_frontend_typescript_react",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_frontend_typescript_react.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "frontend",
      tech_layer: "typescript",
      framework_layer: "react",
      supported_component_candidates: ["frontend_ui", "frontend"],
      goal_matchers: ["frontend"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_backend_java_spring",
      template_origin: "builtin",
      template_source_id: "builtin:code_backend_java_spring",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_backend_java_spring.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "java",
      framework_layer: "spring",
      supported_component_candidates: ["java_service", "spring_service"],
      goal_matchers: ["java", "spring"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_database_sql_generic",
      template_origin: "builtin",
      template_source_id: "builtin:code_database_sql_generic",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_database_sql_generic.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "database",
      tech_layer: "sql",
      framework_layer: "generic",
      supported_component_candidates: ["database_schema", "sql_migration"],
      goal_matchers: ["database", "sql"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_data_python_generic",
      template_origin: "builtin",
      template_source_id: "builtin:code_data_python_generic",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_data_python_generic.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "data",
      tech_layer: "python",
      framework_layer: "generic",
      supported_component_candidates: ["data_pipeline"],
      goal_matchers: ["data", "pipeline"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "dependency_update",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_infra_generic_generic",
      template_origin: "builtin",
      template_source_id: "builtin:code_infra_generic_generic",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_infra_generic_generic.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "infra",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["infra_runtime"],
      goal_matchers: ["infra", "runtime"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_script_automation_python_generic",
      template_origin: "builtin",
      template_source_id: "builtin:code_script_automation_python_generic",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "worker_templates/code_script_automation_python_generic.sh",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "script_automation",
      tech_layer: "python",
      framework_layer: "generic",
      supported_component_candidates: ["script_automation"],
      goal_matchers: ["script", "automation"],
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: false,
    },
    {
      template_id: "code_generic_placeholder",
      template_origin: "builtin",
      template_source_id: "builtin:code_generic_placeholder",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: ["placeholder_delivery"],
      goal_matchers: ["placeholder_delivery"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "placeholder",
      default_message_type: "partial_deliverable",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: true,
    },
    {
      template_id: "tester_placeholder",
      template_origin: "builtin",
      template_source_id: "builtin:tester_placeholder",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["tester-ephemeral"],
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: [],
      delivery_mode: "unsupported_placeholder",
      template_kind: "placeholder",
      default_message_type: "handoff_note",
      overlay_capabilities: [],
      allowed_runtime_classes: ["default_shell"],
      role_default: true,
    },
    {
      template_id: "document_reserved_placeholder",
      template_origin: "builtin",
      template_source_id: "builtin:document_reserved_placeholder",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "document_reserved",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: ["document"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "placeholder",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: true,
    },
    {
      template_id: "image_reserved_placeholder",
      template_origin: "builtin",
      template_source_id: "builtin:image_reserved_placeholder",
      template_version: "v1",
      registration_source: "builtin_registry",
      handler_script: "",
      supported_role_types: ["worker-delivery"],
      artifact_layer: "image_reserved",
      role_layer: "backend",
      tech_layer: "generic",
      framework_layer: "generic",
      supported_component_candidates: [],
      goal_matchers: ["image"],
      delivery_mode: "unsupported_placeholder",
      template_kind: "placeholder",
      default_message_type: "handoff_note",
      overlay_capabilities: [...WORKER_CUSTOM_OVERLAY_FIELDS],
      allowed_runtime_classes: ["default_shell"],
      role_default: true,
    },
  ].map((item) => deriveBuiltinTemplateMount(item));
}

export function buildCustomWorkerTemplateRegistry(params?: {
  taskMeta?: Record<string, unknown>;
  registrations?: unknown;
}): WorkerTemplateSpec[] {
  const coarseRoleRegistry = buildCoarseTemplateRoleRegistry({ taskMeta: params?.taskMeta });
  const workerRuntime = extractObject(params?.taskMeta?.worker_runtime);
  const registrations = Array.isArray(params?.registrations)
    ? params?.registrations
    : Array.isArray(workerRuntime.custom_template_registrations)
      ? workerRuntime.custom_template_registrations
      : [];
  const normalized = registrations
    .map((item) => normalizeCustomTemplateRegistration(item))
    .filter(
      (item): item is CustomTemplateRegistrationContract =>
        Boolean(
          item &&
            item.enabled &&
            isCoarseTemplateRoleEnabled(coarseRoleRegistry, item.coarse_template_role) &&
            findCoarseTemplateRoleEntry(coarseRoleRegistry, item.coarse_template_role)?.domain_group === item.mount_tree,
        ),
    );
  return normalized.map((item) => ({
    template_id: item.template_id,
    template_origin: item.template_origin,
    template_source_id: item.template_source_id,
    template_version: item.template_version,
    registration_source: item.registration_source,
    handler_script: item.handler_script,
    supported_role_types: item.supported_role_types,
    artifact_layer: item.artifact_layer,
    coarse_template_role: item.coarse_template_role,
    role_layer: item.role_layer,
    tech_layer: item.tech_layer,
    framework_layer: item.framework_layer,
    mount_tree: item.mount_tree,
    mount_path: item.mount_path,
    supported_component_candidates: item.supported_component_candidates,
    goal_matchers: item.goal_matchers,
    delivery_mode: item.delivery_mode,
    template_kind: item.template_kind,
    default_message_type: "partial_deliverable",
    overlay_capabilities: item.overlay_capabilities,
    allowed_runtime_classes: item.allowed_runtime_classes,
    role_default: item.role_default,
  }));
}

export function buildWorkerTemplateRegistry(params?: {
  taskMeta?: Record<string, unknown>;
  registrations?: unknown;
}): WorkerTemplateSpec[] {
  return [
    ...buildCustomWorkerTemplateRegistry(params),
    ...buildWorkerBaseTemplateRegistry(),
    ...buildWorkerArtifactTemplateRegistry(),
    ...buildWorkerRoleTemplateRegistry(),
    ...buildWorkerExecutableTemplateRegistry(),
  ];
}

export function matchWorkerTemplate(params: {
  selector: WorkerTemplateSelectorInput;
  taskMeta?: Record<string, unknown>;
  registry?: WorkerTemplateSpec[];
}): WorkerTemplateSpec | null {
  const coarseRoleRegistry = buildCoarseTemplateRoleRegistry({ taskMeta: params.taskMeta });
  const coarseTemplateRole = normalizeCoarseTemplateRoleId(
    params.selector.implementation_topology.coarse_template_role || params.selector.implementation_topology.role_layer,
    params.selector.implementation_topology.role_layer,
  );
  if (!isCoarseTemplateRoleEnabled(coarseRoleRegistry, coarseTemplateRole)) {
    return null;
  }
  const registry = (params.registry ?? buildWorkerTemplateRegistry({ taskMeta: params.taskMeta })).filter(
    (template) =>
      (template.template_kind === "concrete" || template.template_kind === "placeholder") &&
      templateMatchesMountedRole(template, coarseTemplateRole) &&
      isCoarseTemplateRoleEnabled(coarseRoleRegistry, template.coarse_template_role),
  );
  const componentSet = new Set(params.selector.component_candidates.map((item) => normalizeString(item).toLowerCase()));
  const goal = normalizeString(params.selector.goal).toLowerCase();
  const preferred = new Set(params.selector.preferred_template_ids.map((item) => normalizeString(item)));
  const topology = params.selector.implementation_topology;
  const byId = registry.filter((template) => preferred.has(template.template_id));
  if (byId.length > 0) {
    return byId[0] ?? null;
  }
  const topologyMatch = registry.find(
    (template) =>
      template.artifact_layer === topology.artifact_layer &&
      template.coarse_template_role === coarseTemplateRole &&
      template.role_layer === topology.role_layer &&
      template.tech_layer === topology.tech_layer &&
      template.framework_layer === topology.framework_layer &&
      template.supported_role_types.includes(params.selector.role_type),
  );
  if (topologyMatch) {
    return topologyMatch;
  }
  const componentMatch = registry.find((template) =>
    template.supported_role_types.includes(params.selector.role_type) &&
    template.supported_component_candidates.some((candidate) => componentSet.has(candidate.toLowerCase())),
  );
  if (componentMatch) {
    return componentMatch;
  }
  const goalMatch =
    registry.find((template) =>
      template.goal_matchers.length > 0 &&
      template.goal_matchers.every((matcher) => goal.includes(matcher.toLowerCase())),
    ) ?? null;
  if (goalMatch) {
    return goalMatch;
  }
  const roleMatch = registry.find(
    (template) =>
      template.role_default &&
      template.supported_role_types.includes(params.selector.role_type),
  );
  if (roleMatch) {
    return roleMatch;
  }
  if (topology.artifact_layer === "document_reserved") {
    return registry.find((template) => template.template_id === "document_reserved_placeholder") ?? null;
  }
  if (topology.artifact_layer === "image_reserved") {
    return registry.find((template) => template.template_id === "image_reserved_placeholder") ?? null;
  }
  if (params.selector.role_type === "tester-ephemeral") {
    return registry.find((template) => template.template_id === "tester_placeholder") ?? null;
  }
  return registry.find((template) => template.template_id === "code_generic_placeholder") ?? null;
}

export function resolveWorkerSelectedTemplate(params: {
  selector: WorkerTemplateSelectorInput;
  taskMeta?: Record<string, unknown>;
  collaboration?: Pick<WorkerCollaborationContract, "default_target_role_types">;
  registry?: WorkerTemplateSpec[];
}): WorkerSelectedTemplateSummary {
  const template = matchWorkerTemplate({
    selector: params.selector,
    taskMeta: params.taskMeta,
    registry: params.registry,
  });
  const defaultTargetRoleTypes =
    params.collaboration?.default_target_role_types?.filter(Boolean) ?? [];
  if (!template) {
    return {
      template_id: "",
      template_origin: "builtin",
      template_source_id: "",
      template_version: "",
      registration_source: "",
      handler_script: "",
      delivery_mode: "unsupported_placeholder",
      template_kind: "placeholder",
      default_message_type: "partial_deliverable",
      default_target_role_types: defaultTargetRoleTypes,
    };
  }
  return {
    template_id: template.template_id,
    template_origin: template.template_origin,
    template_source_id: template.template_source_id,
    template_version: template.template_version,
    registration_source: template.registration_source,
    handler_script: template.handler_script,
    delivery_mode: template.delivery_mode,
    template_kind: template.template_kind,
    default_message_type: template.default_message_type,
    default_target_role_types: defaultTargetRoleTypes,
  };
}

export function buildWorkerTemplateSelectorInput(params: {
  semantic: WorkerSemanticContract;
  dispatch: WorkerDispatchContract;
  semanticTopology: WorkerSemanticTopology;
  implementationTopology: WorkerImplementationTopology;
  taskMeta?: Record<string, unknown>;
}): WorkerTemplateSelectorInput {
  const registry = buildWorkerTemplateRegistry({ taskMeta: params.taskMeta });
  const coarseTemplateRole =
    params.implementationTopology.coarse_template_role ?? params.implementationTopology.role_layer;
  const preferredTemplateIds = registry
    .filter((template) =>
        (template.template_kind === "concrete" || template.template_kind === "placeholder") &&
        templateMatchesMountedRole(template, coarseTemplateRole) &&
        (
          (
            template.artifact_layer === params.implementationTopology.artifact_layer &&
            template.coarse_template_role === coarseTemplateRole &&
            template.role_layer === params.implementationTopology.role_layer &&
            template.tech_layer === params.implementationTopology.tech_layer &&
            template.framework_layer === params.implementationTopology.framework_layer
        ) ||
        template.supported_component_candidates.some((candidate) =>
          params.semantic.component_candidates.includes(candidate),
        )
      ),
    )
    .map((template) => template.template_id);
  return {
    schema_version: "worker-template-selector-v1",
    role_type: params.dispatch.role_type,
    semantic_topology: params.semanticTopology,
    implementation_topology: params.implementationTopology,
    component_candidates: params.semantic.component_candidates,
    goal: params.semantic.goal,
    preferred_template_ids: preferredTemplateIds,
  };
}

export function buildWorkerSemanticContract(params: {
  taskMeta: Record<string, unknown>;
  splitPlan?: Record<string, unknown> | null;
}): WorkerSemanticContract {
  const planningDecision = extractObject(params.taskMeta.planning_decision);
  const workerRefinement = extractObject(planningDecision.worker_refinement);
  const splitPlan = extractObject(params.splitPlan);
  const refinementPartition = extractObject(splitPlan.refinement_partition);
  const dependencySummary = extractObject(refinementPartition.dependency_summary);
  const componentCandidatesSource = Array.isArray(refinementPartition.component_candidates)
    ? refinementPartition.component_candidates
    : Array.isArray(workerRefinement.component_candidates)
      ? workerRefinement.component_candidates
      : [];
  const componentCandidates = componentCandidatesSource
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  const projectId = normalizeString(params.taskMeta.project_id, "prj_default");
  const workspaceRoot = normalizeString(params.taskMeta.workspace_root);

  return {
    schema_version: "worker-semantic-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    goal: normalizeString(params.taskMeta.goal),
    project_id: projectId,
    workspace_root: workspaceRoot,
    refinement_route_ref: deriveRefinementRouteRef(params),
    component_candidates: componentCandidates,
    refinement_scope: normalizeString(workerRefinement.refinement_scope, "single_meta_input"),
    refinement_strategy: normalizeString(
      workerRefinement.refinement_strategy,
      "linear_split_units_placeholder",
    ),
    refinement_principle: normalizeString(
      workerRefinement.primary_principle,
      "engineering_decoupling",
    ),
    dependency_hint_summary: {
      mode: normalizeString(dependencySummary.mode, "component_semantic_linearized"),
      roots: normalizePositiveInt(dependencySummary.roots, 0),
      blocked: normalizePositiveInt(dependencySummary.blocked, 0),
      links: normalizePositiveInt(dependencySummary.links, 0),
      cross_module_links: normalizePositiveInt(dependencySummary.cross_module_links, 0),
    },
    cluster_derivation_inputs: {
      project_id: projectId,
      workspace_root: workspaceRoot,
      component_candidates: componentCandidates,
    },
    transaction_layer: normalizeTransactionLayer(taskMetaOrPlanning(params.taskMeta, "worker_runtime.transaction_layer", "update")),
    action_layer: normalizeActionLayer(taskMetaOrPlanning(params.taskMeta, "worker_runtime.action_layer", "implement")),
  };
}

export function buildWorkerBudgetContract(taskMeta: Record<string, unknown>): WorkerBudgetContract {
  const budget = extractObject(taskMeta.budget);
  const consumption = extractObject(taskMeta.consumption);
  const scheduler = extractObject(taskMeta.scheduler);
  const degrade = extractObject(scheduler.degrade);
  const maxTokenCost = normalizePositiveInt(budget.max_token_cost, 50000);
  const runtimeTokenCap = Math.max(0, normalizePositiveInt(degrade.current_token_budget_cap, 0));
  const effectiveMaxTokenCost =
    runtimeTokenCap > 0 ? Math.min(maxTokenCost, runtimeTokenCap) : maxTokenCost;
  const tokenCostUsed = Math.max(0, normalizePositiveInt(consumption.token_cost_used, 0));
  const fastTokenBudget = effectiveMaxTokenCost;
  const degradedTokenBudget = Math.max(fastTokenBudget + 1, Math.floor(effectiveMaxTokenCost * 1.5));
  const reclaimThreshold = Math.max(degradedTokenBudget, Math.floor(maxTokenCost * 2));
  let budgetLane: WorkerBudgetLaneType = "fast";
  if (tokenCostUsed >= reclaimThreshold) {
    budgetLane = "reclaim_pending";
  } else if (tokenCostUsed >= fastTokenBudget) {
    budgetLane = "degraded";
  }

  return {
    schema_version: "worker-budget-contract-v1",
    task_id: normalizeString(taskMeta.id, "task_unknown"),
    max_token_cost: maxTokenCost,
    token_cost_used: tokenCostUsed,
    fast_token_budget: fastTokenBudget,
    degraded_token_budget: degradedTokenBudget,
    reclaim_threshold: reclaimThreshold,
    budget_lane: budgetLane,
  };
}

export function buildWorkerDispatchContract(params: {
  taskMeta: Record<string, unknown>;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry" | "recovery";
  mode: "local_threads" | "container" | "distributed";
  operation_id: string;
  dispatch_seq: number;
  budget_lane: WorkerBudgetLaneType;
}): WorkerDispatchContract {
  const scheduler = extractObject(params.taskMeta.scheduler);
  const rawRole = normalizeString(scheduler.agent_type, "unknown");
  const roleType: WorkerDispatchContract["role_type"] =
    rawRole === "worker-delivery" ||
    rawRole === "tester-ephemeral" ||
    rawRole === "audit-guard"
      ? rawRole
      : "unknown";
  return {
    schema_version: "worker-dispatch-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    action: params.action,
    lane: params.lane,
    mode: params.mode,
    role_type: roleType,
    operation_id: params.operation_id,
    dispatch_seq: Math.max(1, normalizePositiveInt(params.dispatch_seq, 1)),
    retry_count: Math.max(0, normalizePositiveInt(scheduler.retry_count, 0)),
    queue_priority: Math.max(0, normalizePositiveInt(scheduler.queue_priority, 0)),
    budget_lane: params.budget_lane,
    execution_target: buildWorkerMilestoneSet({
      taskMeta: params.taskMeta,
      scheduler,
      dispatchSeq: params.dispatch_seq,
    }),
    history_handoff: {
      failure_pattern_summary: buildWorkerFailurePatternSummary({
        taskMeta: params.taskMeta,
      }),
      failure_pattern_index_refs: buildWorkerFailurePatternIndexRefs(params.taskMeta),
    },
  };
}

function buildWorkerMilestoneSet(params: {
  taskMeta: Record<string, unknown>;
  scheduler: Record<string, unknown>;
  dispatchSeq: number;
}): WorkerDispatchContract["execution_target"] {
  const taskId = normalizeString(params.taskMeta.id, "task_unknown");
  const workerStage = extractObject(params.taskMeta.worker_stage);
  const workerExecution = extractObject(params.scheduler.worker_execution);
  const rawMilestoneSet = extractObject(workerExecution.milestone_set);
  const milestones = Array.isArray(workerExecution.milestones)
    ? workerExecution.milestones.map((item) => normalizeString(item)).filter(Boolean)
    : Array.isArray(rawMilestoneSet.milestones)
      ? (rawMilestoneSet.milestones as unknown[])
          .map((item) => extractObject(item))
          .map((item, index) => normalizeString(item.milestone_id || item.title, `milestone_${index + 1}`))
          .filter(Boolean)
      : [];
  const completedTargets = Array.isArray(workerExecution.completed_targets)
    ? workerExecution.completed_targets.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  const explicitCompletedCountRaw = Number(workerExecution.milestone_complete_count);
  const explicitCompletedCount =
    Number.isFinite(explicitCompletedCountRaw) && explicitCompletedCountRaw >= 0
      ? Math.floor(explicitCompletedCountRaw)
      : -1;
  const evaluationWindowSeconds = Math.max(
    1,
    normalizePositiveInt(workerExecution.detection_window_seconds || rawMilestoneSet.evaluation_window_seconds, 300),
  );
  const lastProgressAt = normalizeString(
    extractObject(rawMilestoneSet.summary).last_progress_at || workerExecution.last_progress_at,
  );
  const normalizedMilestones = Array.isArray(rawMilestoneSet.milestones)
    ? (rawMilestoneSet.milestones as unknown[])
        .map((entry, index) =>
          normalizeWorkerMilestoneEntry({
            value: entry,
            fallbackId: milestones[index] || `milestone_${index + 1}`,
            completedTargets,
            evaluationWindowSeconds,
          }),
        )
        .filter((entry) => entry.milestone_id.length > 0)
    : milestones.map((milestoneId) =>
        normalizeWorkerMilestoneEntry({
          value: {
            milestone_id: milestoneId,
            title: milestoneId,
          },
          fallbackId: milestoneId,
          completedTargets,
          evaluationWindowSeconds,
        }),
      );
  const effectiveMilestones =
    normalizedMilestones.length > 0
      ? normalizedMilestones
      : [
          normalizeWorkerMilestoneEntry({
            value: { milestone_id: "task_complete", title: "task_complete" },
            fallbackId: "task_complete",
            completedTargets,
            evaluationWindowSeconds,
          }),
        ];
  const requiredMilestones = effectiveMilestones.filter((entry) => entry.required);
  const satisfiedMilestones = effectiveMilestones.filter((entry) => entry.status === "satisfied");
  const requiredSatisfiedMilestones = requiredMilestones.filter((entry) => entry.status === "satisfied");
  const satisfiedCount =
    explicitCompletedCount >= 0
      ? Math.min(effectiveMilestones.length, explicitCompletedCount)
      : satisfiedMilestones.length;
  const requiredSatisfiedCount =
    explicitCompletedCount >= 0
      ? Math.min(requiredMilestones.length, explicitCompletedCount)
      : requiredSatisfiedMilestones.length;
  const allMilestonesMet =
    workerExecution.all_milestones_met === true ||
    (requiredMilestones.length > 0 && requiredSatisfiedCount >= requiredMilestones.length);
  const workerInstanceId = normalizeString(workerStage.worker_stage_id, `${taskId}_worker_${params.dispatchSeq}`);
  return {
    schema_version: "worker-milestone-set-v1",
    set_id: normalizeString(rawMilestoneSet.set_id, `milestone_set_${taskId}_${params.dispatchSeq}`),
    task_id: taskId,
    worker_instance_id: workerInstanceId,
    generated_at: normalizeString(rawMilestoneSet.generated_at, new Date().toISOString()),
    source: "scheduler",
    evaluation_window_seconds: evaluationWindowSeconds,
    milestones: effectiveMilestones,
    summary: {
      total_count: effectiveMilestones.length,
      required_count: requiredMilestones.length,
      satisfied_count: satisfiedCount,
      required_satisfied_count: requiredSatisfiedCount,
      blocking_pending_count: effectiveMilestones.filter(
        (entry) => entry.level === "blocking" && entry.status !== "satisfied",
      ).length,
      core_pending_count: effectiveMilestones.filter(
        (entry) => entry.level === "core" && entry.status !== "satisfied",
      ).length,
      all_required_met: allMilestonesMet,
      last_progress_at: lastProgressAt,
    },
  };
}

function normalizeWorkerMilestoneEntry(input: {
  value: unknown;
  fallbackId: string;
  completedTargets: string[];
  evaluationWindowSeconds: number;
}): WorkerMilestoneV1 {
  const raw = extractObject(input.value);
  const milestoneId = normalizeString(raw.milestone_id || raw.id, input.fallbackId);
  const title = normalizeString(raw.title, milestoneId);
  const level = normalizeWorkerMilestoneLevel(raw.level);
  const required =
    raw.required === true ||
    (raw.required !== false && (level === "blocking" || level === "core"));
  const completed = input.completedTargets.includes(milestoneId);
  return {
    milestone_id: milestoneId,
    title,
    level,
    required,
    status: normalizeWorkerMilestoneStatus(raw.status, completed),
    progress_signal: normalizeString(raw.progress_signal, "stage_write_activity"),
    completion_evidence: {
      paths: Array.isArray(extractObject(raw.completion_evidence).paths)
        ? (extractObject(raw.completion_evidence).paths as unknown[])
            .map((item) => normalizeString(item))
            .filter(Boolean)
        : [],
      markers: Array.isArray(extractObject(raw.completion_evidence).markers)
        ? (extractObject(raw.completion_evidence).markers as unknown[])
            .map((item) => normalizeString(item))
            .filter(Boolean)
        : [],
      counts: normalizeNumberRecord(extractObject(raw.completion_evidence).counts),
    },
    window_seconds: Math.max(1, normalizePositiveInt(raw.window_seconds, input.evaluationWindowSeconds)),
  };
}

function normalizeWorkerMilestoneLevel(value: unknown): WorkerMilestoneLevel {
  const raw = normalizeString(value);
  return raw === "blocking" || raw === "stretch" ? raw : "core";
}

function normalizeWorkerMilestoneStatus(
  value: unknown,
  completed: boolean,
): WorkerMilestoneStatus {
  const raw = normalizeString(value);
  if (completed) {
    return "satisfied";
  }
  if (raw === "in_progress" || raw === "satisfied" || raw === "missed") {
    return raw;
  }
  return "pending";
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const raw = extractObject(value);
  return Object.entries(raw).reduce<Record<string, number>>((acc, [key, entry]) => {
    const normalized = normalizePositiveInt(entry, -1);
    if (normalized >= 0) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}

function deriveRefinementRouteRef(params: {
  taskMeta: Record<string, unknown>;
  splitPlan?: Record<string, unknown> | null;
}): WorkerSemanticContract["refinement_route_ref"] {
  const taskId = normalizeString(params.taskMeta.id, "task_unknown");
  const splitPlan = extractObject(params.splitPlan);
  const refinementPartition = extractObject(splitPlan.refinement_partition);
  const leafUnits = Array.isArray(refinementPartition.leaf_units)
    ? (refinementPartition.leaf_units as unknown[]).map((entry) => extractObject(entry))
    : [];
  const matchedLeaf =
    leafUnits.find((leaf) => normalizeString(leaf.worker_task_id) === taskId) ??
    leafUnits.find((leaf) => normalizeString(leaf.child_task_id) === taskId) ??
    null;
  return {
    module_id: matchedLeaf ? normalizeString(matchedLeaf.module_id) : "",
    refinement_task_id: taskId,
  };
}

export function buildWorkerFailurePatternSummary(params: {
  taskMeta: Record<string, unknown>;
}): WorkerFailurePatternSummaryV1 {
  const scheduler = extractObject(params.taskMeta.scheduler);
  const workerStage = extractObject(params.taskMeta.worker_stage);
  const workerHandoff = extractObject(scheduler.worker_handoff);
  const rawSummary = extractObject(workerHandoff.failure_pattern_summary);
  const rawPatterns = Array.isArray(rawSummary.patterns) ? (rawSummary.patterns as unknown[]) : [];
  const patterns = rawPatterns.map((entry, index) => normalizeWorkerFailurePattern(entry, index)).filter(Boolean) as WorkerFailurePatternSummaryV1["patterns"];
  return {
    schema_version: "worker-failure-pattern-summary-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    worker_instance_id: normalizeString(
      workerStage.worker_stage_id,
      `${normalizeString(params.taskMeta.id, "task_unknown")}_worker`,
    ),
    summary: {
      pattern_count: patterns.length,
      top_risk_note: normalizeString(rawSummary.top_risk_note || scheduler.history_reload_hint),
    },
    patterns,
    read_contract: {
      mode: "bounded_guidance",
      agent_may_quote_raw_index: false,
      agent_may_request_additional_history: false,
      agent_must_treat_patterns_as_execution_constraints: true,
      agent_must_not_reinterpret_budget_policy: true,
    },
  };
}

function normalizeWorkerFailurePattern(
  value: unknown,
  index: number,
): WorkerFailurePatternSummaryV1["patterns"][number] | null {
  const raw = extractObject(value);
  const patternId = normalizeString(raw.pattern_id || raw.label, `pattern_${index + 1}`);
  if (!patternId) {
    return null;
  }
  const scopeRaw = normalizeString(raw.scope);
  const severityRaw = normalizeString(raw.severity);
  return {
    pattern_id: patternId,
    label: normalizeString(raw.label, patternId),
    scope:
      scopeRaw === "instance" || scopeRaw === "cluster"
        ? scopeRaw
        : "task",
    severity:
      severityRaw === "low" ||
      severityRaw === "medium" ||
      severityRaw === "critical"
        ? severityRaw
        : "high",
    trigger_signals: normalizeStringArray(raw.trigger_signals),
    avoid_rules: normalizeStringArray(raw.avoid_rules),
    preferred_response: normalizeStringArray(raw.preferred_response),
    related_milestones: normalizeStringArray(raw.related_milestones),
  };
}

function buildWorkerFailurePatternIndexRefs(taskMeta: Record<string, unknown>): string[] {
  const scheduler = extractObject(taskMeta.scheduler);
  const workerHandoff = extractObject(scheduler.worker_handoff);
  const explicit = normalizeStringArray(workerHandoff.failure_pattern_index_refs);
  if (explicit.length > 0) {
    return explicit.slice(0, 5);
  }
  const knowledgeRefs = Array.isArray(taskMeta.knowledge_refs)
    ? (taskMeta.knowledge_refs as unknown[]).map((item) => normalizeString(item)).filter(Boolean)
    : [];
  return knowledgeRefs.slice(0, 5);
}

export function buildSchedulerKeeperAssemblyQuery(params: {
  taskMeta: Record<string, unknown>;
  dispatch: WorkerDispatchContract;
  semantic: WorkerSemanticContract;
  now?: string;
}): SchedulerKeeperAssemblyQueryV1 {
  const scheduler = extractObject(params.taskMeta.scheduler);
  return {
    schema_version: "scheduler-keeper-assembly-query-v1",
    requested_at: params.now ?? new Date().toISOString(),
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    worker_instance_id: params.dispatch.execution_target.worker_instance_id,
    dispatch_lane: params.dispatch.lane,
    dispatch_mode: params.dispatch.mode,
    refinement_scope: params.semantic.refinement_scope,
    history_reload_hint: normalizeString(scheduler.history_reload_hint),
    knowledge_refs: Array.isArray(params.taskMeta.knowledge_refs)
      ? (params.taskMeta.knowledge_refs as unknown[]).map((item) => normalizeString(item)).filter(Boolean)
      : [],
    milestone_ids: params.dispatch.execution_target.milestones.map((entry) => entry.milestone_id),
  };
}

export function buildWorkerConvergenceContract(taskMeta: Record<string, unknown>): WorkerConvergenceContract {
  const root = extractObject(taskMeta.worker_convergence);
  return {
    schema_version: "worker-convergence-contract-v1",
    task_id: normalizeString(taskMeta.id, "task_unknown"),
    convergence_class: normalizeConvergenceClass(root.convergence_class),
    convergence_confidence: normalizeRatio(root.convergence_confidence, 0),
    progress_delta: Math.max(0, normalizePositiveInt(root.progress_delta, 0)),
    remaining_work_estimate: normalizeString(root.remaining_work_estimate),
    reclaim_reason: normalizeReclaimReason(root.reclaim_reason),
    reported_at: normalizeString(root.reported_at),
  };
}

export function buildWorkerCollaborationContract(params: {
  taskMeta: Record<string, unknown>;
  semantic: WorkerSemanticContract;
  taskDir: string;
  dispatch: WorkerDispatchContract;
  implementationTopology: WorkerImplementationTopology;
  clusterProjection: WorkerClusterProjection;
}): WorkerCollaborationContract {
  const existing = extractObject(params.taskMeta.task_cluster);
  const memberships = deriveTaskClusterMemberships(params);
  const workspaceRoot = path.join(params.taskDir, "task_cluster_workspace");
  const overlayTargets = Array.isArray(
    params.implementationTopology.custom_overlay_layer.config.default_target_role_types,
  )
    ? (params.implementationTopology.custom_overlay_layer.config.default_target_role_types as unknown[])
        .map((item) => normalizeString(item))
        .filter(Boolean)
    : [];
  const roleAwareDefaults =
    params.implementationTopology.role_layer === "data"
      ? ["worker-delivery"]
      : params.implementationTopology.role_layer === "infra" ||
          params.implementationTopology.role_layer === "script_automation"
        ? ["tester-ephemeral", "audit-guard"]
        : params.dispatch.role_type === "worker-delivery"
          ? ["tester-ephemeral"]
          : [];
  return {
    schema_version: "worker-collaboration-contract-v1",
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    cluster_id: deriveTaskClusterId({
      semantic: params.semantic,
      dispatch: params.dispatch,
      implementation: params.implementationTopology,
    }),
    memberships,
    cluster_root: workspaceRoot,
    workspace_root: workspaceRoot,
    mailbox_path: path.join(workspaceRoot, "mailbox.ndjson"),
    archive_path: path.join(workspaceRoot, "mailbox.archive.ndjson"),
    message_type_allowlist: [...TASK_CLUSTER_MESSAGE_TYPES],
    default_target_role_types: overlayTargets.length > 0 ? overlayTargets : roleAwareDefaults,
    mailbox_counters: normalizeMailboxCounters(existing.mailbox_counters),
  };
}

export function buildWorkerRuntimeView(params: {
  taskMeta: Record<string, unknown>;
  splitPlan?: Record<string, unknown> | null;
  taskDir: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry" | "recovery";
  mode: "local_threads" | "container" | "distributed";
  operation_id: string;
  dispatch_seq: number;
  now?: string;
}): WorkerRuntimeView {
  const semantic = buildWorkerSemanticContract({
    taskMeta: params.taskMeta,
    splitPlan: params.splitPlan,
  });
  const budget = buildWorkerBudgetContract(params.taskMeta);
  const dispatch = buildWorkerDispatchContract({
    taskMeta: params.taskMeta,
    action: params.action,
    lane: params.lane,
    mode: params.mode,
    operation_id: params.operation_id,
    dispatch_seq: params.dispatch_seq,
    budget_lane: budget.budget_lane,
  });
  const convergence = buildWorkerConvergenceContract(params.taskMeta);
  const semanticTopology = buildWorkerSemanticTopology({
    semantic,
    budget,
    convergence,
  });
  const implementationTopology = buildWorkerImplementationTopology({
    semantic,
    taskMeta: params.taskMeta,
  });
  const clusterProjection = buildWorkerClusterProjection({
    semantic: semanticTopology,
    implementation: implementationTopology,
  });
  const workerStage = buildWorkerStageContract({
    taskDir: params.taskDir,
    taskMeta: params.taskMeta,
    dispatch,
    implementationTopology,
  });
  const collaboration = buildWorkerCollaborationContract({
    taskMeta: params.taskMeta,
    semantic,
    taskDir: params.taskDir,
    dispatch,
    implementationTopology,
    clusterProjection,
  });
  const templateSelector = buildWorkerTemplateSelectorInput({
    semantic,
    dispatch,
    semanticTopology,
    implementationTopology,
    taskMeta: params.taskMeta,
  });
  const selectedTemplate = resolveWorkerSelectedTemplate({
    selector: templateSelector,
    taskMeta: params.taskMeta,
    collaboration,
  });
  const lifecycleGovernance = buildWorkerLifecycleGovernanceContract({
    taskMeta: params.taskMeta,
    budget,
    dispatch,
    implementationTopology,
    workerStage,
    collaboration,
    selectedTemplate,
  });
  return {
    schema_version: "worker-runtime-view-v1",
    assembled_at: params.now ?? new Date().toISOString(),
    task_id: normalizeString(params.taskMeta.id, "task_unknown"),
    goal: semantic.goal,
    workspace_root: semantic.workspace_root,
    run_root: normalizeString(params.taskMeta.run_root),
    work_domain_id: normalizeString(params.taskMeta.work_domain_id),
    semantic,
    dispatch,
    budget,
    convergence,
    semantic_topology: semanticTopology,
    implementation_topology: implementationTopology,
    cluster_projection: clusterProjection,
    worker_stage: workerStage,
    collaboration,
    lifecycle_governance: lifecycleGovernance,
    template_selector: templateSelector,
    selected_template: selectedTemplate,
  };
}

export function buildWorkerRuntimeMetaSummary(
  view: WorkerRuntimeView,
  taskMeta?: Record<string, unknown>,
): {
  worker_runtime: Record<string, unknown>;
  worker_stage: Record<string, unknown>;
  worker_budget: Record<string, unknown>;
  worker_convergence: Record<string, unknown>;
  task_cluster: Record<string, unknown>;
  runtime_worker_control: Record<string, unknown>;
  keeper_feedback: Record<string, unknown>;
} {
  const runtimeControl = buildWorkerRuntimeControlSummary({
    previous: extractObject(taskMeta?.runtime_worker_control),
    budgetLane: view.budget.budget_lane,
    now: view.assembled_at,
  });
  const existingWorkerRuntime = extractObject(taskMeta?.worker_runtime);
  const existingWorkerStage = extractObject(taskMeta?.worker_stage);
  const existingWorkerStageAllocation = extractObject(existingWorkerStage.allocation);
  const existingWorkerStageRetention = extractObject(existingWorkerStage.retention);
  const existingCustomTemplateRegistrations = Array.isArray(existingWorkerRuntime.custom_template_registrations)
    ? existingWorkerRuntime.custom_template_registrations
    : [];
  return {
    worker_runtime: {
      schema_version: view.schema_version,
      assembled_at: view.assembled_at,
      role_type: view.dispatch.role_type,
      dispatch_action: view.dispatch.action,
      lane: view.dispatch.lane,
      mode: view.dispatch.mode,
      refinement_scope: view.semantic.refinement_scope,
      runtime_view_path: "worker_runtime_view.json",
      cluster_id: view.collaboration.cluster_id,
      semantic_topology: view.semantic_topology,
      implementation_topology: view.implementation_topology,
      cluster_projection: view.cluster_projection,
      selected_template_id: view.selected_template.template_id,
      selected_template_origin: view.selected_template.template_origin,
      selected_template_source_id: view.selected_template.template_source_id,
      template_version: view.selected_template.template_version,
      registration_source: view.selected_template.registration_source,
      delivery_mode: view.selected_template.delivery_mode,
      template_kind: view.selected_template.template_kind,
      default_message_type: view.lifecycle_governance.mailbox_governance.default_message_type,
      default_target_role_types: view.lifecycle_governance.mailbox_governance.default_target_role_types,
      governance_policy_id: view.lifecycle_governance.policy_id,
      refinement_route_ref: view.semantic.refinement_route_ref,
      milestone_set: view.dispatch.execution_target,
      milestone_targets: view.dispatch.execution_target.milestones.map((entry) => entry.milestone_id),
      milestone_completed_targets: [],
      milestone_progress_signal: {
        schema_version: "worker-milestone-progress-signal-v1",
        completed_count: view.dispatch.execution_target.summary.satisfied_count,
        total_count: view.dispatch.execution_target.summary.total_count,
        reported_at:
          view.dispatch.execution_target.summary.last_progress_at || view.assembled_at,
      },
      ...(view.dispatch.execution_target.summary.all_required_met
        ? {
            milestone_completion_signal: {
              schema_version: "worker-milestone-completion-signal-v1",
              all_required_met: true,
              reported_at:
                view.dispatch.execution_target.summary.last_progress_at || view.assembled_at,
            },
          }
        : {}),
      milestone_detection_window_seconds: view.dispatch.execution_target.evaluation_window_seconds,
      stage_write_stagnation_seconds: Math.max(
        1,
        ...view.dispatch.execution_target.milestones.map((entry) => entry.window_seconds),
      ),
      all_milestones_met: view.dispatch.execution_target.summary.all_required_met,
      keeper_query_path: "scheduler_keeper_assembly_query.json",
      failure_pattern_summary_path: "worker_failure_pattern_summary.json",
      failure_pattern_index_refs: view.dispatch.history_handoff.failure_pattern_index_refs,
      failure_pattern_read_contract: view.dispatch.history_handoff.failure_pattern_summary.read_contract,
      result_contract_version: view.lifecycle_governance.result_governance.required_result_contract_version,
      allowed_template_origins: view.lifecycle_governance.template_governance.allowed_template_origins,
      custom_registration_required: view.lifecycle_governance.template_governance.require_enabled_custom_registration,
      custom_runtime_gate_status: view.lifecycle_governance.template_governance.selected_custom_runtime_gate_status,
      custom_capability_gate_reason: view.lifecycle_governance.template_governance.selected_custom_capability_gate_reason,
      agent_dispatch_capability: {
        schema_version: "scheduler-agent-dispatch-capability-v1",
        allowed_agent_types: [view.dispatch.role_type],
        default_target_role_types: view.lifecycle_governance.mailbox_governance.default_target_role_types,
        selected_template_id: view.selected_template.template_id,
        selected_template_origin: view.selected_template.template_origin,
        custom_runtime_gate_status: view.lifecycle_governance.template_governance.selected_custom_runtime_gate_status,
        custom_capability_gate_reason:
          view.lifecycle_governance.template_governance.selected_custom_capability_gate_reason,
        skill_gate_status:
          view.lifecycle_governance.template_governance.selected_custom_runtime_gate_status === "blocked"
            ? "blocked"
            : "allowed",
        skill_gate_reason:
          view.lifecycle_governance.template_governance.selected_custom_runtime_gate_status === "blocked"
            ? view.lifecycle_governance.template_governance.selected_custom_capability_gate_reason ||
              "custom_runtime_gate_blocked"
            : "",
        dispatch_capability_class:
          view.dispatch.role_type === "tester-ephemeral"
            ? "tester_targeted"
            : view.dispatch.role_type === "audit-guard"
              ? "audit_targeted"
              : "general",
      } satisfies SchedulerDispatchCapabilitySummary,
      cluster_root: view.collaboration.cluster_root,
      custom_template_registrations: existingCustomTemplateRegistrations,
    },
    worker_stage: {
      schema_version: view.worker_stage.schema_version,
      worker_stage_id: view.worker_stage.worker_stage_id,
      worker_stage_root: view.worker_stage.worker_stage_root,
      worker_stage_profile: view.worker_stage.worker_stage_profile,
      stage_isolation_mode: view.worker_stage.stage_isolation_mode,
      stage_runtime_class: view.worker_stage.stage_runtime_class,
      allowed_execution_mode: view.worker_stage.allowed_execution_mode,
      scratch_root: view.worker_stage.scratch_root,
      delivery_root: view.worker_stage.delivery_root,
      inputs_root: view.worker_stage.inputs_root,
      runtime_root: view.worker_stage.runtime_root,
      mount_policy: view.worker_stage.mount_policy,
      allocation: {
        ...view.worker_stage.allocation,
        worker_stage_bytes_used: normalizePositiveInt(existingWorkerStageAllocation.worker_stage_bytes_used, 0),
        worker_stage_file_count: normalizePositiveInt(existingWorkerStageAllocation.worker_stage_file_count, 0),
        worker_stage_overflow_status: normalizeString(existingWorkerStageAllocation.worker_stage_overflow_status),
      },
      retention: {
        ...view.worker_stage.retention,
        worker_stage_exported_artifact_count: normalizePositiveInt(
          existingWorkerStageRetention.worker_stage_exported_artifact_count,
          0,
        ),
        worker_stage_last_export_status: normalizeString(existingWorkerStageRetention.worker_stage_last_export_status),
        worker_stage_last_export_manifest_class: normalizeString(
          existingWorkerStageRetention.worker_stage_last_export_manifest_class,
        ),
        worker_stage_last_fault_class: normalizeString(existingWorkerStageRetention.worker_stage_last_fault_class),
        worker_stage_retention_result: extractObject(existingWorkerStageRetention.worker_stage_retention_result),
        worker_stage_last_cleanup_at: normalizeString(existingWorkerStageRetention.worker_stage_last_cleanup_at),
        worker_stage_last_retained_artifact_ids: Array.isArray(
          existingWorkerStageRetention.worker_stage_last_retained_artifact_ids,
        )
          ? existingWorkerStageRetention.worker_stage_last_retained_artifact_ids
          : [],
        worker_stage_archive_ready: Boolean(existingWorkerStageRetention.worker_stage_archive_ready),
        worker_stage_reclaim_ready: Boolean(existingWorkerStageRetention.worker_stage_reclaim_ready),
        worker_stage_purge_ready: Boolean(existingWorkerStageRetention.worker_stage_purge_ready),
        worker_stage_retention_decision: normalizeString(existingWorkerStageRetention.worker_stage_retention_decision),
      },
    },
    worker_budget: {
      budget_lane: view.budget.budget_lane,
      fast_token_budget: view.budget.fast_token_budget,
      degraded_token_budget: view.budget.degraded_token_budget,
      reclaim_threshold: view.budget.reclaim_threshold,
      token_cost_used: view.budget.token_cost_used,
      max_token_cost: view.budget.max_token_cost,
      updated_at: view.assembled_at,
    },
    worker_convergence: {
      convergence_class: view.convergence.convergence_class,
      convergence_confidence: view.convergence.convergence_confidence,
      progress_delta: view.convergence.progress_delta,
      remaining_work_estimate: view.convergence.remaining_work_estimate,
      reclaim_reason: view.convergence.reclaim_reason,
      reported_at: view.convergence.reported_at || view.assembled_at,
    },
    task_cluster: {
      cluster_id: view.collaboration.cluster_id,
      memberships: view.collaboration.memberships,
      cluster_root: view.collaboration.cluster_root,
      workspace_root: view.collaboration.workspace_root,
      mailbox_path: view.collaboration.mailbox_path,
      archive_path: view.collaboration.archive_path,
      default_target_role_types: view.collaboration.default_target_role_types,
      mailbox_counters: view.collaboration.mailbox_counters,
      last_published_message_type: extractObject(taskMeta?.task_cluster).last_published_message_type ?? "",
      cluster_projection: view.cluster_projection,
      updated_at: view.assembled_at,
    },
    runtime_worker_control: runtimeControl,
    keeper_feedback: buildKeeperFeedbackSummary({ view, taskMeta: taskMeta ?? {} }),
  };
}
