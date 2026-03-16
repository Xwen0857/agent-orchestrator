import os from "node:os";
import path from "node:path";

import {
  extractSchedulerConfig,
  type SchedulerDecisionAuthority,
  type SchedulerDecisionV1,
  type SchedulerExecutionMode,
  type SchedulerRequestV1,
} from "./orchestrate-scheduler-contract.js";
import { buildSchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import { buildSchedulerAgentHeartbeat } from "./orchestrate-scheduler-agent-controls.js";
import { runSchedulerAgentDecisionPhase } from "./orchestrate-scheduler-agent-decision-phase.js";
import { emitSchedulerEvent, readJson } from "./orchestrate-scheduler-repository.js";
import {
  attachReasoningRecordRef,
  persistSchedulerReasoningRecord,
} from "./orchestrate-scheduler-reasoning-record.js";
import { runSchedulerSignalCollectionPhase } from "./orchestrate-scheduler-signal-collection-phase.js";
import type { SchedulerAgentPolicyContext } from "./orchestrate-scheduler-task-model.js";
import { runSchedulerToolExecutionPhase } from "./orchestrate-scheduler-tool-execution-phase.js";

type SchedulerPolicySummaryEntry = {
  task_id: string;
  compatibility_mode: SchedulerAgentPolicyContext["compatibility_mode"];
  dispatch_gate_reason: string;
  skill_gate_reason: string;
};

export type RunSchedulerKernelTickParams = {
  repoRoot: string;
  tasksRootArg: string;
  mode: SchedulerExecutionMode;
  maxParallel: number;
  maxTasks: number;
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "transition_task_state"
      | "append_task_event"
      | "dashboard_summary"
      | "agent_dispatch"
      | "kb_submit_candidate";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function runSchedulerKernelTick(
  params: RunSchedulerKernelTickParams,
): Promise<Record<string, unknown>> {
  const runtimePath = path.join(
    params.repoRoot,
    "templates/coordination/orchestrator/execution_runtime.json",
  );
  const runtimeRaw = await readJson<Record<string, unknown>>(runtimePath, {});
  const schedulerConfig = extractSchedulerConfig(runtimeRaw);
  const tasksRoot = path.isAbsolute(params.tasksRootArg)
    ? params.tasksRootArg
    : path.join(params.repoRoot, params.tasksRootArg);

  const logicalThreads = detectLogicalThreads();
  const effectiveWorkerThreads = Math.max(
    1,
    Math.floor(logicalThreads - Math.ceil(logicalThreads * schedulerConfig.throttle.reserve_ratio)),
  );
  const throttled = params.maxParallel > effectiveWorkerThreads;
  const parallelLimit = Math.max(1, Math.min(params.maxParallel, effectiveWorkerThreads));

  const signalCollection = await runSchedulerSignalCollectionPhase({
    runtime: {
      repoRoot: params.repoRoot,
      mode: params.mode,
      tasksRootArg: params.tasksRootArg,
      runWhitelistedScript: params.runWhitelistedScript,
      emitEvent: params.emitEvent,
    },
    schedulerConfig,
    tasksRoot,
  });

  const {
    metas,
    inflightSummary,
    degradeCandidateCount,
    lifecycleActionCount,
    replanPauseCount,
    awaitingRevalidationCount,
  } = signalCollection;

  const authority = buildTickAuthority({
    runtimeConsistency: params.runtimeConsistency,
    plannerGateActive: replanPauseCount > 0 || awaitingRevalidationCount > 0,
    override: {
      applied: false,
      reason: "",
      scope: "",
    },
  });

  const request: SchedulerRequestV1 = {
    schema_version: "scheduler-request-v1",
    request_id: `scheduler_req_${Date.now()}`,
    mode: params.mode,
    tasks_root: tasksRoot,
    max_parallel: params.maxParallel,
    max_tasks: params.maxTasks,
    runtime_guard: {
      runtime_consistency: params.runtimeConsistency,
    },
    queue_snapshot: {
      candidates: metas.length,
      now: new Date().toISOString(),
    },
    replan_guard: {
      pause_and_require_replan_count: replanPauseCount,
      awaiting_revalidation_count: awaitingRevalidationCount,
    },
    decision_authority: authority,
    lane_quota_snapshot: {
      recovery_min_share: schedulerConfig.lane_quota.recovery_min_share,
      retry_min_share: schedulerConfig.lane_quota.retry_min_share,
      assigned_ready_min_share: schedulerConfig.lane_quota.assigned_ready_min_share,
    },
    agent_control: {
      role: "scheduler-agent",
      mode: "control_agent_v1",
      heartbeat_schema_version: "scheduler-agent-heartbeat-v1",
    },
  };

  const decisionPhase = await runSchedulerAgentDecisionPhase({
    metas,
    maxTasks: params.maxTasks,
    schedulerConfig,
    parallelLimit,
    effectiveWorkerThreads,
    runtimeConsistency: params.runtimeConsistency,
    lifecycleActionCount,
    degradeApplied: degradeCandidateCount,
    observerEscalationRequests: 0,
  });
  const { selection, decision, flowPlan, baselineDecision, selectedCount, guardSkipCount } =
    decisionPhase;

  if (throttled) {
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_throttled_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_THROTTLED",
      detail: `phase=maintenance requested=${params.maxParallel} applied=${parallelLimit}`,
    });
  }

  const plannerGateActive = replanPauseCount > 0 || awaitingRevalidationCount > 0;
  const resolvedOverride = { ...decision.override };
  if (plannerGateActive && resolvedOverride.applied) {
    resolvedOverride.applied = false;
    resolvedOverride.reason = "planner_gate_no_l2_override";
    resolvedOverride.scope = "";
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_override_rejected_l1_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_OVERRIDE_REJECTED",
      detail: "phase=execution reason=planner_gate_active_no_override",
    });
  }

  if (resolvedOverride.applied) {
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_override_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_OVERRIDE_APPLIED",
      detail: `phase=execution scope=${resolvedOverride.scope} reason=${resolvedOverride.reason}`,
    });
  }

  const authorityAfterSelection = buildTickAuthority({
    runtimeConsistency: params.runtimeConsistency,
    plannerGateActive,
    override: resolvedOverride,
  });

  const adapter = buildSchedulerDispatchAdapter(params.mode, {
    repoRoot: params.repoRoot,
    config: schedulerConfig,
    runWhitelistedScript: async (input) => params.runWhitelistedScript(input),
    emitEvent: params.emitEvent,
  });

  const execution = await runSchedulerToolExecutionPhase({
    runtime: {
      repoRoot: params.repoRoot,
      mode: params.mode,
      runWhitelistedScript: params.runWhitelistedScript,
      emitEvent: params.emitEvent,
    },
    tasksRoot,
    metas,
    decision,
    flowPlan,
    selectionPolicies: selection.policies,
    schedulerConfig,
    adapter,
    runtimeConsistency: params.runtimeConsistency,
    throttled,
  });

  const {
    advanced,
    failed,
    retryScheduled,
    recoverSuccesses,
    degradeApplied,
    executionAttemptedCount,
    dispatchAttempts,
    dispatchSuccesses,
    lastFaultActionApplied,
    faultActionBlockedByPolicy: lastFaultActionBlockedByPolicy,
    workerFaultClass: lastWorkerFaultClass,
    failures,
    observerBridge,
  } = execution;

  const rawAgentHeartbeat = buildSchedulerAgentHeartbeat({
    requestId: request.request_id,
    candidateCount: metas.length,
    throttled,
    runtimeConsistency: params.runtimeConsistency,
    plannerGateActive,
    lifecycleActionCount,
    degradeApplied,
    observerEscalationRequests: observerBridge.requests,
    observerBridge: {
      active: observerBridge.requests > 0 || Boolean(observerBridge.lastRequestId || observerBridge.lastFingerprint),
      request_count: observerBridge.requests,
      packet_count: observerBridge.packets,
      bridged_task_ids: observerBridge.bridgedTaskIds,
      bridged_task_refs: observerBridge.bridgedTaskRefs,
      last_request_id: observerBridge.lastRequestId,
      last_fingerprint: observerBridge.lastFingerprint,
      last_trigger: observerBridge.lastTrigger,
      last_request_at: observerBridge.lastRequestAt,
      packet_path: observerBridge.packetPath,
    },
    guardSkipCount,
    flowPlan,
    baselineDecision,
    advanced,
    failed,
  });
  const reasoningRecordRef = await persistSchedulerReasoningRecord({
    repoRoot: params.repoRoot,
    requestId: request.request_id,
    baselineDecision,
    flowPlan,
  });
  const agentHeartbeat = attachReasoningRecordRef(rawAgentHeartbeat, reasoningRecordRef);

  const kernelDecision: SchedulerDecisionV1 = {
    schema_version: "scheduler-decision-v1",
    request_id: request.request_id,
    selected: decision.selected,
    skipped: decision.skipped,
    throttled,
    parallel_limit: parallelLimit,
    queue_depth: metas.length,
    decision_authority: authorityAfterSelection,
    scoring_breakdown: decision.scoring,
    inflight_summary: inflightSummary,
    agent_heartbeat: agentHeartbeat,
    summary: {
      selected_count: selectedCount,
      execution_attempted_count: executionAttemptedCount,
      guard_skip_count: guardSkipCount,
      advanced,
      failed,
      dispatch_attempts: dispatchAttempts,
      dispatch_successes: dispatchSuccesses,
      recover_successes: recoverSuccesses,
      retry_scheduled: retryScheduled,
      recovery_applied: recoverSuccesses,
      degrade_applied: degradeApplied,
      observer_escalation_requests: observerBridge.requests,
      observer_bridge_packets: observerBridge.packets,
      observer_bridge: {
        active: observerBridge.requests > 0 || Boolean(observerBridge.lastRequestId || observerBridge.lastFingerprint),
        request_count: observerBridge.requests,
        packet_count: observerBridge.packets,
        bridged_task_ids: observerBridge.bridgedTaskIds,
        bridged_task_refs: observerBridge.bridgedTaskRefs,
        last_request_id: observerBridge.lastRequestId,
        last_fingerprint: observerBridge.lastFingerprint,
        last_trigger: observerBridge.lastTrigger,
        last_request_at: observerBridge.lastRequestAt,
        packet_path: observerBridge.packetPath,
      },
      paused_by_replan: decision.skipped.filter((entry) => entry.lane === "paused_by_replan").length,
      last_fault_action_applied: lastFaultActionApplied,
      fault_actuation_mode: schedulerConfig.worker_fault_policy.fault_actuation_mode,
      fault_action_blocked_by_policy: lastFaultActionBlockedByPolicy,
      worker_fault_class: lastWorkerFaultClass,
    },
  };

  await params.emitEvent("orchestrate.scheduler.kernel_tick", {
    request,
    decision: kernelDecision,
    policy_summary: buildKernelPolicySummary({
      selected: decision.selected.map((entry) => entry.task_id),
      skipped: decision.skipped.map((entry) => entry.task_id),
      policies: selection.policies,
    }),
  });
  await params.emitEvent("orchestrate.scheduler.agent_heartbeat", {
    request_id: request.request_id,
    heartbeat: agentHeartbeat,
  });

  await params.runWhitelistedScript({
    repoRoot: params.repoRoot,
    scriptName: "dashboard_summary",
    args: [
      tasksRoot,
      path.join(params.repoRoot, "templates/coordination/orchestrator/dashboard.md"),
      path.join(params.repoRoot, "templates/coordination/orchestrator/dashboard.json"),
    ],
  });

  const dispatchSuccessRate = dispatchAttempts > 0 ? dispatchSuccesses / dispatchAttempts : 1;

  return {
    status: failed > 0 ? "partial" : "ok",
    mode: params.mode,
    selected_count: selectedCount,
    execution_attempted_count: executionAttemptedCount,
    guard_skip_count: guardSkipCount,
    selected_flow: agentHeartbeat.selected_flow,
    selected_skill: agentHeartbeat.selected_skill,
    selected_main_tool: agentHeartbeat.selected_main_tool,
    advanced,
    failed,
    logical_threads: logicalThreads,
    effective_worker_threads: effectiveWorkerThreads,
    parallel_limit: parallelLimit,
    queue_depth: metas.length,
    throttled,
    policy_mode: String(
      (runtimeRaw.security as Record<string, unknown> | undefined)?.policy_mode ?? "enforce",
    ),
    sandbox_status:
      ((runtimeRaw.security as Record<string, unknown> | undefined)
        ?.sandbox_enabled as boolean | undefined) === false
        ? "disabled"
        : "enabled",
    commit_guard_status:
      ((runtimeRaw.security as Record<string, unknown> | undefined)
        ?.commit_guard_enabled as boolean | undefined) === false
        ? "disabled"
        : "enabled",
    kb_import_confirm_required: String(
      ((runtimeRaw.kb_import as Record<string, unknown> | undefined)
        ?.confirm_required as boolean | undefined) !== false,
    ),
    kb_import_auto_enabled: String(
      ((runtimeRaw.kb_import as Record<string, unknown> | undefined)
        ?.auto_enabled as boolean | undefined) === true,
    ),
    workspace_sync_sensitivity: String(
      (runtimeRaw.sync as Record<string, unknown> | undefined)
        ?.workspace_sync_sensitivity ?? "MEDIUM",
    ),
    acl_denied_count: 0,
    scheduler_kernel: "v2",
    retry_scheduled: retryScheduled,
    recovery_applied: recoverSuccesses,
    degrade_applied: degradeApplied,
    observer_escalation_requests: observerBridge.requests,
    observer_bridge_packets: observerBridge.packets,
    paused_by_replan: kernelDecision.summary.paused_by_replan,
    last_fault_action_applied: lastFaultActionApplied,
    fault_actuation_mode: schedulerConfig.worker_fault_policy.fault_actuation_mode,
    fault_action_blocked_by_policy: lastFaultActionBlockedByPolicy,
    worker_fault_class: lastWorkerFaultClass,
    failures,
    decision_authority_level: authorityAfterSelection.level,
    decision_authority_source: authorityAfterSelection.source,
    override_applied: authorityAfterSelection.override_applied,
    dispatch_success_rate: Number(dispatchSuccessRate.toFixed(4)),
    inflight_total: inflightSummary.total,
    inflight_timed_out: inflightSummary.timed_out,
    inflight_acked: inflightSummary.acked,
    inflight_failed_results: inflightSummary.failed_results,
    inflight_heartbeat_expired: inflightSummary.heartbeat_expired,
  };
}

function buildTickAuthority(params: {
  runtimeConsistency: "ok" | "mismatch" | "unknown";
  plannerGateActive: boolean;
  override: {
    applied: boolean;
    reason: string;
    scope: "batch_selection" | "parallel_window" | "retry_policy" | "lane_route" | "";
  };
}): SchedulerDecisionAuthority {
  if (params.runtimeConsistency === "mismatch") {
    return {
      level: "L0",
      source: "runtime_guard",
      override_applied: false,
      override_reason: "runtime_consistency_mismatch",
      override_scope: "",
      override_ttl_ticks: 1,
    };
  }
  if (params.plannerGateActive) {
    return {
      level: "L1",
      source: "planner",
      override_applied: false,
      override_reason: "planner_replan_gate_active",
      override_scope: "",
      override_ttl_ticks: 1,
    };
  }
  return {
    level: "L2",
    source: "scheduler_kernel",
    override_applied: params.override.applied,
    override_reason: params.override.reason,
    override_scope: params.override.scope,
    override_ttl_ticks: 1,
  };
}

function detectLogicalThreads(): number {
  const available = os.availableParallelism?.();
  if (typeof available === "number" && Number.isFinite(available) && available > 0) {
    return Math.max(1, Math.floor(available));
  }
  return Math.max(1, os.cpus().length || 1);
}

function buildKernelPolicySummary(input: {
  selected: string[];
  skipped: string[];
  policies: Map<string, SchedulerAgentPolicyContext>;
}): {
  selected: SchedulerPolicySummaryEntry[];
  skipped: SchedulerPolicySummaryEntry[];
} {
  const toEntry = (taskId: string): SchedulerPolicySummaryEntry => {
    const policy = input.policies.get(taskId);
    return {
      task_id: taskId,
      compatibility_mode: policy?.compatibility_mode ?? "missing",
      dispatch_gate_reason: policy?.dispatch_gate.reason ?? "",
      skill_gate_reason: policy?.skill_capability_gate.reason ?? "",
    };
  };
  return {
    selected: input.selected.map(toEntry),
    skipped: input.skipped.map(toEntry),
  };
}
