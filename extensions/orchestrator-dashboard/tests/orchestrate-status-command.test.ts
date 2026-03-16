import { handleStatusSubcommand } from "../orchestrate-status-command.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate-status-command", () => {
  it("renders structured split-plan details for task status", async () => {
    const store = new Map<string, unknown>([
      [
        "/repo/tasks/task_demo/meta.json",
        {
          state: "ASSIGNED",
          version: 1,
          planner_replan: {
            status: "applied",
            impact: "refresh_required",
            worker_policy: "revalidate_then_resume",
            scope_summary: ["workspace", "budget"],
            requested_at: "2026-03-02T00:10:00Z",
            applied_at: "2026-03-02T00:10:30Z",
          },
          runtime_replan: {
            consume_status: "awaiting_revalidation",
            consumed_at: "2026-03-02T00:10:30Z",
          },
          worker_budget: {
            budget_lane: "degraded",
          },
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
            semantic_topology: {
              transaction_layer: "update",
              action_layer: "implement",
            },
            implementation_topology: {
              artifact_layer: "code",
              role_layer: "backend",
              tech_layer: "java",
            },
            cluster_projection: {
              implementation_clusters: ["implementation.code.backend.java"],
            },
          },
          worker_convergence: {
            convergence_class: "partial_deliverable",
            reclaim_reason: "",
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
            last_submitted_at: "2026-03-02T00:11:00Z",
          },
          runtime_worker_control: {
            rebuild_ready: true,
            rebuild_reason: "budget_or_refinement_amendment",
          },
          split_units_planned: 2,
          children: ["task_demo_c001", "task_demo_c002"],
          planning_decision: {
            decision_source: "manual_override",
            decision_reason: "manual override multi",
            meta_decomposition: {
              decision_source: "manual_override",
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
          },
        },
      ],
      [
        "/repo/tasks/task_demo/split_plan.json",
        {
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
            component_candidates: ["protocol_schema", "transport_adapter"],
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
              },
              {
                leaf_id: "leaf_2",
                module_id: "module_002",
                module_title: "core_logic",
                component_candidate: "transport_adapter",
                depends_on_component_candidates: ["protocol_schema"],
                depends_on_leaf_ids: ["leaf_1"],
                stage_id: "stage_2",
                sequence: 2,
                total_units: 2,
                release_state: "immediate_first_wave",
              },
            ],
            backlog: [],
          },
          decision_context: {
            meta_decomposition: {
              decision_source: "manual_override",
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
        },
      ],
    ]);

    const text = await handleStatusSubcommand({
      payload: "task_demo",
      cfg: {
        runnerEnabled: false,
        runnerFallbackEnabled: false,
      },
      ensureRunnerStarted: vi.fn(async () => undefined),
      paths: {
        dashboardJson: "/repo/dashboard.json",
        systemHealthJson: "/repo/system_health.json",
        taskFoldersRoot: "/repo/tasks",
      },
      io: {
        fileExists: vi.fn(async (targetPath: string) => {
          return store.has(targetPath) || targetPath === "/repo/tasks/task_demo/log.ndjson";
        }),
        readJsonOrDefault: async <T,>(targetPath: string, fallback: T): Promise<T> => {
          return (store.has(targetPath) ? store.get(targetPath) : fallback) as T;
        },
        readNdjson: vi.fn(async () => []),
        readText: vi.fn(async () => ""),
      },
      runtime: {
        getRunnerLockMtime: vi.fn(async () => ""),
        loadExecutionRuntime: vi.fn(async () => ({
          logicalThreads: 8,
          effectiveWorkerThreads: 4,
          parallelLimit: 2,
          queueDepth: 1,
          policyMode: "enforce",
          rolePolicyPath: "templates/coordination/security/role_permissions.effective.json",
          workdomainRoot: "runtime/workdomains",
          projectsRoot: "projects",
          aclDeniedCount: 0,
          aclLastDeniedAt: "",
          sandboxEnabled: true,
          commitGuardEnabled: true,
          kbImportConfirmRequired: false,
          kbImportAutoEnabled: false,
          workspaceSyncSensitivity: "normal",
          skillMcpIsolationEnabled: true,
          protectOrchestratorConfig: true,
          projectRuntimeProfile: "default",
          orchestratorRuntimeProfile: "default",
        })),
        getExternalRunnerStatus: vi.fn(async () => ({
          running: false,
          pid: 0,
          lastTickAt: "",
          lastExitCode: "",
        })),
        getRunnerSnapshot: vi.fn(() => ({
          runnerStatus: "started" as const,
          runnerLastTickAt: "",
          runnerLastTickResult: "ok" as const,
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
          runnerTimerActive: true,
        })),
        getConsistencySnapshot: vi.fn(() => ({
          runtimeConsistency: "ok" as const,
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        })),
      },
      renderOrchestrateHelp: () => "help",
    });

    expect(text).toContain("decomposition_strategy: module_first");
    expect(text).toContain("planner_replan_status: applied");
    expect(text).toContain("planner_replan_impact: refresh_required");
    expect(text).toContain("planner_replan_worker_policy: revalidate_then_resume");
    expect(text).toContain("runtime_replan_consume_status: awaiting_revalidation");
    expect(text).toContain("worker_budget_lane: degraded");
    expect(text).toContain("worker_convergence_class: partial_deliverable");
    expect(text).toContain("task_cluster_id: cluster_demo");
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
    expect(text).toContain("task_cluster_last_message_type: handoff_note");
    expect(text).toContain("keeper_feedback_types: capacity_allocation_feedback");
    expect(text).toContain("keeper_feedback_fingerprints: fp_1");
    expect(text).toContain("worker_rebuild_ready: true");
    expect(text).toContain("planner_replan_scope_summary: workspace, budget");
    expect(text).toContain("initial_partition_strategy: meta_module_partition");
    expect(text).toContain("initial_meta_units: 2");
    expect(text).toContain("initial_decoupling_principle: functional_decoupling");
    expect(text).toContain("worker_refinement_scope: multi_meta_input");
    expect(text).toContain("worker_refinement_principle: engineering_decoupling");
    expect(text).toContain("worker_refinement_component_candidates: protocol_schema, transport_adapter");
    expect(text).toContain("granularity_guardrail_triggered: true");
    expect(text).toContain("initial_partition_modules: 2");
    expect(text).toContain("refinement_component_candidates: 2");
    expect(text).toContain("refinement_component_bound_leafs: 2");
    expect(text).toContain("refinement_dependency_mode: component_semantic_linearized");
    expect(text).toContain("refinement_dependency_roots: 1");
    expect(text).toContain("refinement_dependency_blocked: 1");
    expect(text).toContain("refinement_dependency_links: 1");
    expect(text).toContain("refinement_cross_module_links: 1");
    expect(text).toContain("refinement_dependency_note: planning_hint_not_scheduler_dag");
    expect(text).toContain("refinement_leaf_units: 2");
    expect(text).toContain("planner_llm_role: primary");
    expect(text).toContain("planner_effective_tokens: 2400");
    expect(text).toContain("planner_agent_contract_version: planner-core-v2");
  });
});
