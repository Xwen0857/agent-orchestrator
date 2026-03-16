import { describe, expect, it } from "vitest";

import { buildSchedulerAgentPolicyContext } from "../orchestrate-scheduler-agent-policy-context.js";
import type { SchedulerConfigV1 } from "../orchestrate-scheduler-contract.js";
import type { TaskMeta } from "../orchestrate-scheduler-task-model.js";

function buildProfiles(): SchedulerConfigV1["agent_profiles"] {
  return {
    "worker-delivery": { base_weight: 20, max_parallel_share: 0.7, failure_penalty_weight: 20 },
    "tester-ephemeral": { base_weight: 12, max_parallel_share: 0.5, failure_penalty_weight: 12 },
    "audit-guard": { base_weight: 8, max_parallel_share: 0.4, failure_penalty_weight: 8 },
    unknown: { base_weight: 6, max_parallel_share: 0.3, failure_penalty_weight: 10 },
  };
}

function buildTask(partial?: Partial<TaskMeta>): TaskMeta {
  return {
    taskId: "task_demo",
    taskDir: "/tmp/task_demo",
    metaPath: "/tmp/task_demo/meta.json",
    observerPath: "/tmp/task_demo/observer_view.json",
    observerView: null,
    terminalDigestPath: "/tmp/task_demo/worker_terminal_digest.json",
    rawLogIndexPath: "/tmp/task_demo/worker_raw_log_index.json",
    terminalDigest: null,
    state: "ASSIGNED",
    updatedAt: "2026-03-12T00:00:00Z",
    runtimeReplanConsumeStatus: "",
    agentDispatchCapability: {
      schema_version: "scheduler-agent-dispatch-capability-v1",
      allowed_agent_types: ["worker-delivery"],
      default_target_role_types: ["tester-ephemeral"],
      selected_template_id: "template_demo",
      selected_template_origin: "builtin",
      custom_runtime_gate_status: "allowed",
      custom_capability_gate_reason: "",
      skill_gate_status: "allowed",
      skill_gate_reason: "",
      dispatch_capability_class: "general",
      projection_source: "worker_runtime",
    },
    scheduler: {
      agent_type: "worker-delivery",
      queue_priority: 30,
      retry_count: 0,
      recovery_count: 0,
      consecutive_failure_count: 0,
      retry_backoff_until: "",
      last_dispatch_at: "",
      last_dispatch_mode: "",
      throttle_reason: "",
      recovery_hint: "",
      wait_age_seconds: 0,
      dispatch_seq: 0,
      recent_failure_rate: 0,
      last_worker_lifecycle_result: "",
      history_reload_hint: "",
      knowledge_handoff: {
        keeper_query_path: "",
        failure_pattern_summary_path: "",
        failure_pattern_index_refs: [],
        last_terminal_digest_path: "",
        last_terminal_digest_observed_at: "",
      },
      inflight: {
        operation_id: "",
        dispatch_seq: 0,
        requested_at: "",
        ack_at: "",
        last_heartbeat_at: "",
      },
      worker_execution: {
        milestones: ["task_complete"],
        completed_targets: [],
        detection_window_seconds: 300,
        stage_write_stagnation_seconds: 120,
        all_milestones_met: false,
        tester_ready: false,
        last_progress_at: "",
        last_checked_at: "",
        stall_checks: 0,
      },
      degrade: {
        active: false,
        count: 0,
        last_reason: "",
        last_applied_at: "",
        current_token_budget_cap: 0,
        current_stage_write_budget_cap: 0,
        last_stage_signature: "",
        last_stage_write_at: "",
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
    runtimeWorkerControl: {
      lastWorkerFaultAction: "none",
      workerFaultRetryable: false,
      workerFaultRequiresRebuild: false,
      workerFaultClass: "",
      lastFaultActionApplied: "none",
      faultActuationMode: "summary_only",
      faultActionBlockedByPolicy: false,
      archiveReady: false,
      reclaimReady: false,
      purgeReady: false,
      retentionDecision: "",
    },
    ...partial,
  };
}

describe("orchestrate-scheduler-agent-policy-context", () => {
  it("blocks dispatch when capability summary is missing", () => {
    const context = buildSchedulerAgentPolicyContext(
      buildTask({
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: [],
          default_target_role_types: [],
          selected_template_id: "",
          selected_template_origin: "",
          custom_runtime_gate_status: "not_applicable",
          custom_capability_gate_reason: "",
          skill_gate_status: "blocked",
          skill_gate_reason: "gate_denied_by_missing_capability_summary",
          dispatch_capability_class: "general",
          projection_source: "missing",
        },
      }),
      buildProfiles(),
    );

    expect(context.dispatch_gate).toEqual({
      allowed: false,
      reason: "gate_denied_by_missing_capability_summary",
      source: "missing",
    });
    expect(context.compatibility_mode).toBe("missing");
  });

  it("blocks custom template capability gates before scoring", () => {
    const context = buildSchedulerAgentPolicyContext(
      buildTask({
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["worker-delivery"],
          default_target_role_types: [],
          selected_template_id: "custom_bundle",
          selected_template_origin: "custom",
          custom_runtime_gate_status: "blocked",
          custom_capability_gate_reason: "containerized_reserved",
          skill_gate_status: "blocked",
          skill_gate_reason: "containerized_reserved",
          dispatch_capability_class: "general",
          projection_source: "worker_runtime",
        },
      }),
      buildProfiles(),
    );

    expect(context.dispatch_gate.allowed).toBe(false);
    expect(context.dispatch_gate.reason).toBe("containerized_reserved");
    expect(context.dispatch_gate.source).toBe("worker_runtime");
    expect(context.compatibility_mode).toBe("formal");
    expect(context.skill_capability_gate.allowed).toBe(false);
  });

  it("denies worker-delivery when formal capability summary is missing", () => {
    const context = buildSchedulerAgentPolicyContext(
      buildTask({
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: [],
          default_target_role_types: [],
          selected_template_id: "",
          selected_template_origin: "",
          custom_runtime_gate_status: "not_applicable",
          custom_capability_gate_reason: "",
          skill_gate_status: "blocked",
          skill_gate_reason: "gate_denied_by_missing_capability_summary",
          dispatch_capability_class: "general",
          projection_source: "missing",
        },
      }),
      buildProfiles(),
    );

    expect(context.dispatch_gate).toEqual({
      allowed: false,
      reason: "gate_denied_by_missing_capability_summary",
      source: "missing",
    });
    expect(context.compatibility_mode).toBe("missing");
  });

  it("treats default target role types as a secondary-agent-only constraint", () => {
    const profiles = buildProfiles();
    const secondaryContext = buildSchedulerAgentPolicyContext(
      buildTask({
        scheduler: {
          ...buildTask().scheduler,
          agent_type: "audit-guard",
        },
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["audit-guard"],
          default_target_role_types: ["tester-ephemeral"],
          selected_template_id: "template_demo",
          selected_template_origin: "builtin",
          custom_runtime_gate_status: "allowed",
          custom_capability_gate_reason: "",
          skill_gate_status: "allowed",
          skill_gate_reason: "",
          dispatch_capability_class: "audit_targeted",
          projection_source: "worker_runtime",
        },
      }),
      profiles,
    );
    const primaryContext = buildSchedulerAgentPolicyContext(
      buildTask({
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["worker-delivery"],
          default_target_role_types: ["tester-ephemeral"],
          selected_template_id: "template_demo",
          selected_template_origin: "builtin",
          custom_runtime_gate_status: "allowed",
          custom_capability_gate_reason: "",
          skill_gate_status: "allowed",
          skill_gate_reason: "",
          dispatch_capability_class: "general",
          projection_source: "worker_runtime",
        },
      }),
      profiles,
    );

    expect(secondaryContext.dispatch_gate).toEqual({
      allowed: false,
      reason: "agent_type_not_in_default_target_role_types:audit-guard",
      source: "worker_runtime",
    });
    expect(secondaryContext.compatibility_mode).toBe("formal");
    expect(primaryContext.dispatch_gate.allowed).toBe(true);
    expect(primaryContext.dispatch_gate.reason).toBe("");
    expect(primaryContext.compatibility_mode).toBe("formal");
  });

  it("denies secondary agents when formal capability summary is missing", () => {
    const context = buildSchedulerAgentPolicyContext(
      buildTask({
        scheduler: {
          ...buildTask().scheduler,
          agent_type: "tester-ephemeral",
        },
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: [],
          default_target_role_types: [],
          selected_template_id: "",
          selected_template_origin: "",
          custom_runtime_gate_status: "not_applicable",
          custom_capability_gate_reason: "",
          skill_gate_status: "blocked",
          skill_gate_reason: "gate_denied_by_missing_capability_summary",
          dispatch_capability_class: "tester_targeted",
          projection_source: "missing",
        },
      }),
      buildProfiles(),
    );

    expect(context.dispatch_gate).toEqual({
      allowed: false,
      reason: "gate_denied_by_missing_capability_summary",
      source: "missing",
    });
    expect(context.compatibility_mode).toBe("missing");
  });

  it("denies unknown agents unless formally allowed", () => {
    const deniedContext = buildSchedulerAgentPolicyContext(
      buildTask({
        scheduler: {
          ...buildTask().scheduler,
          agent_type: "unknown",
        },
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: [],
          default_target_role_types: [],
          selected_template_id: "",
          selected_template_origin: "",
          custom_runtime_gate_status: "not_applicable",
          custom_capability_gate_reason: "",
          skill_gate_status: "blocked",
          skill_gate_reason: "gate_denied_by_missing_capability_summary",
          dispatch_capability_class: "general",
          projection_source: "missing",
        },
      }),
      buildProfiles(),
    );
    const allowedContext = buildSchedulerAgentPolicyContext(
      buildTask({
        scheduler: {
          ...buildTask().scheduler,
          agent_type: "unknown",
        },
        agentDispatchCapability: {
          schema_version: "scheduler-agent-dispatch-capability-v1",
          allowed_agent_types: ["unknown"],
          default_target_role_types: [],
          selected_template_id: "template_unknown",
          selected_template_origin: "builtin",
          custom_runtime_gate_status: "allowed",
          custom_capability_gate_reason: "",
          skill_gate_status: "allowed",
          skill_gate_reason: "",
          dispatch_capability_class: "general",
          projection_source: "worker_runtime",
        },
      }),
      buildProfiles(),
    );

    expect(deniedContext.dispatch_gate).toEqual({
      allowed: false,
      reason: "gate_denied_by_missing_capability_summary",
      source: "missing",
    });
    expect(deniedContext.compatibility_mode).toBe("missing");
    expect(allowedContext.dispatch_gate).toEqual({
      allowed: true,
      reason: "",
      source: "worker_runtime",
    });
    expect(allowedContext.compatibility_mode).toBe("formal");
  });
});
