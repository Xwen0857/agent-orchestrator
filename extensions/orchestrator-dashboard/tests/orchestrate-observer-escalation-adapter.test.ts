import { describe, expect, it } from "vitest";

import {
  buildEscalationBridgeArtifacts,
  detectSatisfiedSchedulerEscalationCondition,
} from "../orchestrate-observer-escalation-adapter.js";
import type { SchedulerConfigV1 } from "../orchestrate-scheduler-contract.js";

const schedulerConfig = {
  retry: { max_attempts: 3 },
  recovery: { max_attempts: 3 },
} as SchedulerConfigV1;

describe("orchestrate-observer-escalation-adapter", () => {
  it("detects a satisfied scheduler-configured escalation condition and builds bridge artifacts", async () => {
    const observerView = {
      schema_version: "observer-view-v1",
      observed_at: "2026-03-12T00:00:00Z",
      task_id: "task_demo_bridge",
      runtime: {
        refinement_route_ref: {
          module_id: "module_demo",
          refinement_task_id: "task_demo_bridge",
        },
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo_bridge",
      },
      runtime_control: {},
      worker_budget: {},
      worker_convergence: {},
      task_cluster: {},
      terminal: {
        available: true,
        lifecycle_result: "failure",
        digest_path: "worker_terminal_digest.json",
        raw_log_index_path: "worker_raw_log_index.json",
        observed_at: "2026-03-12T00:00:00Z",
      },
      derived: {
        has_worker_fault: true,
        fault_class: "worker_stage_exhausted",
        rebuild_ready: false,
        archive_ready: false,
        reclaim_ready: true,
        purge_ready: false,
        retention_decision: "retain_evidence_bundle",
        convergence_class: "stalled",
        budget_lane: "degraded",
        all_milestones_met: false,
        milestone_target_count: 2,
        completed_milestone_count: 1,
        current_instance_degraded: true,
        observation_health: "ok",
      },
    } as const;
    const task = {
      taskId: "task_demo_bridge",
      taskDir: "/repo/tasks/task_demo_bridge",
      observerView,
      terminalDigest: {
        worker_instance_id: "workerstage_task_demo_bridge",
      },
      scheduler: {
        retry_count: 3,
        recovery_count: 3,
        consecutive_failure_count: 6,
        last_dispatch_mode: "local_threads",
        recent_failure_rate: 1,
        recovery_hint: "worker_fault_loop",
        dispatch_seq: 7,
        last_worker_lifecycle_result: "failure" as const,
        throttle_reason: "",
        degrade: {
          active: true,
        },
        escalation_bridge: {
          observed_fault_class: "",
          observed_fault_ticks: 0,
          observed_stall_key: "",
          observed_stall_ticks: 0,
          last_bridge_fingerprint: "",
          last_request_id: "",
          last_request_at: "",
          last_trigger: "",
        },
      },
    };
    const taskMeta = {
      state: "REJECTED",
      runtime_worker_control: {
        last_fault_action_applied: "retry",
      },
      worker_convergence: {
        reclaim_reason: "worker_stage_reclaim_requested",
      },
      last_error: "worker failed",
    };

    const detection = await detectSatisfiedSchedulerEscalationCondition({
      task,
      taskMeta,
      observerView,
      schedulerConfig,
    });

    expect(detection.trigger).toBe("recovery_exhausted");
    expect(detection.context?.routingIndexes).toEqual({
      module_id: "module_demo",
      refinement_task_id: "task_demo_bridge",
      worker_instance_id: "workerstage_task_demo_bridge",
      failure_chain_id: "failure_chain_task_demo_bridge_6",
    });

    const artifacts = await buildEscalationBridgeArtifacts({
      task,
      taskMeta,
      observerView,
      nextBridgeState: detection.nextBridgeState,
      trigger: detection.trigger!,
      context: detection.context!,
    });

    expect(artifacts.request).toMatchObject({
      schema_version: "scheduler-escalation-request-v1",
      task_id: "task_demo_bridge",
      trigger: "recovery_exhausted",
      routing_indexes: {
        module_id: "module_demo",
        refinement_task_id: "task_demo_bridge",
      },
      evidence_indexes: {
        raw_log_index_path: "worker_raw_log_index.json",
      },
    });
    expect(artifacts.packet).toMatchObject({
      schema_version: "observer-refinement-packet-v1",
      task_id: "task_demo_bridge",
      routing_indexes: {
        module_id: "module_demo",
        refinement_task_id: "task_demo_bridge",
      },
      evidence_bundle: {
        raw_log_index_path: "worker_raw_log_index.json",
      },
    });
    expect("planner_replan" in artifacts.packet).toBe(false);
  });
});
