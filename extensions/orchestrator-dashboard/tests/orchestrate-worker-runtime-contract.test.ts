import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkerRuntimeControlSummary,
  buildKeeperFeedbackFingerprint,
  buildWorkerBudgetContract,
  buildWorkerRuntimeMetaSummary,
  buildWorkerRuntimeView,
  buildWorkerTemplateRegistry,
  buildWorkerTemplateSelectorInput,
  deriveTaskClusterMemberships,
  matchWorkerTemplate,
  normalizeBudgetLane,
  normalizeConvergenceClass,
  normalizeKeeperFeedbackType,
  normalizeMailboxStatus,
  normalizeMessageType,
  normalizeReclaimReason,
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

  it("assembles worker runtime view and summary from split planner/runtime state", () => {
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
          component_candidates: ["protocol_schema", "transport_adapter"],
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

    expect(view.semantic.component_candidates).toEqual(["protocol_schema", "transport_adapter"]);
    expect(view.dispatch.role_type).toBe("worker-delivery");
    expect(view.budget.budget_lane).toBe("degraded");
    expect(view.convergence.convergence_class).toBe("stalled");
    expect(view.collaboration.cluster_id).toContain("prj_demo");
    expect(view.goal).toBe("Build websocket calculator");

    const summary = buildWorkerRuntimeMetaSummary(view, {
      runtime_worker_control: {
        budget_status: "reclaim_pending",
      },
    });
    expect(summary.worker_runtime).toMatchObject({
      runtime_view_path: "worker_runtime_view.json",
      cluster_id: view.collaboration.cluster_id,
    });
    expect(summary.runtime_worker_control).toMatchObject({
      rebuild_ready: true,
    });
    expect(summary.keeper_feedback).toEqual({
      feedback_types: ["refinement_quality_feedback"],
      last_feedback_at: "2026-03-09T00:00:10.000Z",
      reason: "refinement_too_coarse",
      submitted_candidates: [],
      submitted_fingerprints: [],
      last_submitted_at: "",
    });
    expect(summary.task_cluster).toMatchObject({
      default_target_role_types: ["tester-ephemeral"],
    });
  });

  it("derives stable memberships and rebuild control", () => {
    const memberships = deriveTaskClusterMemberships({
      semantic: {
        schema_version: "worker-semantic-contract-v1",
        task_id: "task_demo",
        goal: "x",
        project_id: "prj_demo",
        workspace_root: "runtime/workdomains/demo",
        component_candidates: ["api", "frontend"],
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
          component_candidates: ["api", "frontend"],
        },
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
      },
    });
    expect(memberships).toContain("role:tester-ephemeral");
    expect(memberships).toContain("project:prj_demo");
    expect(memberships).toContain("component:api");

    expect(
      buildWorkerRuntimeControlSummary({
        previous: { budget_status: "reclaim_pending" },
        budgetLane: "fast",
        now: "2026-03-09T00:00:00Z",
      }),
    ).toMatchObject({
      budget_status: "fast",
      rebuild_ready: true,
      rebuild_reason: "budget_or_refinement_amendment",
    });
  });

  it("builds keeper fingerprints and selects templates across component, role, and goal paths", () => {
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

    const registry = buildWorkerTemplateRegistry();
    const selector = buildWorkerTemplateSelectorInput({
      semantic: {
        schema_version: "worker-semantic-contract-v1",
        task_id: "task_demo",
        goal: "Build websocket calculator",
        project_id: "prj_demo",
        workspace_root: "runtime/workdomains/demo",
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
      },
    });
    expect(matchWorkerTemplate({ selector, registry })?.template_id).toBe("websocket_calculator");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "tester-ephemeral",
          component_candidates: [],
          goal: "",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("tester_placeholder");
    expect(
      matchWorkerTemplate({
        selector: {
          schema_version: "worker-template-selector-v1",
          role_type: "worker-delivery",
          component_candidates: [],
          goal: "Build websocket calculator",
          preferred_template_ids: [],
        },
        registry,
      })?.template_id,
    ).toBe("websocket_calculator");
  });
});
