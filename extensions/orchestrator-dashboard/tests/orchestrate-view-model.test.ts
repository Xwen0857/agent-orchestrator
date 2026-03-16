import {
  buildRunSuccessResponseParams,
  buildTaskStatusResponseParams,
} from "../orchestrate-view-model.js";
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

describe("orchestrate view-model builders", () => {
  it("derives task status render params from meta", () => {
    const params = buildTaskStatusResponseParams({
      taskId: "task_1",
      meta: {
        split_units_planned: 5,
        planning_decision: {
          decision_source: "planner_rules_fallback",
          decision_reason: "fallback",
          request_authority: "task_local_strategy_meta",
          llm_role: "primary",
          llm_decision_used: false,
          token_priority_context: {
            tier: "highest",
            reserved_ratio: 0.35,
            min_planning_tokens: 1200,
            max_planning_tokens: 6000,
            inline_override_applied: true,
            effective_planning_tokens: 2400,
          },
          mcp_soft_boundary_signals: {
            mode: "bias_plan",
            isolation_enabled: true,
            orchestrator_profile_name: "orchestrator_control",
            project_profile_name: "project_execution",
            orchestrator_mcp_dir: ".openclaw-system/mcp",
            project_mcp_dir: ".openclaw-project/mcp",
            orchestrator_namespace_read_only: true,
            project_namespace_read_only: false,
          },
          meta_decomposition: {
            decision_source: "planner_rules_fallback",
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
          agent_contract_version: "planner-core-v2",
        },
        acl: { denied_count: 2 },
        aggregate: { publish_status: "none" },
        execution_roles: { planning_actor: "planner-core" },
        worker_budget: { budget_lane: "degraded" },
        worker_runtime: {
          selected_template_id: "code_backend_java_spring",
          selected_template_origin: "custom",
          selected_template_source_id: "entry:code_backend_java_spring",
          template_version: "v2",
          registration_source: "keeper_worker_import",
          delivery_mode: "deterministic_python_bundle",
          template_kind: "concrete",
          governance_policy_id: "worker_lifecycle_policy_default_v1",
          result_contract_version: "worker-template-result-contract-v1",
          allowed_template_origins: ["builtin", "custom"],
          custom_registration_required: true,
          default_message_type: "handoff_note",
          default_target_role_types: ["tester-ephemeral"],
          semantic_topology: { transaction_layer: "update", action_layer: "implement" },
          implementation_topology: { artifact_layer: "code", role_layer: "backend", tech_layer: "java" },
          cluster_projection: { implementation_clusters: ["implementation.code.backend.java"] },
        },
        worker_convergence: {
          convergence_class: "stalled",
          reclaim_reason: "token_budget_exhausted",
        },
        task_cluster: {
          cluster_id: "cluster_demo",
          last_published_message_type: "handoff_note",
          mailbox_counters: {
            published: 1,
            acknowledged: 0,
            consumed: 0,
            archived: 0,
          },
        },
        keeper_feedback: {
          feedback_types: ["capacity_allocation_feedback"],
          submitted_fingerprints: ["fp_1"],
          last_submitted_at: "2026-03-09T00:00:00Z",
        },
        runtime_worker_control: {
          rebuild_ready: true,
          rebuild_reason: "budget_or_refinement_amendment",
        },
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
          granularity: "temporary_refinement_granularity",
          component_candidates: ["protocol_schema"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "module_001",
              module_title: "protocol_surface",
              component_candidate: "protocol_schema",
              depends_on_component_candidates: [],
              depends_on_leaf_ids: [],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 2,
              release_state: "immediate_first_wave",
              child_task_id: "task_1_c001",
            },
          ],
          backlog: [],
        },
        decision_context: {
          llm_role: "primary",
          token_priority_context: { effective_planning_tokens: 2400 },
        },
      },
      runnerStatus: "started",
      runnerLastTickAt: "",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      lockMtime: "",
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: false,
      amendmentCount: 0,
      lastAmendment: "",
      recent: [],
    });

    expect(params.initialSplitStrategy).toBe("meta_module_partition");
    expect(params.initialMetaUnits).toBe(2);
    expect(params.initialPartitionExpanded).toBe(true);
    expect(params.initialDecouplingPrinciple).toBe("functional_decoupling");
    expect(params.initialDecouplingConfidence).toBe("high");
    expect(params.initialDecouplingRationale).toEqual(["protocol boundary", "core boundary"]);
    expect(params.workerRefinementRequired).toBe(true);
    expect(params.workerRefinementScope).toBe("multi_meta_input");
    expect(params.workerRefinementStrategy).toBe("linear_split_units_placeholder");
    expect(params.workerRefinementPrinciple).toBe("engineering_decoupling");
    expect(params.workerRefinementComponentCandidates).toEqual([
      "protocol_schema",
      "transport_adapter",
    ]);
    expect(params.granularityGuardrailTriggered).toBe(true);
    expect(params.granularityGuardrailNotes).toEqual(["trimmed to max meta units"]);
    expect(params.splitUnitsPlanned).toBe(5);
    expect(params.planningDecision.request_authority).toBe("task_local_strategy_meta");
    expect(params.planningDecision.llm_role).toBe("primary");
    expect(params.planningDecision.token_priority_context).toEqual(
      expect.objectContaining({ effective_planning_tokens: 2400 }),
    );
    expect(params.planningDecision.meta_decomposition).toEqual(
      expect.objectContaining({ meta_unit_count: 2 }),
    );
    expect(params.planningDecision.worker_refinement).toEqual(
      expect.objectContaining({ refinement_scope: "multi_meta_input" }),
    );
    expect(params.splitPlan.decomposition_strategy).toBe("module_first");
    expect(params.splitPlan.decision_context).toEqual(
      expect.objectContaining({ llm_role: "primary" }),
    );
    expect(params.acl.denied_count).toBe(2);
    expect(params.executionRoles.planning_actor).toBe("planner-core");
    expect(params.workerBudgetLane).toBe("degraded");
    expect(params.selectedTemplateId).toBe("code_backend_java_spring");
    expect(params.selectedTemplateOrigin).toBe("custom");
    expect(params.selectedTemplateSourceId).toBe("entry:code_backend_java_spring");
    expect(params.selectedTemplateVersion).toBe("v2");
    expect(params.selectedTemplateRegistrationSource).toBe("keeper_worker_import");
    expect(params.selectedTemplateDeliveryMode).toBe("deterministic_python_bundle");
    expect(params.selectedTemplateKind).toBe("concrete");
    expect(params.governancePolicyId).toBe("worker_lifecycle_policy_default_v1");
    expect(params.resultContractVersion).toBe("worker-template-result-contract-v1");
    expect(params.allowedTemplateOrigins).toEqual(["builtin", "custom"]);
    expect(params.customRegistrationRequired).toBe(true);
    expect(params.defaultMessageType).toBe("handoff_note");
    expect(params.defaultTargetRoleTypes).toEqual(["tester-ephemeral"]);
    expect(params.workerStageRuntimeClass).toBe("(none)");
    expect(params.workerStageAllowedExecutionMode).toBe("(none)");
    expect(params.customRuntimeGateStatus).toBe("(none)");
    expect(params.taskClusterId).toBe("cluster_demo");
    expect(params.taskClusterLastMessageType).toBe("handoff_note");
    expect(params.keeperFeedbackTypes).toEqual(["capacity_allocation_feedback"]);
    expect(params.keeperFeedbackFingerprints).toEqual(["fp_1"]);
    expect(params.workerRebuildReady).toBe(true);
    expect(params.workerLastFaultAction).toBe("(none)");
    expect(params.workerFaultRetryable).toBe(false);
    expect(params.workerLastFaultActionApplied).toBe("(none)");
    expect(params.workerFaultActuationMode).toBe("(none)");
    expect(params.workerFaultActionBlockedByPolicy).toBe(false);
    expect(params.workerFaultClass).toBe("(none)");
  });

  it("derives run success render params from meta defaults", () => {
    const params = buildRunSuccessResponseParams({
      taskId: "task_2",
      sessionKeyForRun: "sess_1",
      summaryId: "sum_1",
      summaryPath: "/repo/summary.json",
      payload: { scheduling_actor: "scheduler-ops" },
      singleWorkerId: "worker_1",
      strategyPath: "/repo/strategy.json",
      basePath: "/plugins/orchestrator",
      runnerStatus: "started",
      runnerLastTickAt: "",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      meta: {
        split_units_planned: 1,
        project_id: "demo",
        aggregate: { publish_status: "none" },
        worker_budget: { budget_lane: "fast" },
        worker_runtime: {
          selected_template_id: "websocket_calculator",
          selected_template_origin: "builtin",
          selected_template_source_id: "builtin:websocket_calculator",
          template_version: "v1",
          registration_source: "builtin_registry",
          delivery_mode: "deterministic_python_bundle",
          template_kind: "concrete",
          governance_policy_id: "worker_lifecycle_policy_default_v1",
          result_contract_version: "worker-template-result-contract-v1",
          allowed_template_origins: ["builtin", "custom"],
          custom_registration_required: true,
          default_message_type: "partial_deliverable",
          default_target_role_types: ["tester-ephemeral"],
          semantic_topology: { transaction_layer: "update", action_layer: "implement" },
          implementation_topology: { artifact_layer: "code", role_layer: "backend", tech_layer: "python" },
          cluster_projection: { implementation_clusters: ["implementation.code.backend.python"] },
        },
        worker_convergence: { convergence_class: "not_converged", reclaim_reason: "" },
        task_cluster: {
          cluster_id: "cluster_demo",
          last_published_message_type: "",
          mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
        },
        keeper_feedback: { feedback_types: [], submitted_fingerprints: [] },
        runtime_worker_control: { rebuild_ready: false, rebuild_reason: "" },
        planning_decision: {
          decision_source: "manual_override",
          decision_reason: "",
          decision_signals: {},
          meta_decomposition: {
            decision_source: "manual_override",
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
        },
      },
      splitPlan: {
        planner_phase: "initial_plan",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [{ module_id: "meta_unit_001", module_title: "root_meta_unit", child_tasks: [] }],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "single_meta_input",
          granularity: "temporary_refinement_granularity",
          component_candidates: ["implementation_unit"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "meta_unit_001",
              module_title: "root_meta_unit",
              component_candidate: "implementation_unit",
              depends_on_component_candidates: [],
              depends_on_leaf_ids: [],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 1,
              release_state: "immediate_first_wave",
              worker_task_id: "task_2",
            },
          ],
          backlog: [],
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
      workspaceConfigSourceDefault: "runtime_default",
      workspaceValidatedDefault: true,
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: false,
      checklistText: "ok",
      scriptTrace: [],
      llmUsed: false,
      llmReason: "disabled",
      llmAuthMode: "auto",
      llmKeySource: "",
    });

    expect(params.initialSplitStrategy).toBe("meta_single_unit");
    expect(params.selectedTemplateId).toBe("websocket_calculator");
    expect(params.selectedTemplateOrigin).toBe("builtin");
    expect(params.selectedTemplateSourceId).toBe("builtin:websocket_calculator");
    expect(params.selectedTemplateVersion).toBe("v1");
    expect(params.selectedTemplateRegistrationSource).toBe("builtin_registry");
    expect(params.selectedTemplateDeliveryMode).toBe("deterministic_python_bundle");
    expect(params.governancePolicyId).toBe("worker_lifecycle_policy_default_v1");
    expect(params.resultContractVersion).toBe("worker-template-result-contract-v1");
    expect(params.allowedTemplateOrigins).toEqual(["builtin", "custom"]);
    expect(params.customRegistrationRequired).toBe(true);
    expect(params.defaultMessageType).toBe("partial_deliverable");
    expect(params.workerStageRuntimeClass).toBe("(none)");
    expect(params.workerStageAllowedExecutionMode).toBe("(none)");
    expect(params.workerStageLastRetainedArtifactIds).toEqual([]);
    expect(params.initialMetaUnits).toBe(1);
    expect(params.initialPartitionExpanded).toBe(false);
    expect(params.initialDecouplingPrinciple).toBe("functional_decoupling");
    expect(params.initialDecouplingConfidence).toBe("low");
    expect(params.workerRefinementRequired).toBe(true);
    expect(params.workerRefinementScope).toBe("single_meta_input");
    expect(params.workerRefinementStrategy).toBe("linear_split_units_placeholder");
    expect(params.workerRefinementPrinciple).toBe("engineering_decoupling");
    expect(params.workerRefinementComponentCandidates).toEqual(["implementation_unit"]);
    expect(params.granularityGuardrailTriggered).toBe(false);
    expect(params.splitPlan.decomposition_strategy).toBe("single_path");
    expect(params.splitPlan.decision_context).toEqual(
      expect.objectContaining({ llm_role: "primary" }),
    );
    expect(params.workspaceConfigSource).toBe("runtime_default");
    expect(params.workspaceValidated).toBe(true);
    expect(params.aggregate.publish_status).toBe("none");
    expect(params.workerBudgetLane).toBe("fast");
    expect(params.workerConvergenceClass).toBe("not_converged");
    expect(params.keeperFeedbackFingerprints).toEqual([]);
    expect(params.workerLastFaultAction).toBe("(none)");
    expect(params.workerLastFaultActionApplied).toBe("(none)");
  });
});
