import {
  buildEntryAgentToolPolicyView,
  buildRuntimeCoordinationState,
  extractRuntimeReplanSignals,
  extractWorkerRuntimeCoordinationSignals,
  normalizeRuntimeConsistency,
} from "../orchestrate-runtime-contract.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-runtime-contract", () => {
  it("extracts normalized runtime replan signals", () => {
    expect(
      extractRuntimeReplanSignals({
        planner_replan: {
          status: " applied ",
          impact: " hard ",
          worker_policy: " pause_and_require_replan ",
          scope_summary: [" goal ", "", "workspace"],
        },
        runtime_replan: {
          consume_status: " paused ",
        },
      }),
    ).toEqual({
      status: "applied",
      impact: "hard",
      worker_policy: "pause_and_require_replan",
      execution_status: "paused",
      scope_summary: ["goal", "workspace"],
      requested_at: null,
      applied_at: null,
      consumed_at: null,
      resumed_at: null,
      blocked_reason: null,
    });
  });

  it("normalizes runtime consistency", () => {
    expect(normalizeRuntimeConsistency(undefined)).toBe("unknown");
    expect(normalizeRuntimeConsistency({ runtimeConsistency: "ok" })).toBe("ok");
    expect(normalizeRuntimeConsistency({ runtimeConsistency: "mismatch" })).toBe("mismatch");
  });

  it("builds guarded runtime coordination state", () => {
    expect(
      buildRuntimeCoordinationState({
        taskMeta: {
          runtime_replan: {
            consume_status: "paused",
          },
        },
        runtimeConsistency: { runtimeConsistency: "ok" },
      }),
    ).toMatchObject({
      guard: {
        runtime_consistency: "ok",
        should_block_side_effects: true,
      },
      replan: {
        execution_status: "paused",
      },
      worker: {
        budget_lane: null,
      },
    });
  });

  it("extracts worker runtime coordination signals", () => {
    expect(
      extractWorkerRuntimeCoordinationSignals({
        worker_budget: { budget_lane: "degraded" },
        worker_convergence: {
          convergence_class: "stalled",
          reclaim_reason: "token_budget_exhausted",
        },
      task_cluster: {
        cluster_id: "cluster_demo",
        mailbox_counters: {
          published: 1,
          acknowledged: 1,
          consumed: 0,
          archived: 0,
        },
      },
      keeper_feedback: {
        feedback_types: ["capacity_allocation_feedback"],
        submitted_fingerprints: ["fp_1"],
        last_submitted_at: "2026-03-09T00:00:10Z",
      },
        runtime_worker_control: {
          budget_status: "reclaim_pending",
          reclaim_requested_at: "2026-03-09T00:00:00Z",
          rebuild_ready: false,
        },
      }),
    ).toEqual({
      budget_lane: "degraded",
      convergence_class: "stalled",
      reclaim_reason: "token_budget_exhausted",
      task_cluster_id: "cluster_demo",
      task_cluster_mailbox_counts: {
        published: 1,
        acknowledged: 1,
        consumed: 0,
        archived: 0,
      },
      keeper_feedback_types: ["capacity_allocation_feedback"],
      keeper_feedback_fingerprints: ["fp_1"],
      keeper_last_submitted_at: "2026-03-09T00:00:10Z",
      runtime_control: {
        budget_status: "reclaim_pending",
        reclaim_requested_at: "2026-03-09T00:00:00Z",
        rebuild_ready: false,
        rebuild_reason: null,
        last_rebuilt_at: null,
      },
    });
  });

  it("derives entry-agent tool policy view from coordination state", () => {
    const coordination = buildRuntimeCoordinationState({
      taskMeta: {
        planner_replan: {
          impact: "hard",
          worker_policy: "pause_and_require_replan",
        },
        runtime_replan: {
          consume_status: "paused",
        },
      },
      runtimeConsistency: { runtimeConsistency: "ok" },
    });
    expect(
      buildEntryAgentToolPolicyView({
        coordination,
        sessionStatus: "RUNNING",
        runTaskId: "task_demo",
        hasDraftInput: true,
        clarificationRequired: false,
      }),
    ).toEqual({
      allow_summary_hint: false,
      allow_status_hint: true,
      allow_resume_hint: true,
      allow_clarify_hint: false,
      resume_task_id: "task_demo",
      blocked_by_guard: true,
      blocked_reason: "planner_paused",
    });
  });
});
