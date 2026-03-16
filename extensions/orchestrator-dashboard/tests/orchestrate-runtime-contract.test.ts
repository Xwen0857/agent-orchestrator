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
            semantic_clusters: ["semantic.update.implement"],
          },
          custom_runtime_gate_status: "allowed",
          custom_capability_gate_reason: "policy_ok",
        },
        worker_stage: {
          worker_stage_id: "workerstage_task_demo_op_1_1",
          worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1",
          worker_stage_profile: "normal",
          stage_isolation_mode: "wrapper_enforced",
          stage_runtime_class: "default_shell",
          allowed_execution_mode: "local_threads",
          allocation: {
            worker_stage_max_bytes: 1000000,
            worker_stage_max_file_count: 128,
            worker_stage_max_single_file_bytes: 256000,
            worker_stage_overflow_policy: "block_write",
            worker_stage_bytes_used: 1024,
            worker_stage_file_count: 3,
            worker_stage_overflow_status: "ok",
          },
          retention: {
            worker_stage_retention_policy: "retain_delivery_only",
            worker_stage_exported_artifact_count: 2,
            worker_stage_last_export_status: "exported",
            worker_stage_last_export_manifest_class: "delivery_manifest",
            worker_stage_last_fault_class: "worker_stage_forbidden_write",
            worker_stage_retention_result: { retention_decision: "retain_delivery_only" },
            worker_stage_last_cleanup_at: "2026-03-09T00:00:20Z",
            worker_stage_last_retained_artifact_ids: ["artifact_1"],
            worker_stage_archive_ready: true,
            worker_stage_reclaim_ready: false,
            worker_stage_purge_ready: false,
            worker_stage_retention_decision: "retain_delivery_only",
          },
        },
        worker_budget: { budget_lane: "degraded" },
        worker_convergence: {
          convergence_class: "stalled",
          reclaim_reason: "token_budget_exhausted",
        },
      task_cluster: {
        cluster_id: "cluster_demo",
        last_published_message_type: "handoff_note",
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
          last_fault_action_applied: "block",
          fault_actuation_mode: "enabled",
          fault_action_blocked_by_policy: true,
          worker_fault_class: "worker_stage_forbidden_write",
        },
      }),
    ).toEqual({
      budget_lane: "degraded",
      convergence_class: "stalled",
      reclaim_reason: "token_budget_exhausted",
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
      worker_stage_id: "workerstage_task_demo_op_1_1",
      worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo_op_1_1",
      worker_stage_profile: "normal",
      worker_stage_isolation_mode: "wrapper_enforced",
      worker_stage_runtime_class: "default_shell",
      worker_stage_allowed_execution_mode: "local_threads",
      worker_stage_max_bytes: 1000000,
      worker_stage_max_file_count: 128,
      worker_stage_max_single_file_bytes: 256000,
      worker_stage_overflow_policy: "block_write",
      worker_stage_bytes_used: 1024,
      worker_stage_file_count: 3,
      worker_stage_overflow_status: "ok",
      worker_stage_retention_policy: "retain_delivery_only",
      worker_stage_exported_artifact_count: 2,
      worker_stage_last_export_status: "exported",
      worker_stage_last_export_manifest_class: "delivery_manifest",
      worker_stage_last_fault_class: "worker_stage_forbidden_write",
      worker_stage_retention_result: { retention_decision: "retain_delivery_only" },
      worker_stage_last_cleanup_at: "2026-03-09T00:00:20Z",
      worker_stage_last_retained_artifact_ids: ["artifact_1"],
      custom_runtime_gate_status: "allowed",
      custom_capability_gate_reason: "policy_ok",
      worker_stage_archive_ready: true,
      worker_stage_reclaim_ready: false,
      worker_stage_purge_ready: false,
      worker_stage_retention_decision: "retain_delivery_only",
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
        semantic_clusters: ["semantic.update.implement"],
      },
      task_cluster_id: "cluster_demo",
      cluster_root: null,
      task_cluster_mailbox_counts: {
        published: 1,
        acknowledged: 1,
        consumed: 0,
        archived: 0,
      },
      task_cluster_last_message_type: "handoff_note",
      keeper_feedback_types: ["capacity_allocation_feedback"],
      keeper_feedback_fingerprints: ["fp_1"],
      keeper_last_submitted_at: "2026-03-09T00:00:10Z",
      runtime_control: {
        budget_status: "reclaim_pending",
        reclaim_requested_at: "2026-03-09T00:00:00Z",
        rebuild_ready: false,
        rebuild_reason: null,
        last_rebuilt_at: null,
        last_worker_fault_action: null,
        worker_fault_retryable: false,
        worker_fault_requires_rebuild: false,
        last_fault_action_applied: "block",
        fault_actuation_mode: "enabled",
        fault_action_blocked_by_policy: true,
        worker_fault_class: "worker_stage_forbidden_write",
        archive_ready: false,
        reclaim_ready: false,
        purge_ready: false,
        retention_decision: null,
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
