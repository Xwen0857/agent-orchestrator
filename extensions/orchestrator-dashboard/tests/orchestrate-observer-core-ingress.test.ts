import { describe, expect, it } from "vitest";
import { buildObserverCoreRefinementIntake } from "../orchestrate-observer-core-ingress.js";

describe("orchestrate-observer-core-ingress", () => {
  it("accepts observer refinement packets and produces candidate-only core intake", () => {
    const intake = buildObserverCoreRefinementIntake({
      schema_version: "observer-refinement-packet-v1",
      observed_at: "2026-03-12T00:00:00Z",
      task_id: "task_demo_core_ingress",
      request_id: "scheduler_escalation_task_demo_core_ingress_1",
      bridge_fingerprint: "bridge_fp_demo",
      escalation_reason: "persistent_fault",
      execution_exhaustion: {
        retry_count: 4,
        recovery_count: 2,
        consecutive_failure_count: 6,
        last_dispatch_mode: "local_threads",
        last_recovery_hint: "worker_fault_loop",
        dispatch_seq: 7,
        last_worker_lifecycle_result: "failure",
        attempts: [
          {
            kind: "retry",
            status: "attempted",
            detail: "retry_count=4",
          },
        ],
      },
      runtime_summary: {
        has_worker_fault: true,
        fault_class: "worker_stage_exhausted",
        convergence_class: "stalled",
        budget_lane: "reclaim_pending",
        retention_decision: "retain_delivery_only",
        blocked_reasons: [],
        observation_health: "ok",
        all_milestones_met: false,
        milestone_target_count: 2,
        completed_milestone_count: 1,
        current_instance_degraded: true,
      },
      routing_indexes: {
        module_id: "module_runtime",
        refinement_task_id: "task_demo_core_ingress",
        worker_instance_id: "workerstage_task_demo_core_ingress",
        failure_chain_id: "failure_chain_task_demo_core_ingress_6",
      },
      evidence_bundle: {
        paths: ["work.md", "observer_view.json"],
        terminal_digest_path: "worker_terminal_digest.json",
        raw_log_index_path: "worker_raw_log_index.json",
        observer_view_path: "observer_view.json",
        attempt_count: 1,
        blocked_reason_count: 0,
      },
      core_ingress_hint: {
        re_refinement_candidate: true,
      },
    });

    expect(intake).toMatchObject({
      schema_version: "observer-core-refinement-intake-v1",
      task_id: "task_demo_core_ingress",
      candidate_source: "observer.bridge",
      escalation_reason: "persistent_fault",
      re_refinement_candidate: true,
      routing_indexes: {
        module_id: "module_runtime",
        refinement_task_id: "task_demo_core_ingress",
      },
    });
    expect(intake.fact_chain_key).toBe("module_runtime::task_demo_core_ingress::failure_chain_task_demo_core_ingress_6");
    expect("worker_policy" in intake).toBe(false);
    expect("impact" in intake).toBe(false);
  });

  it("rejects raw scheduler escalation requests", () => {
    expect(() =>
      buildObserverCoreRefinementIntake({
        schema_version: "scheduler-escalation-request-v1",
      }),
    ).toThrow(/rejects raw scheduler escalation requests/);
  });
});
