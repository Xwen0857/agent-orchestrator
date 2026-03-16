import { describe, expect, it } from "vitest";

import { buildSchedulerAgentPolicyContext } from "../orchestrate-scheduler-agent-policy-context.js";
import { selectDispatchBatch } from "../orchestrate-scheduler-selection-engine.js";
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

function buildTask(taskId: string, partial?: Partial<TaskMeta>): TaskMeta {
  return {
    taskId,
    taskDir: `/tmp/${taskId}`,
    metaPath: `/tmp/${taskId}/meta.json`,
    observerPath: `/tmp/${taskId}/observer_view.json`,
    observerView: null,
    terminalDigestPath: `/tmp/${taskId}/worker_terminal_digest.json`,
    rawLogIndexPath: `/tmp/${taskId}/worker_raw_log_index.json`,
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
      wait_age_seconds: 120,
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

describe("orchestrate-scheduler-selection-engine", () => {
  it("skips hard-gated tasks before scoring and keeps eligible tasks selectable", () => {
    const profiles = buildProfiles();
    const allowedTask = buildTask("task_allowed");
    const blockedTask = buildTask("task_blocked", {
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
    });
    const policies = new Map([
      [allowedTask.taskId, buildSchedulerAgentPolicyContext(allowedTask, profiles)],
      [blockedTask.taskId, buildSchedulerAgentPolicyContext(blockedTask, profiles)],
    ]);

    const result = selectDispatchBatch({
      metas: [allowedTask, blockedTask],
      policies,
      maxTasks: 2,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });

    expect(result.selected.map((entry) => entry.task_id)).toEqual(["task_allowed"]);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        task_id: "task_blocked",
        reason: "gate_denied_by_missing_capability_summary",
      }),
    );
    expect(result.scoring.map((entry) => entry.task_id)).toEqual(["task_allowed"]);
  });

  it("keeps capability class observational while formal and missing paths stay distinct", () => {
    const profiles = buildProfiles();
    const formalAllowed = buildTask("task_formal_allowed", {
      agentDispatchCapability: {
        schema_version: "scheduler-agent-dispatch-capability-v1",
        allowed_agent_types: ["worker-delivery"],
        default_target_role_types: [],
        selected_template_id: "template_formal",
        selected_template_origin: "builtin",
        custom_runtime_gate_status: "allowed",
        custom_capability_gate_reason: "",
        skill_gate_status: "allowed",
        skill_gate_reason: "",
        dispatch_capability_class: "tester_targeted",
        projection_source: "worker_runtime",
      },
    });
    const blockedMissing = buildTask("task_missing_secondary", {
      scheduler: {
        ...buildTask("task_missing_secondary").scheduler,
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
    });
    const policies = new Map([
      [formalAllowed.taskId, buildSchedulerAgentPolicyContext(formalAllowed, profiles)],
      [blockedMissing.taskId, buildSchedulerAgentPolicyContext(blockedMissing, profiles)],
    ]);

    const result = selectDispatchBatch({
      metas: [formalAllowed, blockedMissing],
      policies,
      maxTasks: 2,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });

    expect(result.selected).toContainEqual(
      expect.objectContaining({
        task_id: "task_formal_allowed",
        lane: "assigned_ready",
      }),
    );
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        task_id: "task_missing_secondary",
        reason: "gate_denied_by_missing_capability_summary",
      }),
    );
  });

  it("skips secondary agents with missing formal capability summary and keeps lane eligibility mirrored", () => {
    const profiles = buildProfiles();
    const secondaryMissing = buildTask("task_secondary_missing", {
      scheduler: {
        ...buildTask("task_secondary_missing").scheduler,
        agent_type: "audit-guard",
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
        dispatch_capability_class: "audit_targeted",
        projection_source: "missing",
      },
    });
    const policy = buildSchedulerAgentPolicyContext(secondaryMissing, profiles);
    const result = selectDispatchBatch({
      metas: [secondaryMissing],
      policies: new Map([[secondaryMissing.taskId, policy]]),
      maxTasks: 1,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });

    expect(policy.lane_eligibility).toEqual({
      recovery: false,
      retry: false,
      assigned_ready: false,
    });
    expect(result.selected).toHaveLength(0);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        task_id: "task_secondary_missing",
        reason: "gate_denied_by_missing_capability_summary",
      }),
    );
  });

  it("does not let max_parallel_share change selection semantics in v1", () => {
    const task = buildTask("task_parallel_share");
    const defaultProfiles = buildProfiles();
    const alteredProfiles = {
      ...buildProfiles(),
      "worker-delivery": {
        ...buildProfiles()["worker-delivery"],
        max_parallel_share: 0.05,
      },
    };

    const defaultResult = selectDispatchBatch({
      metas: [task],
      policies: new Map([[task.taskId, buildSchedulerAgentPolicyContext(task, defaultProfiles)]]),
      maxTasks: 1,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });
    const alteredResult = selectDispatchBatch({
      metas: [task],
      policies: new Map([[task.taskId, buildSchedulerAgentPolicyContext(task, alteredProfiles)]]),
      maxTasks: 1,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });

    expect(alteredResult.selected).toEqual(defaultResult.selected);
  });

  it("treats missing policy as an invariant failure and keeps unsupported_state as a guard skip", () => {
    const taskWithoutPolicy = buildTask("task_without_policy");
    const unsupportedTask = buildTask("task_unsupported", {
      state: "TESTING",
    });

    const unsupportedStateResult = selectDispatchBatch({
      metas: [unsupportedTask],
      policies: new Map([[unsupportedTask.taskId, buildSchedulerAgentPolicyContext(unsupportedTask, buildProfiles())]]),
      maxTasks: 1,
      retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
      recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
      laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
      aging: { step_seconds: 60, max_boost: 60 },
    });

    expect(() =>
      selectDispatchBatch({
        metas: [taskWithoutPolicy],
        policies: new Map(),
        maxTasks: 1,
        retryPolicy: { base_ms: 1000, max_ms: 10000, max_attempts: 3 },
        recoveryPolicy: { max_attempts: 3, token_uplift_ratio: 0.5, stage_write_budget_uplift_ratio: 0.5 },
        laneQuota: { recovery_min_share: 0.2, retry_min_share: 0.2, assigned_ready_min_share: 0.4 },
        aging: { step_seconds: 60, max_boost: 60 },
      }),
    ).toThrow("scheduler_selection_invariant_failed");
    expect(unsupportedStateResult.selected).toHaveLength(0);
    expect(unsupportedStateResult.skipped).toContainEqual(
      expect.objectContaining({
        task_id: "task_unsupported",
        reason: "unsupported_state",
      }),
    );
  });
});
