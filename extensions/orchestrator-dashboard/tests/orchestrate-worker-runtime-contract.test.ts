import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCoarseTemplateRoleRegistry,
  buildKeeperFeedbackFingerprint,
  buildWorkerArtifactTemplateRegistry,
  buildWorkerBaseTemplateRegistry,
  buildWorkerBudgetContract,
  buildWorkerClusterProjection,
  buildCustomWorkerTemplateRegistry,
  buildSchedulerWorkerLifecyclePolicyTemplate,
  buildWorkerImplementationTopology,
  buildWorkerLifecycleGovernanceContract,
  buildWorkerRoleTemplateRegistry,
  buildWorkerRuntimeControlSummary,
  buildWorkerRuntimeMetaSummary,
  buildWorkerRuntimeView,
  buildWorkerTemplateRegistry,
  buildWorkerTemplateSelectorInput,
  buildWorkerExecutableTemplateRegistry,
  deriveTaskClusterMemberships,
  matchWorkerTemplate,
  resolveWorkerSelectedTemplate,
  normalizeActionLayer,
  normalizeArtifactLayer,
  normalizeBudgetLane,
  normalizeClusterProjectionMode,
  normalizeConvergenceClass,
  normalizeCustomOverlayLayer,
  normalizeCustomTemplateRegistration,
  normalizeFrameworkLayer,
  normalizeKeeperFeedbackType,
  normalizeMailboxStatus,
  normalizeMessageType,
  normalizeReclaimReason,
  normalizeRoleLayer,
  normalizeTechLayer,
  normalizeTemplateKind,
  normalizeTemplateOrigin,
  normalizeTransactionLayer,
} from "../orchestrate-worker-runtime-contract.js";

describe("orchestrate-worker-runtime-contract", () => {
  it("normalizes worker runtime enums with safe defaults", () => {
    expect(normalizeBudgetLane(" degraded ")).toBe("degraded");
    expect(normalizeBudgetLane("bad")).toBe("fast");
    expect(normalizeConvergenceClass(" stalled ")).toBe("stalled");
    expect(normalizeConvergenceClass("bad")).toBe("not_converged");
    expect(normalizeReclaimReason(" token_budget_exhausted ")).toBe("token_budget_exhausted");
    expect(normalizeReclaimReason("bad")).toBe("");
    expect(normalizeMessageType(" handoff_note ")).toBe("handoff_note");
    expect(normalizeMessageType("bad")).toBe("partial_deliverable");
    expect(normalizeMailboxStatus(" archived ")).toBe("archived");
    expect(normalizeMailboxStatus("bad")).toBe("published");
    expect(normalizeKeeperFeedbackType(" capacity_allocation_feedback ")).toBe(
      "capacity_allocation_feedback",
    );
    expect(normalizeKeeperFeedbackType("bad")).toBe("");
    expect(normalizeTransactionLayer(" repair ")).toBe("repair");
    expect(normalizeTransactionLayer("bad")).toBe("update");
    expect(normalizeActionLayer(" integrate ")).toBe("integrate");
    expect(normalizeActionLayer("bad")).toBe("implement");
    expect(normalizeArtifactLayer(" document_reserved ")).toBe("document_reserved");
    expect(normalizeArtifactLayer("bad")).toBe("code");
    expect(normalizeRoleLayer(" database ")).toBe("database");
    expect(normalizeRoleLayer("bad")).toBe("backend");
    expect(normalizeTechLayer(" java ")).toBe("java");
    expect(normalizeTechLayer("bad")).toBe("generic");
    expect(normalizeFrameworkLayer(" spring ")).toBe("spring");
    expect(normalizeFrameworkLayer("bad")).toBe("generic");
    expect(normalizeTemplateKind(" artifact ")).toBe("artifact");
    expect(normalizeTemplateKind("bad")).toBe("placeholder");
    expect(normalizeTemplateOrigin(" custom ")).toBe("custom");
    expect(normalizeTemplateOrigin("bad")).toBe("builtin");
    expect(normalizeClusterProjectionMode(" by_hybrid ")).toBe("by_hybrid");
    expect(normalizeClusterProjectionMode("bad")).toBe("by_implementation");
    expect(
      normalizeCustomOverlayLayer({
        overlay_id: "team_overlay",
        overlay_fields: ["delivery_expectations", "unknown", "default_target_role_types"],
        config: {
          delivery_expectations: ["bundle"],
          unknown: "ignored",
          default_target_role_types: ["tester-ephemeral"],
        },
      }),
    ).toEqual({
      overlay_id: "team_overlay",
      overlay_fields: ["delivery_expectations", "default_target_role_types"],
      config: {
        delivery_expectations: ["bundle"],
        default_target_role_types: ["tester-ephemeral"],
      },
    });
  });

  it("builds layered template registries and keeps reserved placeholders", () => {
    expect(buildWorkerBaseTemplateRegistry().map((item) => item.template_id)).toContain(
      "worker_base_template",
    );
    expect(buildWorkerArtifactTemplateRegistry().map((item) => item.template_id)).toEqual(
      expect.arrayContaining([
        "artifact_code_template",
        "artifact_document_reserved_template",
        "artifact_image_reserved_template",
      ]),
    );
    expect(buildWorkerRoleTemplateRegistry().map((item) => item.template_id)).toEqual(
      expect.arrayContaining([
        "role_code_frontend",
        "role_code_backend",
        "role_code_database",
      ]),
    );
    expect(buildWorkerExecutableTemplateRegistry().map((item) => item.template_id)).toEqual(
      expect.arrayContaining([
        "websocket_calculator",
        "code_frontend_typescript_react",
        "code_backend_java_spring",
        "code_database_sql_generic",
        "code_data_python_generic",
        "code_infra_generic_generic",
        "code_script_automation_python_generic",
        "code_generic_placeholder",
        "document_reserved_placeholder",
        "image_reserved_placeholder",
      ]),
    );
    expect(
      buildWorkerExecutableTemplateRegistry().find((item) => item.template_id === "code_frontend_typescript_react")
        ?.handler_script,
    ).toBe("worker_templates/code_frontend_typescript_react.sh");
    expect(
      buildWorkerExecutableTemplateRegistry().find((item) => item.template_id === "code_frontend_typescript_react")
        ?.template_kind,
    ).toBe("concrete");
    expect(
      buildWorkerExecutableTemplateRegistry().find((item) => item.template_id === "code_data_python_generic")
        ?.default_message_type,
    ).toBe("dependency_update");
    expect(
      buildWorkerExecutableTemplateRegistry().find((item) => item.template_id === "code_infra_generic_generic")
        ?.default_message_type,
    ).toBe("handoff_note");
    expect(buildWorkerTemplateRegistry().length).toBeGreaterThan(
      buildWorkerExecutableTemplateRegistry().length,
    );
  });

  it("normalizes custom template registrations and rejects invalid runtime-authority fields", () => {
    expect(
      normalizeCustomTemplateRegistration({
        schema_version: "custom-template-registration-contract-v1",
        template_id: "custom_backend_python_generic",
        template_origin: "custom",
        template_source_id: "entry:custom_backend_python_generic",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        supported_role_types: ["worker-delivery"],
        artifact_layer: "code",
        coarse_template_role: "backend",
        role_layer: "backend",
        tech_layer: "python",
        framework_layer: "generic",
        mount_tree: "engineering",
        mount_path: ["backend"],
        supported_component_candidates: ["custom_api"],
        goal_matchers: ["custom", "api"],
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        overlay_capabilities: ["default_target_role_types", "ignored_overlay"],
        template_version: "v1",
        registration_source: "entry_worker_import",
        registered_at: "2026-03-11T00:00:00Z",
        enabled: true,
        role_default: false,
      }),
    ).toMatchObject({
      template_id: "custom_backend_python_generic",
      template_origin: "custom",
      template_source_id: "entry:custom_backend_python_generic",
      handler_script: "worker_templates/custom_echo_bundle.sh",
      overlay_capabilities: ["default_target_role_types"],
      template_version: "v1",
      registration_source: "entry_worker_import",
      enabled: true,
    });
    expect(
      normalizeCustomTemplateRegistration({
        template_id: "bad_custom",
        template_origin: "custom",
        template_source_id: "entry:bad_custom",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        artifact_layer: "code",
        role_layer: "backend",
        tech_layer: "python",
        framework_layer: "generic",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        budget_lane: "degraded",
      }),
    ).toBeNull();
    expect(
      buildCustomWorkerTemplateRegistry({
        taskMeta: {
          worker_runtime: {
            custom_template_registrations: [
              {
                template_id: "custom_backend_python_generic",
                template_origin: "custom",
                template_source_id: "entry:custom_backend_python_generic",
                handler_script: "worker_templates/custom_echo_bundle.sh",
                artifact_layer: "code",
                coarse_template_role: "backend",
                role_layer: "backend",
                tech_layer: "python",
                framework_layer: "generic",
                mount_tree: "engineering",
                mount_path: ["backend"],
                delivery_mode: "deterministic_python_bundle",
                template_kind: "concrete",
                template_version: "v1",
                registration_source: "entry_worker_import",
                registered_at: "2026-03-11T00:00:00Z",
                enabled: true,
              },
              {
                template_id: "alien_template",
                template_origin: "custom",
                template_source_id: "entry:alien_template",
                handler_script: "worker_templates/custom_echo_bundle.sh",
                artifact_layer: "alien",
                coarse_template_role: "backend",
                role_layer: "backend",
                tech_layer: "python",
                framework_layer: "generic",
                mount_tree: "engineering",
                mount_path: ["backend"],
                delivery_mode: "deterministic_python_bundle",
                template_kind: "concrete",
                template_version: "v1",
                registration_source: "entry_worker_import",
                registered_at: "2026-03-11T00:00:00Z",
                enabled: true,
              },
              {
                template_id: "disabled_template",
                template_origin: "custom",
                template_source_id: "entry:disabled_template",
                handler_script: "worker_templates/custom_echo_bundle.sh",
                artifact_layer: "code",
                coarse_template_role: "backend",
                role_layer: "backend",
                tech_layer: "python",
                framework_layer: "generic",
                mount_tree: "engineering",
                mount_path: ["backend"],
                delivery_mode: "deterministic_python_bundle",
                template_kind: "concrete",
                template_version: "v1",
                registration_source: "entry_worker_import",
                registered_at: "2026-03-11T00:00:00Z",
                enabled: false,
              },
            ],
          },
        },
      }).map((item) => item.template_id),
    ).toEqual(["custom_backend_python_generic"]);
  });

  it("filters disabled coarse template roles before deterministic template resolution", () => {
    const registry = buildCoarseTemplateRoleRegistry({
      taskMeta: {
        worker_runtime: {
          custom_coarse_template_roles: [
            {
              role_id: "frontend",
              display_name: "Frontend",
              domain_group: "engineering",
              enabled: false,
              compatibility_role_layer: "frontend",
            },
          ],
        },
      },
    });

    expect(registry.roles.find((item) => item.role_id === "frontend")?.enabled).toBe(false);
    expect(
      matchWorkerTemplate({
        taskMeta: {
          worker_runtime: {
            custom_coarse_template_roles: [
              {
                role_id: "frontend",
                display_name: "Frontend",
                domain_group: "engineering",
                enabled: false,
                compatibility_role_layer: "frontend",
              },
            ],
          },
        },
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "implement",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            coarse_template_role: "frontend",
            role_layer: "frontend",
            tech_layer: "typescript",
            framework_layer: "react",
            worker_stage_profile_hint: "normal",
            custom_overlay_layer: {
              overlay_id: "none",
              overlay_fields: [],
              config: {},
            },
          },
          component_candidates: ["frontend_ui"],
          goal: "Build frontend screen",
          preferred_template_ids: [],
        },
      }),
    ).toBeNull();
  });

  it("classifies budget lanes from token usage", () => {
    expect(
      buildWorkerBudgetContract({
        id: "task_demo",
        budget: { max_token_cost: 1000 },
        consumption: { token_cost_used: 100 },
      }).budget_lane,
    ).toBe("fast");
    expect(
      buildWorkerBudgetContract({
        id: "task_demo",
        budget: { max_token_cost: 1000 },
        consumption: { token_cost_used: 1000 },
      }).budget_lane,
    ).toBe("degraded");
    expect(
      buildWorkerBudgetContract({
        id: "task_demo",
        budget: { max_token_cost: 1000 },
        consumption: { token_cost_used: 2000 },
      }).budget_lane,
    ).toBe("reclaim_pending");
  });

  it("assembles worker runtime view and summary with topology", () => {
    const view = buildWorkerRuntimeView({
      taskMeta: {
        id: "task_demo",
        goal: "Build websocket calculator",
        project_id: "prj_demo",
        workspace_root: "prj_demo/runs/demo/workspace",
        budget: { max_token_cost: 1200 },
        consumption: { token_cost_used: 1200 },
        scheduler: {
          agent_type: "worker-delivery",
          queue_priority: 30,
          retry_count: 1,
        },
        worker_runtime: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          transaction_layer: "update",
          action_layer: "implement",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        worker_convergence: {
          convergence_class: "stalled",
          convergence_confidence: 0.4,
          progress_delta: 0,
          remaining_work_estimate: "needs_replan",
          reclaim_reason: "refinement_too_coarse",
          reported_at: "2026-03-09T00:00:00.000Z",
        },
      },
      splitPlan: {
        refinement_partition: {
          component_candidates: ["websocket_calculator", "calculator_transport"],
          leaf_units: [
            {
              module_id: "module_calculator",
              worker_task_id: "task_demo",
            },
          ],
          dependency_summary: {
            mode: "component_semantic_linearized",
            roots: 1,
            blocked: 1,
            links: 2,
            cross_module_links: 1,
          },
        },
      },
      taskDir: path.join("/repo", "tasks", "task_demo"),
      action: "retry",
      lane: "retry",
      mode: "local_threads",
      operation_id: "op_1",
      dispatch_seq: 2,
      now: "2026-03-09T00:00:10.000Z",
    });

    expect(view.semantic.component_candidates).toEqual(["websocket_calculator", "calculator_transport"]);
    expect(view.semantic.refinement_route_ref).toEqual({
      module_id: "module_calculator",
      refinement_task_id: "task_demo",
    });
    expect(view.semantic_topology).toMatchObject({
      transaction_layer: "update",
      action_layer: "implement",
      budget_layer: "degraded",
      convergence_layer: "stalled",
    });
    expect(view.implementation_topology).toMatchObject({
      artifact_layer: "code",
      role_layer: "backend",
      tech_layer: "python",
      framework_layer: "generic",
      worker_stage_profile_hint: "normal",
    });
    expect(view.worker_stage).toMatchObject({
      worker_stage_id: "workerstage_task_demo_op_1_2",
      worker_stage_profile: "normal",
      stage_isolation_mode: "wrapper_enforced",
      worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_2",
    });
    expect(view.cluster_projection).toEqual({
      schema_version: "worker-cluster-projection-v1",
      semantic_clusters: ["semantic.update.implement"],
      implementation_clusters: ["implementation.code.backend.python"],
      hybrid_clusters: ["hybrid.code.backend.implement"],
    });
    expect(view.selected_template).toMatchObject({
      template_id: "websocket_calculator",
      template_origin: "builtin",
      template_source_id: "builtin:websocket_calculator",
      template_version: "v1",
      registration_source: "builtin_registry",
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      handler_script: "worker_templates/websocket_calculator.sh",
      default_message_type: "partial_deliverable",
    });
    expect(view.lifecycle_governance).toMatchObject({
      schema_version: "worker-lifecycle-governance-contract-v1",
      policy_id: "worker_lifecycle_policy_default_v1",
      template_governance: {
        allowed_template_origins: ["builtin", "custom"],
        selected_template_origin: "builtin",
      },
      result_governance: {
        required_result_contract_version: "worker-template-result-contract-v1",
        strict_result_validation: true,
      },
    });

    const summary = buildWorkerRuntimeMetaSummary(view, {
      runtime_worker_control: {
        budget_status: "reclaim_pending",
      },
    });
    expect(summary.worker_runtime).toMatchObject({
      runtime_view_path: "worker_runtime_view.json",
      selected_template_id: "websocket_calculator",
      selected_template_origin: "builtin",
      selected_template_source_id: "builtin:websocket_calculator",
      template_version: "v1",
      registration_source: "builtin_registry",
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      governance_policy_id: "worker_lifecycle_policy_default_v1",
      refinement_route_ref: {
        module_id: "module_calculator",
        refinement_task_id: "task_demo",
      },
      result_contract_version: "worker-template-result-contract-v1",
      allowed_template_origins: ["builtin", "custom"],
      custom_registration_required: true,
      custom_runtime_gate_status: "not_applicable",
      agent_dispatch_capability: {
        schema_version: "scheduler-agent-dispatch-capability-v1",
        allowed_agent_types: ["worker-delivery"],
        selected_template_id: "websocket_calculator",
        selected_template_origin: "builtin",
        skill_gate_status: "allowed",
        dispatch_capability_class: "general",
      },
      default_message_type: "partial_deliverable",
      default_target_role_types: ["tester-ephemeral"],
      semantic_topology: view.semantic_topology,
      implementation_topology: view.implementation_topology,
      cluster_projection: view.cluster_projection,
    });
    expect(summary.worker_stage).toMatchObject({
      worker_stage_id: "workerstage_task_demo_op_1_2",
      worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_2",
      worker_stage_profile: "normal",
      stage_isolation_mode: "wrapper_enforced",
      stage_runtime_class: "default_shell",
      allowed_execution_mode: "local_threads",
      allocation: {
        worker_stage_overflow_policy: "block_write",
      },
      retention: {
        worker_stage_retention_policy: "retain_delivery_only",
        worker_stage_last_export_status: "",
        worker_stage_last_export_manifest_class: "",
        worker_stage_retention_result: {},
        worker_stage_last_cleanup_at: "",
        worker_stage_last_retained_artifact_ids: [],
      },
    });
    expect(summary.task_cluster).toMatchObject({
      cluster_root: "/repo/tasks/task_demo/task_cluster_workspace",
      default_target_role_types: ["tester-ephemeral"],
      cluster_projection: view.cluster_projection,
    });
    expect(summary.runtime_worker_control).toMatchObject({
      rebuild_ready: true,
    });
  });

  it("derives implementation topology, cluster projection, and memberships stably", () => {
    const implementation = buildWorkerImplementationTopology({
      semantic: {
        schema_version: "worker-semantic-contract-v1",
        task_id: "task_demo",
        goal: "frontend work",
        project_id: "prj_demo",
        workspace_root: "runtime/workdomains/demo",
        refinement_route_ref: {
          module_id: "module_frontend",
          refinement_task_id: "task_demo",
        },
        component_candidates: ["frontend_ui"],
        refinement_scope: "single_meta_input",
        refinement_strategy: "linear",
        refinement_principle: "engineering_decoupling",
        dependency_hint_summary: {
          mode: "component_semantic_linearized",
          roots: 1,
          blocked: 0,
          links: 0,
          cross_module_links: 0,
        },
        cluster_derivation_inputs: {
          project_id: "prj_demo",
          workspace_root: "runtime/workdomains/demo",
          component_candidates: ["frontend_ui"],
        },
        transaction_layer: "update",
        action_layer: "implement",
      },
      taskMeta: {
        worker_runtime: {
          role_layer: "frontend",
          tech_layer: "typescript",
          framework_layer: "react",
        },
      },
    });
    expect(implementation).toMatchObject({
      artifact_layer: "code",
      role_layer: "frontend",
      tech_layer: "typescript",
      framework_layer: "react",
    });
    const projection = buildWorkerClusterProjection({
      semantic: {
        transaction_layer: "update",
        action_layer: "implement",
        budget_layer: "fast",
        convergence_layer: "not_converged",
      },
      implementation,
    });
    const memberships = deriveTaskClusterMemberships({
      semantic: {
        schema_version: "worker-semantic-contract-v1",
        task_id: "task_demo",
        goal: "x",
        project_id: "prj_demo",
        workspace_root: "runtime/workdomains/demo",
        refinement_route_ref: {
          module_id: "module_frontend",
          refinement_task_id: "task_demo",
        },
        component_candidates: ["frontend_ui"],
        refinement_scope: "single_meta_input",
        refinement_strategy: "linear",
        refinement_principle: "engineering_decoupling",
        dependency_hint_summary: {
          mode: "component_semantic_linearized",
          roots: 1,
          blocked: 0,
          links: 0,
          cross_module_links: 0,
        },
        cluster_derivation_inputs: {
          project_id: "prj_demo",
          workspace_root: "runtime/workdomains/demo",
          component_candidates: ["frontend_ui"],
        },
        transaction_layer: "update",
        action_layer: "implement",
      },
      dispatch: {
        schema_version: "worker-dispatch-contract-v1",
        task_id: "task_demo",
        action: "dispatch",
        lane: "assigned_ready",
        mode: "local_threads",
        role_type: "tester-ephemeral",
        operation_id: "op_1",
        dispatch_seq: 1,
        retry_count: 0,
        queue_priority: 10,
        budget_lane: "fast",
        execution_target: {
          schema_version: "worker-milestone-set-v1",
          set_id: "milestone_set_task_demo_1",
          task_id: "task_demo",
          worker_instance_id: "workerstage_task_demo_op_1_1",
          generated_at: "2026-03-12T00:00:00Z",
          source: "scheduler",
          evaluation_window_seconds: 300,
          milestones: [
            {
              milestone_id: "task_complete",
              title: "task_complete",
              level: "core",
              required: true,
              status: "pending",
              progress_signal: "stage_write_activity",
              completion_evidence: { paths: [], markers: [], counts: {} },
              window_seconds: 300,
            },
          ],
          summary: {
            total_count: 1,
            required_count: 1,
            satisfied_count: 0,
            required_satisfied_count: 0,
            blocking_pending_count: 0,
            core_pending_count: 1,
            all_required_met: false,
            last_progress_at: "",
          },
        },
        history_handoff: {
          failure_pattern_summary: {
            schema_version: "worker-failure-pattern-summary-v1",
            task_id: "task_demo",
            worker_instance_id: "workerstage_task_demo_op_1_1",
            summary: { pattern_count: 0, top_risk_note: "" },
            patterns: [],
            read_contract: {
              mode: "bounded_guidance",
              agent_may_quote_raw_index: false,
              agent_may_request_additional_history: false,
              agent_must_treat_patterns_as_execution_constraints: true,
              agent_must_not_reinterpret_budget_policy: true,
            },
          },
          failure_pattern_index_refs: [],
        },
      },
      implementation,
      clusterProjection: projection,
    });
    expect(memberships).toContain("role:tester-ephemeral");
    expect(memberships).toContain("artifact:code");
    expect(memberships).toContain("impl_role:frontend");
    expect(memberships).toContain("cluster:implementation.code.frontend.typescript");

    expect(
      buildWorkerRuntimeControlSummary({
        previous: {
          budget_status: "reclaim_pending",
          last_fault_action_applied: "block",
          fault_actuation_mode: "enabled",
          fault_action_blocked_by_policy: true,
          worker_fault_class: "worker_stage_forbidden_write",
        },
        budgetLane: "fast",
        now: "2026-03-09T00:00:00Z",
      }),
    ).toMatchObject({
      budget_status: "fast",
      rebuild_ready: true,
      last_fault_action_applied: "block",
      fault_actuation_mode: "enabled",
      fault_action_blocked_by_policy: true,
      worker_fault_class: "worker_stage_forbidden_write",
    });
  });

  it("builds lifecycle governance and blocks disabled custom registrations", () => {
    const policy = buildSchedulerWorkerLifecyclePolicyTemplate();
    expect(policy).toMatchObject({
      policy_id: "worker_lifecycle_policy_default_v1",
      template_policy: {
        allow_builtin: true,
        allow_custom: true,
        require_enabled_custom_registration: true,
      },
      result_contract_policy: {
        required_result_contract_version: "worker-template-result-contract-v1",
      },
    });

    const governance = buildWorkerLifecycleGovernanceContract({
      taskMeta: {
        id: "task_demo",
        worker_runtime: {
          custom_template_registrations: [
            {
              template_id: "custom_backend_python_generic",
              template_origin: "custom",
              template_source_id: "entry:custom_backend_python_generic",
              template_version: "v1",
              registration_source: "entry_worker_import",
              registered_at: "2026-03-11T00:00:00Z",
              enabled: false,
              handler_script: "worker_templates/custom_echo_bundle.sh",
              artifact_layer: "code",
              coarse_template_role: "backend",
              role_layer: "backend",
              tech_layer: "python",
              framework_layer: "generic",
              mount_tree: "engineering",
              mount_path: ["backend"],
              delivery_mode: "deterministic_python_bundle",
              template_kind: "concrete",
            },
          ],
        },
      },
      budget: buildWorkerBudgetContract({ id: "task_demo", budget: { max_token_cost: 1000 }, consumption: {} }),
      dispatch: {
        schema_version: "worker-dispatch-contract-v1",
        task_id: "task_demo",
        action: "dispatch",
        lane: "assigned_ready",
        mode: "local_threads",
        role_type: "worker-delivery",
        operation_id: "op_1",
        dispatch_seq: 1,
        retry_count: 0,
        queue_priority: 10,
        budget_lane: "fast",
        execution_target: {
          schema_version: "worker-milestone-set-v1",
          set_id: "milestone_set_task_demo_custom_gate_1",
          task_id: "task_demo_custom_gate",
          worker_instance_id: "workerstage_task_demo_custom_gate_op_1",
          generated_at: "2026-03-12T00:00:00Z",
          source: "scheduler",
          evaluation_window_seconds: 300,
          milestones: [
            {
              milestone_id: "task_complete",
              title: "task_complete",
              level: "core",
              required: true,
              status: "pending",
              progress_signal: "stage_write_activity",
              completion_evidence: { paths: [], markers: [], counts: {} },
              window_seconds: 300,
            },
          ],
          summary: {
            total_count: 1,
            required_count: 1,
            satisfied_count: 0,
            required_satisfied_count: 0,
            blocking_pending_count: 0,
            core_pending_count: 1,
            all_required_met: false,
            last_progress_at: "",
          },
        },
        history_handoff: {
          failure_pattern_summary: {
            schema_version: "worker-failure-pattern-summary-v1",
            task_id: "task_demo_custom_gate",
            worker_instance_id: "workerstage_task_demo_custom_gate_op_1",
            summary: { pattern_count: 0, top_risk_note: "" },
            patterns: [],
            read_contract: {
              mode: "bounded_guidance",
              agent_may_quote_raw_index: false,
              agent_may_request_additional_history: false,
              agent_must_treat_patterns_as_execution_constraints: true,
              agent_must_not_reinterpret_budget_policy: true,
            },
          },
          failure_pattern_index_refs: [],
        },
      },
      implementationTopology: {
        artifact_layer: "code",
        role_layer: "backend",
        tech_layer: "python",
        framework_layer: "generic",
        worker_stage_profile_hint: "normal",
        custom_overlay_layer: {
          overlay_id: "custom",
          overlay_fields: ["default_target_role_types"],
          config: { default_target_role_types: ["tester-ephemeral"] },
        },
      },
      workerStage: {
        schema_version: "worker-stage-contract-v1",
        task_id: "task_demo",
        worker_stage_id: "workerstage_task_demo_op_1_1",
        worker_stage_profile: "normal",
        stage_isolation_mode: "wrapper_enforced",
        stage_runtime_class: "default_shell",
        allowed_execution_mode: "local_threads",
        worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1",
        scratch_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1/scratch",
        delivery_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1/delivery",
        inputs_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1/inputs",
        runtime_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1/runtime",
        mount_policy: {
          inputs_root: "read_only",
          scratch_root: "read_write",
          delivery_root: "write_only",
          cluster_mailbox: "append_only",
          authority_paths: "read_only",
        },
        allocation: {
          worker_stage_scope: "per_worker_instance",
          worker_stage_max_bytes: 1000000,
          worker_stage_max_file_count: 128,
          worker_stage_max_single_file_bytes: 256000,
          allow_binary_artifacts: false,
          worker_stage_overflow_policy: "block_write",
        },
        retention: {
          worker_stage_retention_policy: "retain_delivery_only",
          success_cleanup_rule: "retain_delivery_only",
          failure_cleanup_rule: "retain_evidence_bundle",
          purge_on_success: true,
          purge_on_failure: false,
        },
      },
      collaboration: {
        schema_version: "worker-collaboration-contract-v1",
        task_id: "task_demo",
        cluster_id: "cluster_demo",
        memberships: ["role:worker-delivery"],
        cluster_root: "/repo/task_cluster_workspace",
        workspace_root: "/repo/task_cluster_workspace",
        mailbox_path: "/repo/task_cluster_workspace/mailbox.ndjson",
        archive_path: "/repo/task_cluster_workspace/mailbox.archive.ndjson",
        message_type_allowlist: ["partial_deliverable", "dependency_update", "handoff_note"],
        default_target_role_types: ["tester-ephemeral"],
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
      selectedTemplate: {
        template_id: "custom_backend_python_generic",
        template_origin: "custom",
        template_source_id: "entry:custom_backend_python_generic",
        template_version: "v1",
        registration_source: "entry_worker_import",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
    });

    expect(governance.template_governance.selected_custom_registration_enabled).toBe(false);
    expect(governance.template_governance.selected_custom_runtime_gate_status).toBe("allowed");
    expect(governance.worker_stage_governance).toMatchObject({
      worker_stage_profile: "normal",
      stage_isolation_mode: "wrapper_enforced",
      stage_runtime_class: "default_shell",
      allowed_execution_mode: "local_threads",
      worker_stage_max_bytes: 1000000,
      worker_stage_max_file_count: 128,
      worker_stage_max_single_file_bytes: 256000,
      worker_stage_overflow_policy: "block_write",
      worker_stage_retention_policy: "retain_delivery_only",
      success_cleanup_rule: "retain_delivery_only",
      failure_cleanup_rule: "retain_evidence_bundle",
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
    });
    expect(governance.evidence_governance).toEqual({
      evidence_profile: "backend_profile",
      require_summary: true,
      require_test_command: true,
      require_changed_files: true,
      require_evidence_notes: true,
      require_runbook: true,
      allow_missing_test_command_with_reason: false,
    });
    expect(governance.overlay_governance.allowed_overlay_fields).toEqual([
      "delivery_expectations",
      "default_test_mode",
      "default_target_role_types",
    ]);
    expect(governance.mailbox_governance.default_target_role_types).toEqual(["tester-ephemeral"]);
  });

  it("blocks custom templates when capability envelope mismatches effective governance", () => {
    const governance = buildWorkerLifecycleGovernanceContract({
      taskMeta: {
        id: "task_demo_custom_gate",
        worker_runtime: {
          custom_template_registrations: [
            {
              schema_version: "custom-template-registration-contract-v1",
              template_id: "custom_backend_python_generic",
              template_origin: "custom",
              template_source_id: "entry:custom_backend_python_generic",
              template_version: "v1",
              registration_source: "entry_worker_import",
              registered_at: "2026-03-12T00:00:00Z",
              enabled: true,
              handler_script: "worker_templates/custom_echo_bundle.sh",
              supported_role_types: ["worker-delivery"],
              artifact_layer: "code",
              coarse_template_role: "backend",
              role_layer: "backend",
              tech_layer: "python",
              framework_layer: "generic",
              mount_tree: "engineering",
              mount_path: ["backend"],
              supported_component_candidates: ["custom_api"],
              goal_matchers: ["custom api"],
              delivery_mode: "deterministic_python_bundle",
              template_kind: "concrete",
              overlay_capabilities: ["default_test_mode"],
              allowed_runtime_classes: ["default_shell"],
              allowed_delivery_modes: ["unsupported_placeholder"],
              allowed_attachment_types: ["application/zip"],
              allowed_export_classes: ["delivery_manifest"],
              allowed_execution_mode: "local_threads",
              requires_evidence_profile: "frontend_profile",
              role_default: false,
            },
          ],
        },
      },
      budget: {
        schema_version: "worker-budget-contract-v1",
        task_id: "task_demo_custom_gate",
        max_token_cost: 50000,
        token_cost_used: 0,
        fast_token_budget: 50000,
        degraded_token_budget: 75000,
        reclaim_threshold: 100000,
        budget_lane: "fast",
      },
      dispatch: {
        schema_version: "worker-dispatch-contract-v1",
        task_id: "task_demo_custom_gate",
        action: "dispatch",
        lane: "assigned_ready",
        mode: "local_threads",
        role_type: "worker-delivery",
        operation_id: "op_1",
        dispatch_seq: 1,
        retry_count: 0,
        queue_priority: 10,
        budget_lane: "fast",
        execution_target: {
          schema_version: "worker-milestone-set-v1",
          set_id: "milestone_set_task_demo_custom_gate_1",
          task_id: "task_demo_custom_gate",
          worker_instance_id: "workerstage_task_demo_custom_gate_op_1",
          generated_at: "2026-03-12T00:00:00Z",
          source: "scheduler",
          evaluation_window_seconds: 300,
          milestones: [
            {
              milestone_id: "task_complete",
              title: "task_complete",
              level: "core",
              required: true,
              status: "pending",
              progress_signal: "stage_write_activity",
              completion_evidence: { paths: [], markers: [], counts: {} },
              window_seconds: 300,
            },
          ],
          summary: {
            total_count: 1,
            required_count: 1,
            satisfied_count: 0,
            required_satisfied_count: 0,
            blocking_pending_count: 0,
            core_pending_count: 1,
            all_required_met: false,
            last_progress_at: "",
          },
        },
        history_handoff: {
          failure_pattern_summary: {
            schema_version: "worker-failure-pattern-summary-v1",
            task_id: "task_demo_custom_gate",
            worker_instance_id: "workerstage_task_demo_custom_gate_op_1",
            summary: { pattern_count: 0, top_risk_note: "" },
            patterns: [],
            read_contract: {
              mode: "bounded_guidance",
              agent_may_quote_raw_index: false,
              agent_may_request_additional_history: false,
              agent_must_treat_patterns_as_execution_constraints: true,
              agent_must_not_reinterpret_budget_policy: true,
            },
          },
          failure_pattern_index_refs: [],
        },
      },
      implementationTopology: {
        artifact_layer: "code",
        role_layer: "backend",
        tech_layer: "python",
        framework_layer: "generic",
        worker_stage_profile_hint: "normal",
        custom_overlay_layer: {
          overlay_id: "none",
          overlay_fields: [],
          config: {},
        },
      },
      workerStage: {
        schema_version: "worker-stage-contract-v1",
        task_id: "task_demo_custom_gate",
        worker_stage_id: "workerstage_task_demo_custom_gate_op_1",
        worker_stage_profile: "normal",
        stage_isolation_mode: "wrapper_enforced",
        stage_runtime_class: "default_shell",
        allowed_execution_mode: "local_threads",
        worker_stage_root: "/repo/task/worker_stages/workerstage_task_demo_custom_gate_op_1",
        scratch_root: "/repo/task/worker_stages/workerstage_task_demo_custom_gate_op_1/scratch",
        delivery_root: "/repo/task/worker_stages/workerstage_task_demo_custom_gate_op_1/delivery",
        inputs_root: "/repo/task/worker_stages/workerstage_task_demo_custom_gate_op_1/inputs",
        runtime_root: "/repo/task/worker_stages/workerstage_task_demo_custom_gate_op_1/runtime",
        mount_policy: {
          inputs_root: "read_only",
          scratch_root: "read_write",
          delivery_root: "write_only",
          cluster_mailbox: "append_only",
          authority_paths: "read_only",
        },
        allocation: {
          worker_stage_scope: "per_worker_instance",
          worker_stage_max_bytes: 1_000_000,
          worker_stage_max_file_count: 128,
          worker_stage_max_single_file_bytes: 256_000,
          allow_binary_artifacts: false,
          worker_stage_overflow_policy: "block_write",
        },
        retention: {
          worker_stage_retention_policy: "retain_delivery_only",
          success_cleanup_rule: "retain_delivery_only",
          failure_cleanup_rule: "retain_evidence_bundle",
          purge_on_success: true,
          purge_on_failure: false,
        },
      },
      collaboration: {
        schema_version: "worker-collaboration-contract-v1",
        task_id: "task_demo_custom_gate",
        cluster_id: "cluster_demo",
        memberships: ["role:worker-delivery"],
        cluster_root: "/repo/task_cluster_workspace",
        workspace_root: "/repo/task_cluster_workspace",
        mailbox_path: "/repo/task_cluster_workspace/mailbox.ndjson",
        archive_path: "/repo/task_cluster_workspace/mailbox.archive.ndjson",
        message_type_allowlist: ["partial_deliverable", "dependency_update", "handoff_note"],
        default_target_role_types: ["tester-ephemeral"],
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
      selectedTemplate: {
        template_id: "custom_backend_python_generic",
        template_origin: "custom",
        template_source_id: "entry:custom_backend_python_generic",
        template_version: "v1",
        registration_source: "entry_worker_import",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
    });

    expect(governance.template_governance.selected_custom_runtime_gate_status).toBe("blocked");
    expect(governance.template_governance.selected_custom_capability_gate_reason).toBe(
      "delivery_mode_mismatch",
    );
  });

  it("selects templates across topology, component, fallback, and reserved placeholder paths", () => {
    const registry = buildWorkerTemplateRegistry();
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "implement",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            role_layer: "backend",
            tech_layer: "java",
            framework_layer: "spring",
            worker_stage_profile_hint: "normal",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("code_backend_java_spring");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "implement",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            role_layer: "frontend",
            tech_layer: "typescript",
            framework_layer: "react",
            worker_stage_profile_hint: "normal",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("code_frontend_typescript_react");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "implement",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            role_layer: "data",
            tech_layer: "python",
            framework_layer: "generic",
            worker_stage_profile_hint: "heavy",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("code_data_python_generic");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "integrate",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            role_layer: "infra",
            tech_layer: "generic",
            framework_layer: "generic",
            worker_stage_profile_hint: "heavy",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("code_infra_generic_generic");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "integrate",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "code",
            role_layer: "script_automation",
            tech_layer: "python",
            framework_layer: "generic",
            worker_stage_profile_hint: "light",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("code_script_automation_python_generic");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          semantic_topology: {
            transaction_layer: "update",
            action_layer: "implement",
            budget_layer: "fast",
            convergence_layer: "not_converged",
          },
          implementation_topology: {
            artifact_layer: "document_reserved",
            role_layer: "backend",
            tech_layer: "generic",
            framework_layer: "generic",
            worker_stage_profile_hint: "normal",
            custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
          },
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("document_reserved_placeholder");

    const selector = buildWorkerTemplateSelectorInput({
      semantic: {
        schema_version: "worker-semantic-contract-v1",
        task_id: "task_demo",
        goal: "Build websocket calculator",
        project_id: "prj_demo",
        workspace_root: "runtime/workdomains/demo",
        refinement_route_ref: {
          module_id: "module_calculator",
          refinement_task_id: "task_demo",
        },
        component_candidates: ["websocket_calculator"],
        refinement_scope: "single_meta_input",
        refinement_strategy: "linear",
        refinement_principle: "engineering_decoupling",
        dependency_hint_summary: {
          mode: "component_semantic_linearized",
          roots: 1,
          blocked: 0,
          links: 0,
          cross_module_links: 0,
        },
        cluster_derivation_inputs: {
          project_id: "prj_demo",
          workspace_root: "runtime/workdomains/demo",
          component_candidates: ["websocket_calculator"],
        },
        transaction_layer: "update",
        action_layer: "implement",
      },
      dispatch: {
        schema_version: "worker-dispatch-contract-v1",
        task_id: "task_demo",
        action: "dispatch",
        lane: "assigned_ready",
        mode: "local_threads",
        role_type: "worker-delivery",
        operation_id: "op_1",
        dispatch_seq: 1,
        retry_count: 0,
        queue_priority: 10,
        budget_lane: "fast",
        execution_target: {
          schema_version: "worker-milestone-set-v1",
          set_id: "milestone_set_task_demo_1",
          task_id: "task_demo",
          worker_instance_id: "workerstage_task_demo_op_1_1",
          generated_at: "2026-03-12T00:00:00Z",
          source: "scheduler",
          evaluation_window_seconds: 300,
          milestones: [
            {
              milestone_id: "task_complete",
              title: "task_complete",
              level: "core",
              required: true,
              status: "pending",
              progress_signal: "stage_write_activity",
              completion_evidence: { paths: [], markers: [], counts: {} },
              window_seconds: 300,
            },
          ],
          summary: {
            total_count: 1,
            required_count: 1,
            satisfied_count: 0,
            required_satisfied_count: 0,
            blocking_pending_count: 0,
            core_pending_count: 1,
            all_required_met: false,
            last_progress_at: "",
          },
        },
        history_handoff: {
          failure_pattern_summary: {
            schema_version: "worker-failure-pattern-summary-v1",
            task_id: "task_demo",
            worker_instance_id: "workerstage_task_demo_op_1_1",
            summary: { pattern_count: 0, top_risk_note: "" },
            patterns: [],
            read_contract: {
              mode: "bounded_guidance",
              agent_may_quote_raw_index: false,
              agent_may_request_additional_history: false,
              agent_must_treat_patterns_as_execution_constraints: true,
              agent_must_not_reinterpret_budget_policy: true,
            },
          },
          failure_pattern_index_refs: [],
        },
      },
      semanticTopology: {
        transaction_layer: "update",
        action_layer: "implement",
        budget_layer: "fast",
        convergence_layer: "not_converged",
      },
      implementationTopology: {
        artifact_layer: "code",
        role_layer: "backend",
        tech_layer: "python",
        framework_layer: "generic",
        worker_stage_profile_hint: "normal",
        custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
      },
    });
    expect(selector.preferred_template_ids).toContain("websocket_calculator");
    expect(matchWorkerTemplate({ selector, registry })?.template_id).toBe("websocket_calculator");
    expect(
      resolveWorkerSelectedTemplate({
        selector,
        collaboration: { default_target_role_types: ["tester-ephemeral"] },
      }),
    ).toMatchObject({
      template_id: "websocket_calculator",
      template_origin: "builtin",
      template_source_id: "builtin:websocket_calculator",
      handler_script: "worker_templates/websocket_calculator.sh",
      delivery_mode: "deterministic_python_bundle",
      template_kind: "concrete",
      default_target_role_types: ["tester-ephemeral"],
    });
    expect(
      matchWorkerTemplate({
        selector: {
          ...selector,
          preferred_template_ids: [],
          component_candidates: [],
        },
        registry,
      })?.template_id,
    ).toBe("websocket_calculator");

    const customTaskMeta = {
      worker_runtime: {
        custom_template_registrations: [
          {
            template_id: "custom_backend_python_generic",
            template_origin: "custom",
            template_source_id: "keeper:custom_backend_python_generic",
            handler_script: "worker_templates/custom_echo_bundle.sh",
            supported_role_types: ["worker-delivery"],
            artifact_layer: "code",
            coarse_template_role: "backend",
            role_layer: "backend",
            tech_layer: "python",
            framework_layer: "generic",
            mount_tree: "engineering",
            mount_path: ["backend"],
            supported_component_candidates: ["custom_api"],
            goal_matchers: ["custom", "api"],
            delivery_mode: "deterministic_python_bundle",
            template_kind: "concrete",
            overlay_capabilities: ["default_target_role_types"],
            template_version: "v1",
            registration_source: "keeper_worker_import",
            registered_at: "2026-03-11T00:00:00Z",
            enabled: true,
          },
        ],
      },
    };
    const customRegistry = buildWorkerTemplateRegistry({ taskMeta: customTaskMeta });
    const customSelector = {
      ...selector,
      component_candidates: ["custom_api"],
      goal: "Build custom backend api",
      preferred_template_ids: ["custom_backend_python_generic"],
    };
    expect(
      matchWorkerTemplate({
        selector: customSelector,
        taskMeta: customTaskMeta,
        registry: customRegistry,
      }),
    ).toMatchObject({
      template_id: "custom_backend_python_generic",
      template_origin: "custom",
    });
    expect(
      resolveWorkerSelectedTemplate({
        selector: customSelector,
        taskMeta: customTaskMeta,
        collaboration: { default_target_role_types: ["tester-ephemeral"] },
        registry: customRegistry,
      }),
    ).toMatchObject({
      template_id: "custom_backend_python_generic",
      template_origin: "custom",
      template_source_id: "keeper:custom_backend_python_generic",
      template_version: "v1",
      registration_source: "keeper_worker_import",
      default_target_role_types: ["tester-ephemeral"],
    });
  });

  it("builds keeper fingerprints deterministically", () => {
    expect(
      buildKeeperFeedbackFingerprint({
        feedbackType: "capacity_allocation_feedback",
        reason: "token_budget_exhausted",
        projectId: "prj_demo",
        componentCandidates: ["api", "worker"],
        budgetLane: "reclaim_pending",
      }),
    ).toBe(
      "capacity_allocation_feedback__token_budget_exhausted__prj_demo__api_worker__reclaim_pending",
    );
  });

  it("keeps meta template, schema, and worker doc aligned with runtime authority", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    const metaTemplate = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "templates/coordination/tasks/task_folders/_task_id_/meta.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const schema = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "agent-orchestrator/references/task-meta-schema.json"),
        "utf8",
      ),
    ) as { properties?: Record<string, unknown> };
    const workerDoc = await fs.readFile(path.join(repoRoot, "worker-delivery/SKILL.md"), "utf8");

    const workerRuntime = metaTemplate.worker_runtime as Record<string, unknown>;
    expect(workerRuntime.selected_template_id).toBe("");
    expect(workerRuntime.selected_template_origin).toBe("builtin");
    expect(workerRuntime.selected_template_source_id).toBe("");
    expect(workerRuntime.delivery_mode).toBe("unsupported_placeholder");
    expect(workerRuntime.template_kind).toBe("placeholder");
    expect(workerRuntime.template_version).toBe("");
    expect(workerRuntime.registration_source).toBe("");
    expect(workerRuntime.governance_policy_id).toBe("");
    expect(workerRuntime.result_contract_version).toBe("worker-template-result-contract-v1");
    expect(workerRuntime.allowed_template_origins).toEqual(["builtin", "custom"]);
    expect(workerRuntime.custom_registration_required).toBe(true);
    expect(workerRuntime.default_message_type).toBe("partial_deliverable");
    expect(workerRuntime.default_target_role_types).toEqual([]);
    expect(workerRuntime.custom_template_registrations).toEqual([]);
    expect(workerRuntime.semantic_topology).toBeTruthy();
    expect(workerRuntime.implementation_topology).toBeTruthy();
    expect(workerRuntime.cluster_projection).toBeTruthy();
    const workerStage = metaTemplate.worker_stage as Record<string, unknown>;
    const workerStageAllocation = workerStage.allocation as Record<string, unknown>;
    const workerStageRetention = workerStage.retention as Record<string, unknown>;
    expect(workerStage.stage_isolation_mode).toBe("wrapper_enforced");
    expect(workerStage.stage_runtime_class).toBe("default_shell");
    expect(workerStage.allowed_execution_mode).toBe("local_threads");
    expect(workerStageRetention.worker_stage_last_export_status).toBe("");
    expect(workerStageRetention.worker_stage_last_export_manifest_class).toBe("");
    expect(workerStageRetention.worker_stage_retention_result).toEqual({});
    expect(workerStageRetention.worker_stage_last_cleanup_at).toBe("");
    expect(workerStageRetention.worker_stage_last_retained_artifact_ids).toEqual([]);
    expect(workerStageAllocation.worker_stage_overflow_policy).toBe("");
    expect((schema.properties ?? {}).worker_runtime).toBeTruthy();
    expect((schema.properties ?? {}).worker_stage).toBeTruthy();
    expect((schema.properties ?? {}).task_cluster).toBeTruthy();
    expect((schema.properties ?? {}).runtime_worker_control).toBeTruthy();
    expect((schema.properties ?? {}).keeper_feedback).toBeTruthy();
    expect(workerDoc).toContain("coarse_template_role");
    expect(workerDoc).toContain("selected_template");
    expect(workerDoc).toContain("ASSIGNED -> IN_PROGRESS");
    expect(workerDoc).toContain("worker_runtime_view.json");
  });
});
