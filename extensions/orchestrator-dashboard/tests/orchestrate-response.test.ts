import {
  renderRunSuccessResponse,
  renderTaskStatusResponse,
} from "../orchestrate-response.js";
import { loadPlannerDependencyConfig } from "../orchestrate-planner-dependency-semantics.js";
import { describe, expect, it } from "vitest";

const runtimeStats = {
  logicalThreads: 8,
  effectiveWorkerThreads: 4,
  parallelLimit: 4,
  queueDepth: 16,
  policyMode: "enforce",
  workdomainRoot: "runtime/workdomains",
  projectsRoot: "projects",
  aclDeniedCount: 1,
  aclLastDeniedAt: "2026-03-02T00:00:00.000Z",
  sandboxEnabled: true,
  commitGuardEnabled: true,
  kbImportConfirmRequired: true,
  kbImportAutoEnabled: false,
  workspaceSyncSensitivity: "MEDIUM",
  skillMcpIsolationEnabled: true,
  protectOrchestratorConfig: true,
  projectRuntimeProfile: "project_execution",
  orchestratorRuntimeProfile: "orchestrator_control",
};

const externalRunner = {
  running: true,
  pid: 1234,
  lastTickAt: "2026-03-02T00:00:01.000Z",
  lastExitCode: "0",
};

describe("orchestrate response rendering", () => {
  const dependencyConfig = loadPlannerDependencyConfig();

  it("renders task status output", () => {
    const text = renderTaskStatusResponse({
      taskId: "task_1",
      meta: {
        state: "IN_PROGRESS",
        version: 3,
        project_id: "demo",
        children: ["a", "b"],
        acl: { denied_count: 2 },
      },
      runnerStatus: "started",
      runnerLastTickAt: "2026-03-02T00:00:01.000Z",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      initialSplitStrategy: "meta_module_partition",
      initialMetaUnits: 2,
      initialPartitionExpanded: true,
      initialDecouplingPrinciple: "functional_decoupling",
      initialDecouplingConfidence: "high",
      initialDecouplingRationale: ["protocol boundary", "core boundary"],
      workerRefinementRequired: true,
      workerRefinementScope: "multi_meta_input",
      workerRefinementStrategy: "linear_split_units_placeholder",
      workerRefinementPrinciple: "engineering_decoupling",
      workerRefinementComponentCandidates: ["protocol_schema", "transport_adapter"],
      granularityGuardrailTriggered: true,
      granularityGuardrailNotes: ["trimmed to max meta units"],
      planningDecision: {
        decision_source: "planner_rules_fallback",
        decision_reason: "complex task",
        meta_decomposition: {
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "high",
          decoupling_rationale: ["protocol boundary", "core boundary"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
          component_candidates: ["protocol_schema", "transport_adapter"],
        },
        granularity_guardrails: {
          guardrail_triggered: true,
          guardrail_notes: ["trimmed to max meta units"],
        },
        llm_role: "primary",
        llm_decision_used: false,
        token_priority_context: {
          tier: "highest",
          effective_planning_tokens: 2400,
          inline_override_applied: true,
        },
        mcp_soft_boundary_signals: {
          mode: "bias_plan",
          isolation_enabled: true,
          orchestrator_profile_name: "orchestrator_control",
          project_profile_name: "project_execution",
        },
        agent_contract_version: "planner-core-v2",
      },
      splitPlan: {
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [{ module_id: "module_001" }, { module_id: "module_002" }],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          leaf_units: [{ leaf_id: "leaf_1" }],
        },
      },
      splitUnitsPlanned: 2,
      acl: { denied_count: 2 },
      aggregate: { publish_status: "none" },
      executionRoles: {},
      lockMtime: "2026-03-02T00:00:02.000Z",
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: true,
      amendmentCount: 1,
      lastAmendment: "latest",
      recent: ["2026-03-02T00:00:03.000Z TEST IN_PROGRESS"],
      workerBudgetLane: "degraded",
      workerConvergenceClass: "partial_deliverable",
      workerReclaimReason: "(none)",
      selectedTemplateId: "code_backend_java_spring",
      selectedTemplateOrigin: "custom",
      selectedTemplateSourceId: "entry:code_backend_java_spring",
      selectedTemplateVersion: "v2",
      selectedTemplateRegistrationSource: "keeper_worker_import",
      selectedTemplateDeliveryMode: "deterministic_python_bundle",
      selectedTemplateKind: "concrete",
      governancePolicyId: "worker_lifecycle_policy_default_v1",
      resultContractVersion: "worker-template-result-contract-v1",
      allowedTemplateOrigins: ["builtin", "custom"],
      customRegistrationRequired: true,
      workerStageId: "workerstage_task_1_op_1_1",
      workerStageRoot: "/tmp/task_1/worker_stages/workerstage_task_1_op_1_1",
      workerStageProfile: "normal",
      workerStageIsolationMode: "wrapper_enforced",
      workerStageRuntimeClass: "default_shell",
      workerStageAllowedExecutionMode: "local_threads",
      workerStageMaxBytes: 1000000,
      workerStageMaxFileCount: 128,
      workerStageMaxSingleFileBytes: 256000,
      workerStageOverflowPolicy: "block_write",
      workerStageBytesUsed: 1024,
      workerStageFileCount: 3,
      workerStageOverflowStatus: "ok",
      workerStageRetentionPolicy: "retain_delivery_only",
      workerStageExportedArtifactCount: 2,
      workerStageLastExportStatus: "exported",
      workerStageLastExportManifestClass: "delivery_manifest",
      workerStageLastFaultClass: "(none)",
      workerStageRetentionResult: { retention_decision: "retain_delivery_only" },
      workerStageLastCleanupAt: "2026-03-09T00:00:20Z",
      workerStageLastRetainedArtifactIds: ["artifact_1", "artifact_2"],
      customRuntimeGateStatus: "allowed",
      clusterRoot: "/tmp/task_1/task_cluster_workspace",
      defaultMessageType: "handoff_note",
      defaultTargetRoleTypes: ["tester-ephemeral"],
      semanticTopology: { transaction_layer: "update", action_layer: "implement" },
      implementationTopology: { artifact_layer: "code", role_layer: "backend", tech_layer: "java" },
      clusterProjection: { implementation_clusters: ["implementation.code.backend.java"] },
      taskClusterId: "cluster_demo",
      taskClusterLastMessageType: "handoff_note",
      taskClusterMailboxCounts: { published: 1, acknowledged: 0, consumed: 0, archived: 0 },
      keeperFeedbackTypes: ["capacity_allocation_feedback"],
      keeperFeedbackFingerprints: ["fp_1"],
      keeperLastSubmittedAt: "2026-03-09T00:00:00Z",
      workerRebuildReady: true,
      workerRebuildReason: "budget_or_refinement_amendment",
      workerLastFaultAction: "rebuild",
      workerFaultRetryable: false,
      workerFaultRequiresRebuild: true,
      workerLastFaultActionApplied: "rebuild",
      workerFaultActuationMode: "enabled",
      workerFaultActionBlockedByPolicy: false,
      workerFaultClass: "worker_stage_exhausted",
    });

    expect(text).toContain("task_id: task_1");
    expect(text).toContain("planner_ingress: auto-only");
    expect(text).not.toContain("requested_mode:");
    expect(text).not.toContain("resolved_mode:");
    expect(text).toContain("initial_partition_strategy: meta_module_partition");
    expect(text).toContain("initial_meta_units: 2");
    expect(text).toContain("initial_partition_expanded: true");
    expect(text).toContain("initial_decoupling_principle: functional_decoupling");
    expect(text).toContain("initial_decoupling_confidence: high");
    expect(text).toContain("granularity_guardrail_triggered: true");
    expect(text).toContain("worker_refinement_scope: multi_meta_input");
    expect(text).toContain("worker_refinement_principle: engineering_decoupling");
    expect(text).toContain("worker_refinement_component_candidates: protocol_schema, transport_adapter");
    expect(text).toContain("planner_llm_role: primary");
    expect(text).toContain("planner_token_tier: highest");
    expect(text).toContain("planner_mcp_mode: bias_plan");
    expect(text).toContain("worker_budget_lane: degraded");
    expect(text).toContain("worker_selected_template_id: code_backend_java_spring");
    expect(text).toContain("worker_selected_template_origin: custom");
    expect(text).toContain("worker_selected_template_source_id: entry:code_backend_java_spring");
    expect(text).toContain("worker_selected_template_version: v2");
    expect(text).toContain("worker_selected_template_registration_source: keeper_worker_import");
    expect(text).toContain("worker_delivery_mode: deterministic_python_bundle");
    expect(text).toContain("worker_template_kind: concrete");
    expect(text).toContain("worker_governance_policy_id: worker_lifecycle_policy_default_v1");
    expect(text).toContain("worker_result_contract_version: worker-template-result-contract-v1");
    expect(text).toContain("worker_allowed_template_origins: builtin, custom");
    expect(text).toContain("worker_custom_registration_required: true");
    expect(text).toContain("worker_default_message_type: handoff_note");
    expect(text).toContain("worker_default_target_role_types: tester-ephemeral");
    expect(text).toContain("workerStage_isolation_mode: wrapper_enforced");
    expect(text).toContain("workerStage_runtime_class: default_shell");
    expect(text).toContain("workerStage_allowed_execution_mode: local_threads");
    expect(text).toContain("workerStage_last_export_status: exported");
    expect(text).toContain("workerStage_last_export_manifest_class: delivery_manifest");
    expect(text).toContain("workerStage_last_cleanup_at: 2026-03-09T00:00:20Z");
    expect(text).toContain("workerStage_last_retained_artifact_ids: artifact_1, artifact_2");
    expect(text).toContain("worker_custom_runtime_gate_status: allowed");
    expect(text).toContain("task_cluster_id: cluster_demo");
    expect(text).toContain("task_cluster_last_message_type: handoff_note");
    expect(text).toContain("keeper_feedback_types: capacity_allocation_feedback");
    expect(text).toContain("keeper_feedback_fingerprints: fp_1");
    expect(text).toContain("decomposition_strategy: module_first");
    expect(text).toContain(`refinement_dependency_mode: ${dependencyConfig.semantics.dependency_mode}`);
    expect(text).toContain("refinement_dependency_roots: 0");
    expect(text).toContain("refinement_dependency_blocked: 0");
    expect(text).toContain("refinement_cross_module_links: 0");
    expect(text).toContain(`refinement_dependency_note: ${dependencyConfig.defaults.summary_note}`);
    expect(text).toContain("refinement_leaf_units: 1");
    expect(text).toContain("recent_events:");
    expect(text).toContain("- 2026-03-02T00:00:03.000Z TEST IN_PROGRESS");
  });

  it("renders run success output", () => {
    const text = renderRunSuccessResponse({
      taskId: "task_2",
      sessionKeyForRun: "sess_1",
      summaryId: "sum_1",
      summaryPath: "/repo/summary.json",
      payload: {
        state: "ASSIGNED",
        version: 1,
        planning_actor: "planner-core",
        scheduling_actor: "scheduler-ops",
        actor_compat_mode: false,
        actor_compat_hits: 0,
        aggregate_audit_status: "(none)",
        aggregate_collisions_count: 0,
      },
      singleWorkerId: "worker_1",
      strategyPath: "/repo/strategy.json",
      basePath: "/plugins/orchestrator",
      runnerStatus: "degraded",
      runnerLastTickAt: "",
      runnerLastTickResult: "failed",
      runnerLastTickError: "boom",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      initialSplitStrategy: "meta_single_unit",
      initialMetaUnits: 1,
      initialPartitionExpanded: false,
      initialDecouplingPrinciple: "functional_decoupling",
      initialDecouplingConfidence: "low",
      initialDecouplingRationale: ["no strong functional boundary detected"],
      workerRefinementRequired: true,
      workerRefinementScope: "single_meta_input",
      workerRefinementStrategy: "linear_split_units_placeholder",
      workerRefinementPrinciple: "engineering_decoupling",
      workerRefinementComponentCandidates: ["implementation_unit"],
      granularityGuardrailTriggered: false,
      granularityGuardrailNotes: [],
      planningDecision: {
        decision_source: "manual_override",
        decision_reason: "",
      },
      splitPlan: {
        planner_phase: "initial_plan",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
        },
        decision_context: {
          meta_decomposition: {
            decomposition_strategy: "meta_single_unit",
            meta_unit_count: 1,
            primary_principle: "functional_decoupling",
            decoupling_confidence: "low",
            decoupling_rationale: ["no strong functional boundary detected"],
          },
          worker_refinement: {
            required: true,
            refinement_strategy: "linear_split_units_placeholder",
            refinement_scope: "single_meta_input",
            primary_principle: "engineering_decoupling",
            component_candidates: ["implementation_unit"],
          },
          granularity_guardrails: {
            guardrail_triggered: false,
            guardrail_notes: [],
          },
          llm_role: "primary",
          llm_decision_used: false,
          token_priority_context: {
            tier: "highest",
            effective_planning_tokens: 1200,
            inline_override_applied: false,
          },
          mcp_soft_boundary_signals: {
            mode: "bias_plan",
            isolation_enabled: true,
            orchestrator_profile_name: "orchestrator_control",
            project_profile_name: "project_execution",
          },
          agent_contract_version: "planner-core-v2",
        },
      },
      splitUnitsPlanned: 1,
      meta: {
        project_id: "demo",
        acl: {},
      },
      workspaceConfigSource: "runtime_default",
      workspaceValidated: true,
      aggregate: {},
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: true,
      checklistText: "required_config: ok",
      scriptTrace: ["trace: script ok"],
      llmUsed: false,
      llmReason: "disabled",
      llmAuthMode: "auto",
      llmKeySource: "",
      workerBudgetLane: "fast",
      workerConvergenceClass: "not_converged",
      workerReclaimReason: "(none)",
      selectedTemplateId: "websocket_calculator",
      selectedTemplateOrigin: "builtin",
      selectedTemplateSourceId: "builtin:websocket_calculator",
      selectedTemplateVersion: "v1",
      selectedTemplateRegistrationSource: "builtin_registry",
      selectedTemplateDeliveryMode: "deterministic_python_bundle",
      selectedTemplateKind: "concrete",
      governancePolicyId: "worker_lifecycle_policy_default_v1",
      resultContractVersion: "worker-template-result-contract-v1",
      allowedTemplateOrigins: ["builtin", "custom"],
      customRegistrationRequired: true,
      workerStageId: "workerstage_task_1_op_1_1",
      workerStageRoot: "/tmp/task_1/worker_stages/workerstage_task_1_op_1_1",
      workerStageProfile: "normal",
      workerStageIsolationMode: "wrapper_enforced",
      workerStageRuntimeClass: "default_shell",
      workerStageAllowedExecutionMode: "local_threads",
      workerStageMaxBytes: 1000000,
      workerStageMaxFileCount: 128,
      workerStageMaxSingleFileBytes: 256000,
      workerStageOverflowPolicy: "block_write",
      workerStageBytesUsed: 1024,
      workerStageFileCount: 3,
      workerStageOverflowStatus: "ok",
      workerStageRetentionPolicy: "retain_delivery_only",
      workerStageExportedArtifactCount: 2,
      workerStageLastExportStatus: "exported",
      workerStageLastExportManifestClass: "delivery_manifest",
      workerStageLastFaultClass: "(none)",
      workerStageRetentionResult: { retention_decision: "retain_delivery_only" },
      workerStageLastCleanupAt: "2026-03-09T00:00:20Z",
      workerStageLastRetainedArtifactIds: ["artifact_1"],
      customRuntimeGateStatus: "not_applicable",
      clusterRoot: "/tmp/task_1/task_cluster_workspace",
      defaultMessageType: "partial_deliverable",
      defaultTargetRoleTypes: ["tester-ephemeral"],
      semanticTopology: { transaction_layer: "update", action_layer: "implement" },
      implementationTopology: { artifact_layer: "code", role_layer: "backend", tech_layer: "python" },
      clusterProjection: { implementation_clusters: ["implementation.code.backend.python"] },
      taskClusterId: "cluster_demo",
      taskClusterLastMessageType: "",
      taskClusterMailboxCounts: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      keeperFeedbackTypes: [],
      keeperFeedbackFingerprints: [],
      keeperLastSubmittedAt: "(none)",
      workerRebuildReady: false,
      workerRebuildReason: "(none)",
      workerLastFaultAction: "none",
      workerFaultRetryable: false,
      workerFaultRequiresRebuild: false,
      workerLastFaultActionApplied: "block",
      workerFaultActuationMode: "summary_only",
      workerFaultActionBlockedByPolicy: false,
      workerFaultClass: "worker_stage_forbidden_write",
    });

    expect(text).toContain("task_id: task_2");
    expect(text).not.toContain("requested_mode:");
    expect(text).not.toContain("resolved_mode:");
    expect(text).toContain("planner_effective_tokens: 1200");
    expect(text).toContain("planner_agent_contract_version: planner-core-v2");
    expect(text).toContain("worker_budget_lane: fast");
    expect(text).toContain("worker_selected_template_origin: builtin");
    expect(text).toContain("worker_selected_template_source_id: builtin:websocket_calculator");
    expect(text).toContain("worker_selected_template_version: v1");
    expect(text).toContain("worker_selected_template_registration_source: builtin_registry");
    expect(text).toContain("worker_governance_policy_id: worker_lifecycle_policy_default_v1");
    expect(text).toContain("worker_result_contract_version: worker-template-result-contract-v1");
    expect(text).toContain("worker_allowed_template_origins: builtin, custom");
    expect(text).toContain("worker_custom_registration_required: true");
    expect(text).toContain("worker_default_message_type: partial_deliverable");
    expect(text).toContain("worker_last_fault_action: none");
    expect(text).toContain("task_cluster_id: cluster_demo");
    expect(text).toContain("initial_partition_strategy: meta_single_unit");
    expect(text).toContain("initial_meta_units: 1");
    expect(text).toContain("initial_decoupling_principle: functional_decoupling");
    expect(text).toContain("worker_refinement_scope: single_meta_input");
    expect(text).toContain("worker_refinement_principle: engineering_decoupling");
    expect(text).toContain("worker_refinement_component_candidates: implementation_unit");
    expect(text).toContain("decomposition_strategy: single_path");
    expect(text).toContain(`refinement_dependency_mode: ${dependencyConfig.semantics.dependency_mode}`);
    expect(text).toContain(`refinement_dependency_note: ${dependencyConfig.defaults.summary_note}`);
    expect(text).toContain("runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10");
    expect(text).toContain("llm_planner: fallback(disabled)");
    expect(text).toContain("required_config: ok");
    expect(text).toContain("trace: script ok");
  });

  it("derives dependency summary from leaf units when summary block is missing", () => {
    const text = renderTaskStatusResponse({
      taskId: "task_derived_hints",
      meta: {
        state: "IN_PROGRESS",
        version: 3,
        project_id: "demo",
        children: ["a", "b"],
        acl: { denied_count: 2 },
      },
      runnerStatus: "started",
      runnerLastTickAt: "2026-03-02T00:00:01.000Z",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      initialSplitStrategy: "meta_module_partition",
      initialMetaUnits: 2,
      initialPartitionExpanded: true,
      initialDecouplingPrinciple: "functional_decoupling",
      initialDecouplingConfidence: "high",
      initialDecouplingRationale: ["protocol boundary", "core boundary"],
      workerRefinementRequired: true,
      workerRefinementScope: "multi_meta_input",
      workerRefinementStrategy: "linear_split_units_placeholder",
      workerRefinementPrinciple: "engineering_decoupling",
      workerRefinementComponentCandidates: ["protocol_schema", "transport_adapter"],
      granularityGuardrailTriggered: false,
      granularityGuardrailNotes: [],
      planningDecision: {
        decision_source: "planner_rules_fallback",
        decision_reason: "complex task",
      },
      splitPlan: {
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [{ module_id: "module_001" }, { module_id: "module_002" }],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "module_001",
              depends_on_leaf_ids: [],
            },
            {
              leaf_id: "leaf_2",
              module_id: "module_002",
              depends_on_leaf_ids: ["leaf_1"],
            },
          ],
        },
      },
      splitUnitsPlanned: 2,
      acl: { denied_count: 2 },
      aggregate: { publish_status: "none" },
      executionRoles: {},
      lockMtime: "2026-03-02T00:00:02.000Z",
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: true,
      amendmentCount: 0,
      lastAmendment: "",
      recent: [],
      workerBudgetLane: "fast",
      workerConvergenceClass: "not_converged",
      workerReclaimReason: "(none)",
      selectedTemplateId: "(none)",
      selectedTemplateOrigin: "(none)",
      selectedTemplateSourceId: "(none)",
      selectedTemplateVersion: "(none)",
      selectedTemplateRegistrationSource: "(none)",
      selectedTemplateDeliveryMode: "(none)",
      selectedTemplateKind: "(none)",
      governancePolicyId: "(none)",
      resultContractVersion: "(none)",
      allowedTemplateOrigins: [],
      customRegistrationRequired: false,
      workerStageId: "(none)",
      workerStageRoot: "(none)",
      workerStageProfile: "(none)",
      workerStageIsolationMode: "(none)",
      workerStageRuntimeClass: "(none)",
      workerStageAllowedExecutionMode: "(none)",
      workerStageMaxBytes: 0,
      workerStageMaxFileCount: 0,
      workerStageMaxSingleFileBytes: 0,
      workerStageOverflowPolicy: "(none)",
      workerStageBytesUsed: 0,
      workerStageFileCount: 0,
      workerStageOverflowStatus: "(none)",
      workerStageRetentionPolicy: "(none)",
      workerStageExportedArtifactCount: 0,
      workerStageLastExportStatus: "(none)",
      workerStageLastExportManifestClass: "(none)",
      workerStageLastFaultClass: "(none)",
      workerStageRetentionResult: {},
      workerStageLastCleanupAt: "(none)",
      workerStageLastRetainedArtifactIds: [],
      customRuntimeGateStatus: "(none)",
      clusterRoot: "(none)",
      defaultMessageType: "(none)",
      defaultTargetRoleTypes: [],
      semanticTopology: {},
      implementationTopology: {},
      clusterProjection: {},
      taskClusterId: "(none)",
      taskClusterLastMessageType: "(none)",
      taskClusterMailboxCounts: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      keeperFeedbackTypes: [],
      keeperFeedbackFingerprints: [],
      keeperLastSubmittedAt: "(none)",
      workerRebuildReady: false,
      workerRebuildReason: "(none)",
      workerLastFaultAction: "(none)",
      workerFaultRetryable: false,
      workerFaultRequiresRebuild: false,
      workerLastFaultActionApplied: "(none)",
      workerFaultActuationMode: "(none)",
      workerFaultActionBlockedByPolicy: false,
      workerFaultClass: "(none)",
    });

    expect(text).toContain(`refinement_dependency_mode: ${dependencyConfig.semantics.dependency_mode}`);
    expect(text).toContain(`refinement_dependency_note: ${dependencyConfig.defaults.summary_note}`);
    expect(text).toContain("refinement_dependency_roots: 1");
    expect(text).toContain("refinement_dependency_blocked: 1");
    expect(text).toContain("refinement_dependency_links: 1");
    expect(text).toContain("refinement_cross_module_links: 1");
  });
});
