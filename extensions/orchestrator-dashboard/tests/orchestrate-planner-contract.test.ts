import {
  buildDefaultPlannerAgentPolicy,
  buildDefaultPlannerPolicyDocument,
  buildPlannerRequestEnvelope,
  buildPlannerRequestView,
  extractPlannerAgentPolicy,
  extractPlannerDecision,
  extractPlannerDecisionEnvelope,
  extractPlannerPolicyDocument,
  extractSplitPlan,
} from "../orchestrate-planner-contract.js";
import { PlannerContractError } from "../orchestrate-planner-errors.js";
import { describe, expect, it } from "vitest";

function expectPlannerContractError(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error("expected planner contract error");
  } catch (error) {
    expect(error).toBeInstanceOf(PlannerContractError);
    expect((error as PlannerContractError).code).toBe(code);
  }
}

describe("orchestrate planner contract", () => {
  it("builds default planner agent policy when runtime config is missing", () => {
    expect(buildDefaultPlannerAgentPolicy()).toEqual({
      llm_role: "primary",
      token_priority: {
        tier: "highest",
        reserved_ratio: 0.35,
        min_planning_tokens: 1200,
        max_planning_tokens: 6000,
        allow_inline_override: true,
      },
      mcp_soft_boundary: {
        mode: "bias_plan",
        include_namespace: true,
        include_read_only: true,
        include_profile_name: true,
        include_isolation_enabled: true,
      },
      granularity_guardrails: {
        mode: "soft",
        meta_units: {
          min: 1,
          max: 4,
        },
        leaf_units_per_meta: {
          min_meaningful_scope: "component_sized",
          max: 8,
        },
        allow_agent_override_with_reason: true,
      },
    });
    expect(extractPlannerAgentPolicy(undefined).llm_role).toBe("primary");
  });

  it("builds default planner policy documents with a versioned schema", () => {
    expect(buildDefaultPlannerPolicyDocument()).toEqual({
      schema_version: "planner-policy-v1",
      policy_id: "planner_default",
      updated_at: "2026-03-03T00:00:00Z",
      planner_agent: expect.objectContaining({
        llm_role: "primary",
      }),
      execution_targets: {
        local_threads: { enabled: true },
        container: { enabled: false, planner_transport: "reserved" },
        distributed: {
          enabled: false,
          planner_transport: "reserved",
          dispatch_endpoint: "",
        },
      },
      compat: {
        allow_agent_runtime_fallback: true,
      },
    });
    expect(extractPlannerPolicyDocument(undefined).schema_version).toBe("planner-policy-v1");
  });

  it("builds planner request envelopes from task-local strategy and meta", () => {
    const envelope = buildPlannerRequestEnvelope({
      strategy: {
        task_id: "task_demo",
        goal: "Build websocket calculator",
        budget: { max_execution_time_seconds: 3600 },
        workspace: { project_id: "prj_demo" },
        summary_input: { task_goal: "Build websocket calculator", constraints: ["python only"] },
      },
      meta: {
        id: "task_demo",
        parent_task_id: "task_parent",
      },
      runtime: {
        agent_runtime_isolation: {
          enabled: true,
          orchestrator_profile_name: "orchestrator_control",
          project_profile_name: "project_execution",
          orchestrator_namespace: { mcp_dir: ".openclaw-system/mcp" },
          project_namespace: { mcp_dir: ".openclaw-project/mcp" },
        },
      },
      policy: extractPlannerPolicyDocument({
        policy_id: "planner_custom",
        execution_targets: {
          container: {
            enabled: true,
            planner_transport: "reserved",
          },
        },
      }),
      executionTarget: "container",
    });

    expect(envelope).toEqual({
      schema_version: "planner-request-v1",
      request_id: "planner_request_task_demo",
      task: {
        task_id: "task_demo",
        parent_task_id: "task_parent",
        task_goal: "Build websocket calculator",
      },
      source: {
        summary_input: { task_goal: "Build websocket calculator", constraints: ["python only"] },
        budget: { max_execution_time_seconds: 3600 },
        workspace: { project_id: "prj_demo" },
      },
      policy: expect.objectContaining({
        schema_version: "planner-policy-v1",
        policy_id: "planner_custom",
      }),
      runtime_context: {
        agent_runtime_isolation: expect.objectContaining({
          enabled: true,
        }),
        execution_target: "container",
      },
      compat: {
        request_authority: "task_local_strategy_meta",
      },
    });
  });

  it("derives planner request views from the request envelope contract", () => {
    const request = buildPlannerRequestView({
      strategy: {
        task_id: "task_demo",
        goal: "Build websocket calculator",
        budget: { max_execution_time_seconds: 3600 },
        workspace: { project_id: "prj_demo" },
        summary_input: { task_goal: "Build websocket calculator", constraints: ["python only"] },
      },
      meta: {
        id: "task_demo",
        parent_task_id: "task_parent",
      },
      runtime: {
        planner_agent: {
          token_priority: { min_planning_tokens: 2400 },
        },
        agent_runtime_isolation: {
          enabled: true,
          orchestrator_profile_name: "orchestrator_control",
          project_profile_name: "project_execution",
          orchestrator_namespace: { mcp_dir: ".openclaw-system/mcp" },
          project_namespace: { mcp_dir: ".openclaw-project/mcp" },
        },
      },
    });

    expect(request).toEqual({
      task_id: "task_demo",
      parent_task_id: "task_parent",
      task_goal: "Build websocket calculator",
      summary_input: { task_goal: "Build websocket calculator", constraints: ["python only"] },
      budget: { max_execution_time_seconds: 3600 },
      workspace: { project_id: "prj_demo" },
      authority_input: "task_local_strategy_meta",
      planner_agent_policy: expect.objectContaining({
        llm_role: "primary",
      }),
      runtime_isolation: expect.objectContaining({
        enabled: true,
      }),
      mcp_soft_boundary_context: expect.objectContaining({
        enabled: true,
        execution_target: "local_threads",
      }),
    });
  });

  it("normalizes planner decisions into the internal contract shape", () => {
    const decision = extractPlannerDecision({
      decision_source: "planner_llm",
      decision_reason: "parallel modules",
      decision_signals: { estimated_minutes: 180 },
      planner_phase: "initial_plan",
      decomposition_strategy: "module_first",
      release_policy: "immediate_first_wave",
      request_authority: "task_local_strategy_meta",
      llm_role: "primary",
      llm_decision_used: true,
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
        decision_source: "planner_llm",
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
        refinement_rationale: ["component-sized execution units"],
      },
      granularity_guardrails: {
        mode: "soft",
        fragment_upper_bound: {
          max_meta_units: 4,
          max_leaf_units_per_meta: 8,
        },
        fragment_lower_bound: {
          min_meaningful_meta_units: 1,
          min_meaningful_leaf_scope: "component_sized",
        },
        guardrail_triggered: false,
        guardrail_notes: [],
      },
      agent_contract_version: "planner-core-v2",
    });

    expect(decision).toEqual({
      decision_source: "planner_llm",
      decision_reason: "parallel modules",
      decision_signals: { estimated_minutes: 180 },
      planner_phase: "initial_plan",
      decomposition_strategy: "module_first",
      release_policy: "immediate_first_wave",
      request_authority: "task_local_strategy_meta",
      llm_role: "primary",
      llm_decision_used: true,
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
        decision_source: "planner_llm",
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
        refinement_rationale: ["component-sized execution units"],
      },
      granularity_guardrails: {
        mode: "soft",
        fragment_upper_bound: {
          max_meta_units: 4,
          max_leaf_units_per_meta: 8,
        },
        fragment_lower_bound: {
          min_meaningful_meta_units: 1,
          min_meaningful_leaf_scope: "component_sized",
        },
        guardrail_triggered: false,
        guardrail_notes: [],
      },
      agent_contract_version: "planner-core-v2",
    });
  });

  it("extracts planner decision envelopes with initial partitions", () => {
    const envelope = extractPlannerDecisionEnvelope({
      schema_version: "planner-decision-v1",
      decision_id: "planner_decision_task_demo",
      request_id: "planner_request_task_demo",
      task_id: "task_demo",
      planner_decision: {
        decision_source: "planner_rules_fallback",
        decision_reason: "guardrail override",
        decision_signals: { strong_multi: true },
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        meta_decomposition: {
          decision_source: "planner_rules_fallback",
          decomposition_strategy: "meta_module_partition",
          meta_unit_count: 2,
          primary_principle: "functional_decoupling",
          decoupling_confidence: "medium",
          decoupling_rationale: ["functional boundaries identified"],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          primary_principle: "engineering_decoupling",
          component_candidates: ["protocol_schema", "transport_adapter"],
        },
        granularity_guardrails: {
          mode: "soft",
          fragment_upper_bound: {
            max_meta_units: 4,
            max_leaf_units_per_meta: 8,
          },
          fragment_lower_bound: {
            min_meaningful_meta_units: 1,
            min_meaningful_leaf_scope: "component_sized",
          },
          guardrail_triggered: true,
          guardrail_notes: ["expanded to stay within the upper bound"],
        },
        agent_contract_version: "planner-core-v2",
      },
      initial_partition: {
        strategy: "meta_module_partition",
        modules: [
          { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
          { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
        ],
      },
      apply_contract: {
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [
            { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
            { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
          ],
        },
        worker_refinement: {
          required: true,
          refinement_strategy: "linear_split_units_placeholder",
          refinement_scope: "multi_meta_input",
          component_candidates: ["protocol_schema", "transport_adapter"],
        },
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
      },
      execution_target: "distributed",
      compat: {
        agent_contract_version: "planner-core-v2",
      },
    });
    expect(envelope).toEqual(
      expect.objectContaining({
        schema_version: "planner-decision-v1",
        decision_id: "planner_decision_task_demo",
        request_id: "planner_request_task_demo",
        task_id: "task_demo",
        planner_decision: expect.objectContaining({
          meta_decomposition: expect.objectContaining({
            meta_unit_count: 2,
            primary_principle: "functional_decoupling",
          }),
          granularity_guardrails: expect.objectContaining({
            guardrail_triggered: true,
          }),
        }),
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
          modules: [
            expect.objectContaining({
              module_id: "meta_unit_001",
              module_title: "module_1",
              child_tasks: [],
            }),
            expect.objectContaining({
              module_id: "meta_unit_002",
              module_title: "module_2",
              child_tasks: [],
            }),
          ],
        }),
        split_plan_summary: {
          planner_phase: "initial_plan",
          decomposition_strategy: "module_first",
          release_policy: "immediate_first_wave",
        },
        apply_contract: expect.objectContaining({
          initial_partition: expect.objectContaining({
            strategy: "meta_module_partition",
            modules: [
              expect.objectContaining({
                module_id: "meta_unit_001",
                module_title: "module_1",
                child_tasks: [],
              }),
              expect.objectContaining({
                module_id: "meta_unit_002",
                module_title: "module_2",
                child_tasks: [],
              }),
            ],
          }),
          worker_refinement: expect.objectContaining({
            required: true,
            refinement_strategy: "linear_split_units_placeholder",
            refinement_scope: "multi_meta_input",
            primary_principle: "engineering_decoupling",
            component_candidates: ["protocol_schema", "transport_adapter"],
          }),
          decomposition_strategy: "module_first",
          release_policy: "immediate_first_wave",
        }),
        execution_target: "distributed",
        compat: {
          agent_contract_version: "planner-core-v2",
        },
      }),
    );
  });

  it("extracts split plans as planner split artifacts instead of raw counts only", () => {
    const splitPlan = extractSplitPlan({
      task_id: "task_demo",
      planner_phase: "initial_plan",
      decomposition_strategy: "module_first",
      release_policy: "immediate_first_wave",
      initial_partition: {
        strategy: "meta_module_partition",
        modules: [
          { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
          { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
        ],
      },
      refinement_partition: {
        strategy: "linear_split_units_placeholder",
        input_scope: "multi_meta_input",
        granularity: "temporary_refinement_granularity",
        component_candidates: ["protocol_schema", "transport_adapter"],
        leaf_units: [
          {
            leaf_id: "leaf_1",
            module_id: "meta_unit_001",
            module_title: "module_1",
            component_candidate: "protocol_schema",
            depends_on_component_candidates: [],
            depends_on_leaf_ids: [],
            stage_id: "stage_1",
            sequence: 1,
            total_units: 2,
            release_state: "immediate_first_wave",
            child_task_id: "task_demo_c001",
          },
          {
            leaf_id: "leaf_2",
            module_id: "meta_unit_002",
            module_title: "module_2",
            component_candidate: "transport_adapter",
            depends_on_component_candidates: ["protocol_schema"],
            depends_on_leaf_ids: ["leaf_1"],
            stage_id: "stage_2",
            sequence: 2,
            total_units: 2,
            release_state: "immediate_first_wave",
            child_task_id: "task_demo_c002",
          },
        ],
        backlog: [],
      },
      decision_context: { llm_role: "primary", agent_contract_version: "planner-core-v2" },
      split_units_planned: 3,
    });

    expect(splitPlan).toEqual(
      expect.objectContaining({
        schema_version: "planner-split-plan-v1",
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: expect.objectContaining({
          strategy: "meta_module_partition",
        }),
        refinement_partition: expect.objectContaining({
          strategy: "linear_split_units_placeholder",
          dependency_summary: expect.objectContaining({
            mode: "component_semantic_linearized",
            roots: 1,
            blocked: 1,
          }),
        }),
      }),
    );
  });

  it("fails split-plan extraction when leaf dependency points to missing leaf", () => {
    expectPlannerContractError(
      () =>
      extractSplitPlan({
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [
            { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
            { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
          ],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          granularity: "temporary_refinement_granularity",
          component_candidates: ["protocol_schema", "transport_adapter"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "meta_unit_001",
              module_title: "module_1",
              component_candidate: "transport_adapter",
              depends_on_component_candidates: ["protocol_schema"],
              depends_on_leaf_ids: ["leaf_999"],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 2,
              release_state: "immediate_first_wave",
            },
          ],
          backlog: [],
        },
      }),
      "MISSING_DEPENDENCY_LEAF",
    );
  });

  it("fails split-plan extraction when required leaf ownership fields are missing", () => {
    expectPlannerContractError(
      () =>
      extractSplitPlan({
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [{ module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] }],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "single_meta_input",
          granularity: "temporary_refinement_granularity",
          component_candidates: ["implementation_unit"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_title: "module_1",
              depends_on_component_candidates: [],
              depends_on_leaf_ids: [],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 1,
              release_state: "immediate_first_wave",
            },
          ],
          backlog: [],
        },
      }),
      "MISSING_FIELD",
    );
  });

  it("fails split-plan extraction when leaf depends on itself", () => {
    expectPlannerContractError(
      () =>
      extractSplitPlan({
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "single_path",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_single_unit",
          modules: [{ module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] }],
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
              module_title: "module_1",
              component_candidate: "implementation_unit",
              depends_on_component_candidates: ["implementation_unit"],
              depends_on_leaf_ids: ["leaf_1"],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 1,
              release_state: "immediate_first_wave",
            },
          ],
          backlog: [],
        },
      }),
      "SELF_DEPENDENCY",
    );
  });

  it("fails split-plan extraction when dependency points to future sequence", () => {
    expectPlannerContractError(
      () =>
      extractSplitPlan({
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [
            { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
            { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
          ],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          granularity: "temporary_refinement_granularity",
          component_candidates: ["protocol_schema", "transport_adapter"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "meta_unit_001",
              module_title: "module_1",
              component_candidate: "transport_adapter",
              depends_on_component_candidates: ["protocol_schema"],
              depends_on_leaf_ids: ["leaf_2"],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 2,
              release_state: "immediate_first_wave",
            },
            {
              leaf_id: "leaf_2",
              module_id: "meta_unit_002",
              module_title: "module_2",
              component_candidate: "protocol_schema",
              depends_on_component_candidates: [],
              depends_on_leaf_ids: [],
              stage_id: "stage_2",
              sequence: 2,
              total_units: 2,
              release_state: "immediate_first_wave",
            },
          ],
          backlog: [],
        },
      }),
      "FUTURE_DEPENDENCY",
    );
  });

  it("fails split-plan extraction on component dependency mismatch", () => {
    expectPlannerContractError(
      () =>
      extractSplitPlan({
        task_id: "task_demo",
        planner_phase: "initial_plan",
        decomposition_strategy: "module_first",
        release_policy: "immediate_first_wave",
        initial_partition: {
          strategy: "meta_module_partition",
          modules: [
            { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
            { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
          ],
        },
        refinement_partition: {
          strategy: "linear_split_units_placeholder",
          input_scope: "multi_meta_input",
          granularity: "temporary_refinement_granularity",
          component_candidates: ["protocol_schema", "transport_adapter"],
          leaf_units: [
            {
              leaf_id: "leaf_1",
              module_id: "meta_unit_001",
              module_title: "module_1",
              component_candidate: "api_contract",
              depends_on_component_candidates: [],
              depends_on_leaf_ids: [],
              stage_id: "stage_1",
              sequence: 1,
              total_units: 2,
              release_state: "immediate_first_wave",
            },
            {
              leaf_id: "leaf_2",
              module_id: "meta_unit_002",
              module_title: "module_2",
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
      }),
      "COMPONENT_DEPENDENCY_MISMATCH",
    );
  });

  it("fails split-plan extraction when dependency summary mode mismatches semantics", () => {
    expectPlannerContractError(
      () =>
        extractSplitPlan({
          task_id: "task_demo",
          planner_phase: "initial_plan",
          decomposition_strategy: "single_path",
          release_policy: "immediate_first_wave",
          initial_partition: {
            strategy: "meta_single_unit",
            modules: [{ module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] }],
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
                module_title: "module_1",
                component_candidate: "implementation_unit",
                depends_on_component_candidates: [],
                depends_on_leaf_ids: [],
                stage_id: "stage_1",
                sequence: 1,
                total_units: 1,
                release_state: "immediate_first_wave",
              },
            ],
            dependency_summary: {
              mode: "scheduler_dag",
              roots: 1,
              blocked: 0,
              links: 0,
              cross_module_links: 0,
              note: "planning_hint_not_scheduler_dag",
            },
            backlog: [],
          },
        }),
      "TYPE_MISMATCH",
    );
  });

  it("fails split-plan extraction when dependency summary note mismatches defaults", () => {
    expectPlannerContractError(
      () =>
        extractSplitPlan({
          task_id: "task_demo",
          planner_phase: "initial_plan",
          decomposition_strategy: "single_path",
          release_policy: "immediate_first_wave",
          initial_partition: {
            strategy: "meta_single_unit",
            modules: [{ module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] }],
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
                module_title: "module_1",
                component_candidate: "implementation_unit",
                depends_on_component_candidates: [],
                depends_on_leaf_ids: [],
                stage_id: "stage_1",
                sequence: 1,
                total_units: 1,
                release_state: "immediate_first_wave",
              },
            ],
            dependency_summary: {
              mode: "component_semantic_linearized",
              roots: 1,
              blocked: 0,
              links: 0,
              cross_module_links: 0,
              note: "invalid_note",
            },
            backlog: [],
          },
        }),
      "TYPE_MISMATCH",
    );
  });

  it("fails split-plan extraction when dependency summary totals do not match leaf graph", () => {
    expectPlannerContractError(
      () =>
        extractSplitPlan({
          task_id: "task_demo",
          planner_phase: "initial_plan",
          decomposition_strategy: "module_first",
          release_policy: "immediate_first_wave",
          initial_partition: {
            strategy: "meta_module_partition",
            modules: [
              { module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] },
              { module_id: "meta_unit_002", module_title: "module_2", child_tasks: [] },
            ],
          },
          refinement_partition: {
            strategy: "linear_split_units_placeholder",
            input_scope: "multi_meta_input",
            granularity: "temporary_refinement_granularity",
            component_candidates: ["protocol_schema", "transport_adapter"],
            leaf_units: [
              {
                leaf_id: "leaf_1",
                module_id: "meta_unit_001",
                module_title: "module_1",
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
                module_id: "meta_unit_002",
                module_title: "module_2",
                component_candidate: "transport_adapter",
                depends_on_component_candidates: ["protocol_schema"],
                depends_on_leaf_ids: ["leaf_1"],
                stage_id: "stage_2",
                sequence: 2,
                total_units: 2,
                release_state: "immediate_first_wave",
              },
            ],
            dependency_summary: {
              mode: "component_semantic_linearized",
              roots: 1,
              blocked: 1,
              links: 0,
              cross_module_links: 1,
              note: "planning_hint_not_scheduler_dag",
            },
            backlog: [],
          },
        }),
      "TYPE_MISMATCH",
    );
  });

  it("legacy_v0_deprecation_guard: migrates split plan without schema_version to v1", () => {
    const splitPlan = extractSplitPlan({
      task_id: "task_demo",
      planner_phase: "initial_plan",
      decomposition_strategy: "single_path",
      release_policy: "immediate_first_wave",
      initial_partition: {
        strategy: "meta_single_unit",
        modules: [{ module_id: "meta_unit_001", module_title: "module_1", child_tasks: [] }],
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
            module_title: "module_1",
            component_candidate: "implementation_unit",
            depends_on_component_candidates: [],
            depends_on_leaf_ids: [],
            stage_id: "stage_1",
            sequence: 1,
            total_units: 1,
            release_state: "immediate_first_wave",
          },
        ],
        backlog: [],
      },
    });

    expect(splitPlan.schema_version).toBe("planner-split-plan-v1");
  });

  it("legacy_v0_deprecation_guard: fails fast when legacy split plan cannot migrate", () => {
    expectPlannerContractError(
      () =>
        extractSplitPlan({
          task_id: "task_demo",
          planner_phase: "initial_plan",
          decomposition_strategy: "single_path",
          release_policy: "immediate_first_wave",
          initial_partition: {
            strategy: "meta_single_unit",
            modules: [],
          },
          refinement_partition: {
            strategy: "linear_split_units_placeholder",
            input_scope: "single_meta_input",
            granularity: "",
            component_candidates: ["implementation_unit"],
            leaf_units: [],
            backlog: [],
          },
        }),
      "MISSING_FIELD",
    );
  });
});
