import { describe, expect, it } from "vitest";
import {
  buildObserverRefinementPacket,
  buildObserverView,
  buildWorkerTerminalDigest,
} from "../orchestrate-observer-contract.js";

describe("orchestrate-observer-contract", () => {
  it("builds observer view from separated worker runtime and worker stage sections", () => {
    const view = buildObserverView({
      now: "2026-03-12T00:00:00Z",
      taskMeta: {
        id: "task_demo_observer",
        worker_runtime: {
          selected_template_id: "code_backend_java_spring",
          custom_runtime_gate_status: "allowed",
          allowed_template_origins: ["builtin", "custom"],
          refinement_route_ref: {
            module_id: "module_runtime",
            refinement_task_id: "task_demo_observer",
          },
          milestone_targets: ["bootstrap", "task_complete"],
          milestone_progress_signal: {
            completed_count: 1,
          },
          all_milestones_met: false,
        },
        worker_stage: {
          worker_stage_id: "workerstage_task_demo",
          worker_stage_root: "/repo/tasks/task_demo/worker_stages/workerstage_task_demo",
          allocation: {
            worker_stage_max_bytes: 1000000,
          },
          retention: {
            worker_stage_last_fault_class: "worker_stage_exhausted",
            worker_stage_archive_ready: true,
            worker_stage_retention_decision: "retain_delivery_only",
          },
        },
        runtime_worker_control: {
          rebuild_ready: true,
          archive_ready: false,
          reclaim_ready: true,
          worker_fault_class: "worker_stage_exhausted",
        },
        worker_budget: {
          budget_lane: "degraded",
        },
        worker_convergence: {
          convergence_class: "stalled",
        },
        task_cluster: {
          cluster_id: "cluster_demo",
          mailbox_counters: {
            published: 2,
          },
        },
        planner_replan: {
          status: "applied",
        },
        scheduler: {
          degrade: {
            active: true,
          },
        },
      },
    });

    expect(view).toMatchObject({
      schema_version: "observer-view-v1",
      observed_at: "2026-03-12T00:00:00Z",
      task_id: "task_demo_observer",
      runtime: {
        selected_template_id: "code_backend_java_spring",
        custom_runtime_gate_status: "allowed",
        refinement_route_ref: {
          module_id: "module_runtime",
          refinement_task_id: "task_demo_observer",
        },
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo",
      },
      runtime_control: {
        rebuild_ready: true,
        reclaim_ready: true,
      },
      worker_budget: {
        budget_lane: "degraded",
      },
      worker_convergence: {
        convergence_class: "stalled",
      },
      task_cluster: {
        cluster_id: "cluster_demo",
      },
      terminal: {
        available: false,
      },
      derived: {
        has_worker_fault: true,
        fault_class: "worker_stage_exhausted",
        rebuild_ready: true,
        archive_ready: true,
        reclaim_ready: true,
        purge_ready: false,
        retention_decision: "retain_delivery_only",
        convergence_class: "stalled",
        budget_lane: "degraded",
        milestone_target_count: 2,
        completed_milestone_count: 1,
        all_milestones_met: false,
        current_instance_degraded: true,
        observation_health: "ok",
      },
    });
    expect("planner_replan" in view).toBe(false);
  });

  it("reports missing runtime or missing stage health without inventing planner semantics", () => {
    const missingRuntime = buildObserverView({
      taskMeta: {
        id: "task_missing_runtime",
        worker_stage: {
          worker_stage_id: "workerstage_1",
        },
      },
    });
    const missingStage = buildObserverView({
      taskMeta: {
        id: "task_missing_stage",
        worker_runtime: {
          selected_template_id: "tmpl_1",
        },
      },
    });
    const partial = buildObserverView({
      taskMeta: {
        id: "task_partial",
        worker_runtime: {
          selected_template_id: "tmpl_1",
        },
        worker_stage: {
          worker_stage_id: "workerstage_2",
        },
      },
    });

    expect(missingRuntime.derived.observation_health).toBe("missing_runtime");
    expect(missingStage.derived.observation_health).toBe("missing_stage");
    expect(partial.derived.observation_health).toBe("partial");
    expect(missingRuntime.derived.retention_decision).toBe("");
    expect(missingStage.derived.fault_class).toBe("");
  });

  it("builds bridge packets only from scheduler escalation requests", () => {
    const packet = buildObserverRefinementPacket({
      now: "2026-03-12T00:00:00Z",
      schedulerEscalationRequest: {
        schema_version: "scheduler-escalation-request-v1",
        requested_at: "2026-03-12T00:00:00Z",
        task_id: "task_demo_bridge",
        request_id: "scheduler_escalation_task_demo_bridge_1",
        trigger: "retry_exhausted",
        scheduler_context: {
          retry_count: 4,
          recovery_count: 2,
          consecutive_failure_count: 6,
          last_dispatch_mode: "local_threads",
          recent_failure_rate: 1,
          last_recovery_hint: "worker_fault_loop",
          dispatch_seq: 9,
          last_worker_lifecycle_result: "failure",
        },
        observation_snapshot: {
          has_worker_fault: true,
          fault_class: "worker_stage_exhausted",
          convergence_class: "stalled",
          budget_lane: "reclaim_pending",
          retention_decision: "retain_delivery_only",
          rebuild_ready: false,
          archive_ready: false,
          reclaim_ready: true,
          purge_ready: false,
          observation_health: "ok",
          last_fault_action_applied: "retry",
          fault_action_blocked_by_policy: false,
          all_milestones_met: false,
          milestone_target_count: 2,
          completed_milestone_count: 1,
          current_instance_degraded: true,
        },
        attempt_history: [
          {
            kind: "retry",
            status: "attempted",
            detail: "retry_count=4",
          },
        ],
        failure_summary: {
          fault_class: "worker_stage_exhausted",
          convergence_class: "stalled",
          budget_lane: "reclaim_pending",
          retention_decision: "retain_delivery_only",
          blocked_reasons: ["fault_action_blocked_by_policy"],
          current_instance_degraded: true,
        },
        evidence: {
          paths: ["work.md", "observer_view.json"],
        },
        routing_indexes: {
          module_id: "module_runtime",
          refinement_task_id: "task_demo_bridge",
          worker_instance_id: "workerstage_task_demo_bridge",
          failure_chain_id: "failure_chain_task_demo_bridge_6",
        },
        evidence_indexes: {
          terminal_digest_path: "worker_terminal_digest.json",
          raw_log_index_path: "worker_raw_log_index.json",
          observer_view_path: "observer_view.json",
        },
        bridge_fingerprint: "bridge_fp_demo",
      },
    });

    expect(packet).toMatchObject({
      schema_version: "observer-refinement-packet-v1",
      observed_at: "2026-03-12T00:00:00Z",
      task_id: "task_demo_bridge",
      request_id: "scheduler_escalation_task_demo_bridge_1",
      bridge_fingerprint: "bridge_fp_demo",
      escalation_reason: "retry_exhausted",
      execution_exhaustion: {
        retry_count: 4,
        recovery_count: 2,
        consecutive_failure_count: 6,
        last_dispatch_mode: "local_threads",
      },
      runtime_summary: {
        fault_class: "worker_stage_exhausted",
        convergence_class: "stalled",
        budget_lane: "reclaim_pending",
        all_milestones_met: false,
        milestone_target_count: 2,
        completed_milestone_count: 1,
        current_instance_degraded: true,
      },
      evidence_bundle: {
        paths: ["work.md", "observer_view.json"],
        terminal_digest_path: "worker_terminal_digest.json",
        raw_log_index_path: "worker_raw_log_index.json",
        observer_view_path: "observer_view.json",
        attempt_count: 1,
      },
      routing_indexes: {
        module_id: "module_runtime",
        refinement_task_id: "task_demo_bridge",
        worker_instance_id: "workerstage_task_demo_bridge",
        failure_chain_id: "failure_chain_task_demo_bridge_6",
      },
      core_ingress_hint: {
        re_refinement_candidate: true,
      },
    });
    expect("planner_replan" in packet).toBe(false);
  });

  it("builds worker terminal digest without inventing failure reason judgement", () => {
    const digest = buildWorkerTerminalDigest({
      now: "2026-03-12T00:00:00Z",
      rawLogIndexPath: "worker_raw_log_index.json",
      evidencePaths: ["work.md", "worker_runtime_view.json"],
      taskMeta: {
        id: "task_demo_terminal",
        state: "REJECTED",
        worker_runtime: {
          milestone_targets: ["bootstrap", "task_complete"],
          milestone_progress_signal: {
            completed_count: 1,
          },
          all_milestones_met: false,
          stage_write_stagnation_seconds: 120,
        },
        worker_stage: {
          worker_stage_id: "workerstage_task_demo_terminal",
          allocation: {
            worker_stage_bytes_used: 128,
            worker_stage_file_count: 3,
            worker_stage_overflow_status: "clear",
          },
          retention: {
            worker_stage_last_fault_class: "worker_stage_exhausted",
            worker_stage_archive_ready: false,
            worker_stage_reclaim_ready: true,
            worker_stage_purge_ready: false,
            worker_stage_retention_decision: "retain_evidence_bundle",
          },
        },
        worker_budget: {
          token_cost_used: 42,
          budget_lane: "degraded",
        },
        worker_convergence: {
          convergence_class: "stalled",
        },
        scheduler: {
          worker_execution: {
            last_progress_at: "2026-03-11T23:59:00Z",
          },
          degrade: {
            last_stage_write_at: "2026-03-11T23:59:30Z",
          },
        },
      },
    });

    expect(digest).toMatchObject({
      schema_version: "worker-terminal-digest-v1",
      lifecycle_result: "failure",
      milestones: {
        target_count: 2,
        completed_count: 1,
      },
      resources: {
        token_cost_used: 42,
        budget_lane: "degraded",
      },
      evidence: {
        raw_log_index_path: "worker_raw_log_index.json",
        paths: ["work.md", "worker_runtime_view.json"],
      },
    });
    expect(digest && "failure_reason" in digest).toBe(false);
  });
});
