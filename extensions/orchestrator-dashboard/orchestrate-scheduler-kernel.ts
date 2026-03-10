import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  extractSchedulerConfig,
  type SchedulerAgentProfile,
  type SchedulerConfigV1,
  type SchedulerDecisionAuthority,
  type SchedulerDecisionTask,
  type SchedulerDecisionV1,
  type SchedulerDispatchEventV1,
  type SchedulerExecutionMode,
  type SchedulerInflightSummary,
  type SchedulerRequestV1,
  type SchedulerScoringBreakdown,
} from "./orchestrate-scheduler-contract.js";
import { buildSchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import {
  buildKeeperFeedbackFingerprint,
  buildWorkerRuntimeMetaSummary,
  buildWorkerRuntimeView,
  type WorkerRuntimeView,
} from "./orchestrate-worker-runtime-contract.js";

type TaskMeta = {
  taskId: string;
  taskDir: string;
  metaPath: string;
  state: string;
  updatedAt: string;
  runtimeReplanConsumeStatus: string;
  scheduler: {
    agent_type: "worker-delivery" | "tester-ephemeral" | "audit-guard" | "unknown";
    queue_priority: number;
    retry_count: number;
    retry_backoff_until: string;
    last_dispatch_at: string;
    last_dispatch_mode: string;
    throttle_reason: string;
    recovery_hint: string;
    wait_age_seconds: number;
    dispatch_seq: number;
    recent_failure_rate: number;
    inflight: {
      operation_id: string;
      dispatch_seq: number;
      requested_at: string;
      ack_at: string;
      last_heartbeat_at: string;
    };
  };
};

type SelectDispatchResult = {
  selected: SchedulerDecisionTask[];
  skipped: SchedulerDecisionTask[];
  scoring: SchedulerScoringBreakdown[];
  override: {
    applied: boolean;
    reason: string;
    scope: "batch_selection" | "parallel_window" | "retry_policy" | "lane_route" | "";
  };
};

type SchedulerConsumerState = {
  schema_version: "scheduler-consumer-state-v1";
  topics: Record<string, { offset: number }>;
  idempotency: {
    keys: Array<{ key: string; seen_at: string }>;
  };
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

  const metas = await loadEligibleTasks(tasksRoot);
  const inflightSummary = await consumeDistributedQueueEvents({
    params,
    schedulerConfig,
    tasksRoot,
    metas,
  });

  const replanPauseCount = metas.filter(
    (meta) => meta.runtimeReplanConsumeStatus === "paused",
  ).length;
  const awaitingRevalidationCount = metas.filter(
    (meta) => meta.runtimeReplanConsumeStatus === "awaiting_revalidation",
  ).length;

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
    agent_profile_snapshot: schedulerConfig.agent_profiles,
  };

  const decision = selectDispatchBatch({
    metas,
    maxTasks: params.maxTasks,
    retryPolicy: schedulerConfig.retry,
    laneQuota: schedulerConfig.lane_quota,
    aging: schedulerConfig.aging,
    profiles: schedulerConfig.agent_profiles,
  });

  if (throttled) {
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_throttled_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_THROTTLED",
      detail: `requested=${params.maxParallel} applied=${parallelLimit}`,
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
      detail: "L1 planner gate active; override rejected",
    });
  }

  if (resolvedOverride.applied) {
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_override_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_OVERRIDE_APPLIED",
      detail: `${resolvedOverride.scope}:${resolvedOverride.reason}`,
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

  let advanced = 0;
  let failed = 0;
  let retryScheduled = 0;
  let recoverSuccesses = 0;
  let dispatchAttempts = 0;
  let dispatchSuccesses = 0;
  const failures: string[] = [];

  for (const skipped of decision.skipped) {
    await emitSchedulerEvent(params.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_skip_${skipped.task_id}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_DISPATCH_SKIPPED",
      task_id: skipped.task_id,
      detail: `${skipped.lane}:${skipped.reason}`,
    });
    if (
      skipped.lane === "paused_by_replan" ||
      skipped.lane === "awaiting_revalidation"
    ) {
      await emitSchedulerEvent(params.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_override_reject_${skipped.task_id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_OVERRIDE_REJECTED",
        task_id: skipped.task_id,
        detail: "L1 planner gate: no execution-side override allowed",
      });
    }
  }

  for (const task of decision.selected) {
    if (params.runtimeConsistency === "mismatch") {
      await emitSchedulerEvent(params.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_override_reject_${task.task_id}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_OVERRIDE_REJECTED",
        task_id: task.task_id,
        detail: "L0 runtime_guard mismatch blocks side effects",
      });
      continue;
    }

    try {
      if (task.action === "recover") {
        const op = buildOperationId(task.task_id, "recover");
        await runTransition({
          params,
          taskDir: path.join(tasksRoot, task.task_id),
          actor: "scheduler-ops",
          fromState: "BLOCKED_SYSTEM_ERROR",
          toState: "ASSIGNED",
          operationId: op,
          reason: "scheduler kernel recovery",
        });
        await patchSchedulerMeta(tasksRoot, task.task_id, params.mode, {
          recovery_hint: "recovered_to_assigned",
          throttle_reason: "",
        });
        advanced += 1;
        recoverSuccesses += 1;
        await emitSchedulerEvent(params.emitEvent, {
          schema_version: "scheduler-dispatch-event-v1",
          event_id: `evt_scheduler_recovery_${task.task_id}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: "SCHEDULER_RECOVERY_APPLIED",
          task_id: task.task_id,
          operation_id: op,
          detail: "blocked_system_error_recovered",
        });
        continue;
      }

      if (task.action === "retry") {
        const op = buildOperationId(task.task_id, "retry");
        const dispatchSeq = await patchRetryMeta(tasksRoot, task.task_id, schedulerConfig, params.mode);
        await prepareWorkerRuntimeArtifacts({
          params,
          tasksRoot,
          taskId: task.task_id,
          action: "retry",
          lane: "retry",
          operationId: op,
          dispatchSeq,
          mode: params.mode,
        });
        await ensureRetryEvidence(tasksRoot, task.task_id);
        await runTransition({
          params,
          taskDir: path.join(tasksRoot, task.task_id),
          actor: "scheduler-ops",
          fromState: "REJECTED",
          toState: "IN_PROGRESS",
          operationId: op,
          reason: "scheduler kernel retry",
        });
        retryScheduled += 1;
        await emitSchedulerEvent(params.emitEvent, {
          schema_version: "scheduler-dispatch-event-v1",
          event_id: `evt_scheduler_retry_${task.task_id}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: "SCHEDULER_RETRY_SCHEDULED",
          task_id: task.task_id,
          operation_id: op,
          detail: `retry_count=${dispatchSeq}`,
        });
        dispatchAttempts += 1;
        const dispatch = await adapter.dispatch({
          taskId: task.task_id,
          tasksRoot,
          repoRoot: params.repoRoot,
          operationId: op,
          dispatchSeq,
        });
        if (!dispatch.ok) {
          failed += 1;
          failures.push(`${task.task_id}: retry dispatch failed`);
        } else {
          advanced += 1;
          dispatchSuccesses += 1;
        }
        continue;
      }

      if (task.action === "dispatch") {
        const op = buildOperationId(task.task_id, "dispatch");
        const dispatchSeq = await patchSchedulerMeta(tasksRoot, task.task_id, params.mode, {
          queue_priority: 30,
          throttle_reason: throttled ? "parallel_limit" : "",
        });
        await prepareWorkerRuntimeArtifacts({
          params,
          tasksRoot,
          taskId: task.task_id,
          action: "dispatch",
          lane: "assigned_ready",
          operationId: op,
          dispatchSeq,
          mode: params.mode,
        });
        await runTransition({
          params,
          taskDir: path.join(tasksRoot, task.task_id),
          actor: "scheduler-ops",
          fromState: "ASSIGNED",
          toState: "IN_PROGRESS",
          operationId: op,
          reason: "scheduler kernel dispatch",
        });
        dispatchAttempts += 1;
        const dispatch = await adapter.dispatch({
          taskId: task.task_id,
          tasksRoot,
          repoRoot: params.repoRoot,
          operationId: op,
          dispatchSeq,
        });
        if (!dispatch.ok) {
          failed += 1;
          failures.push(`${task.task_id}: dispatch failed`);
        } else {
          advanced += 1;
          dispatchSuccesses += 1;
          await emitSchedulerEvent(params.emitEvent, {
            schema_version: "scheduler-dispatch-event-v1",
            event_id: `evt_scheduler_dispatch_${task.task_id}_${Date.now()}`,
            timestamp: new Date().toISOString(),
            action: "SCHEDULER_DISPATCH_SELECTED",
            task_id: task.task_id,
            operation_id: op,
            detail: dispatch.detail,
          });
        }
      }
    } catch (error) {
      failed += 1;
      failures.push(`${task.task_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    summary: {
      processed: decision.selected.length,
      advanced,
      failed,
      dispatch_attempts: dispatchAttempts,
      dispatch_successes: dispatchSuccesses,
      recover_successes: recoverSuccesses,
      retry_scheduled: retryScheduled,
      recovery_applied: recoverSuccesses,
      paused_by_replan: decision.skipped.filter((entry) => entry.lane === "paused_by_replan").length,
    },
  };

  await params.emitEvent("orchestrate.scheduler.kernel_tick", {
    request,
    decision: kernelDecision,
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
    processed: decision.selected.length,
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
    paused_by_replan: kernelDecision.summary.paused_by_replan,
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

function buildOperationId(taskId: string, action: "recover" | "retry" | "dispatch"): string {
  return `op_scheduler_${action}_${taskId}_${Date.now()}`;
}

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function runTransition(input: {
  params: RunSchedulerKernelTickParams;
  taskDir: string;
  actor: "scheduler-ops" | "agent-orchestrator";
  fromState: string;
  toState: string;
  operationId: string;
  reason: string;
}): Promise<void> {
  await input.params.runWhitelistedScript({
    repoRoot: input.params.repoRoot,
    scriptName: "transition_task_state",
    args: [
      input.taskDir,
      input.actor,
      input.operationId,
      input.fromState,
      input.toState,
      input.reason.replace(/\s+/g, "_"),
    ],
  });
}

async function patchRetryMeta(
  tasksRoot: string,
  taskId: string,
  config: SchedulerConfigV1,
  mode: SchedulerExecutionMode,
): Promise<number> {
  const metaPath = path.join(tasksRoot, taskId, "meta.json");
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    const currentRetry = Number(scheduler.retry_count ?? 0);
    const nextRetry = Number.isFinite(currentRetry)
      ? Math.max(0, Math.floor(currentRetry) + 1)
      : 1;
    const backoffMs = Math.min(
      config.retry.max_ms,
      config.retry.base_ms * Math.pow(2, Math.max(0, nextRetry - 1)),
    );
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(config.retry.base_ms / 2)));
    const until = new Date(Date.now() + backoffMs + jitter).toISOString();

    scheduler.retry_count = nextRetry;
    scheduler.retry_backoff_until = until;
    scheduler.last_dispatch_at = new Date().toISOString();
    scheduler.last_dispatch_mode = mode;
    scheduler.queue_priority = Math.max(40, scheduler.queue_priority);
    scheduler.throttle_reason = "";
    scheduler.dispatch_seq = scheduler.dispatch_seq + 1;
    scheduler.inflight = {
      operation_id: "",
      dispatch_seq: 0,
      requested_at: "",
      ack_at: "",
      last_heartbeat_at: "",
    };

    meta.scheduler = scheduler;
  });
  const updated = await readJson<Record<string, unknown>>(metaPath, {});
  return normalizeScheduler(updated.scheduler).dispatch_seq;
}

async function patchSchedulerMeta(
  tasksRoot: string,
  taskId: string,
  mode: SchedulerExecutionMode,
  updates: {
    queue_priority?: number;
    throttle_reason?: string;
    recovery_hint?: string;
  },
): Promise<number> {
  const metaPath = path.join(tasksRoot, taskId, "meta.json");
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.queue_priority = updates.queue_priority ?? scheduler.queue_priority;
    scheduler.last_dispatch_at = new Date().toISOString();
    scheduler.last_dispatch_mode = mode;
    scheduler.throttle_reason = updates.throttle_reason ?? "";
    if (updates.recovery_hint) {
      scheduler.recovery_hint = updates.recovery_hint;
    }
    scheduler.dispatch_seq = scheduler.dispatch_seq + 1;
    scheduler.inflight.requested_at = new Date().toISOString();
    scheduler.inflight.dispatch_seq = scheduler.dispatch_seq;
    scheduler.inflight.ack_at = "";
    scheduler.inflight.last_heartbeat_at = "";
    meta.scheduler = scheduler;
  });
  const updated = await readJson<Record<string, unknown>>(metaPath, {});
  return normalizeScheduler(updated.scheduler).dispatch_seq;
}

async function prepareWorkerRuntimeArtifacts(input: {
  params: RunSchedulerKernelTickParams;
  tasksRoot: string;
  taskId: string;
  action: "dispatch" | "retry";
  lane: "assigned_ready" | "retry";
  operationId: string;
  dispatchSeq: number;
  mode: SchedulerExecutionMode;
}): Promise<WorkerRuntimeView> {
  const taskDir = path.join(input.tasksRoot, input.taskId);
  const metaPath = path.join(taskDir, "meta.json");
  const splitPlanPath = path.join(taskDir, "split_plan.json");
  const meta = await readJson<Record<string, unknown>>(metaPath, {});
  const splitPlan = await readJson<Record<string, unknown>>(splitPlanPath, {});
  const previousBudgetLane = normalizeWorkerBudgetLane(
    extractObject(meta.worker_budget).budget_lane,
  );
  const previousConvergence = extractObject(meta.worker_convergence);
  const view = buildWorkerRuntimeView({
    taskMeta: meta,
    splitPlan,
    taskDir,
    action: input.action,
    lane: input.lane,
    mode: input.mode,
    operation_id: input.operationId,
    dispatch_seq: input.dispatchSeq,
  });
  const summary = buildWorkerRuntimeMetaSummary(view, meta);
  await fs.mkdir(view.collaboration.workspace_root, { recursive: true });
  await fs.writeFile(
    path.join(taskDir, "worker_runtime_view.json"),
    `${JSON.stringify(view, null, 2)}\n`,
    "utf8",
  );
  await updateTaskMeta(metaPath, (current) => {
    current.worker_runtime = summary.worker_runtime;
    current.worker_budget = summary.worker_budget;
    current.worker_convergence =
      previousConvergence.convergence_class ||
      previousConvergence.remaining_work_estimate ||
      previousConvergence.reported_at
        ? {
            ...summary.worker_convergence,
            convergence_class: String(previousConvergence.convergence_class ?? summary.worker_convergence.convergence_class),
            convergence_confidence: Number(
              previousConvergence.convergence_confidence ?? summary.worker_convergence.convergence_confidence,
            ),
            progress_delta: Number(previousConvergence.progress_delta ?? summary.worker_convergence.progress_delta),
            remaining_work_estimate: String(
              previousConvergence.remaining_work_estimate ?? summary.worker_convergence.remaining_work_estimate,
            ),
            reclaim_reason: String(previousConvergence.reclaim_reason ?? summary.worker_convergence.reclaim_reason),
            reported_at: String(previousConvergence.reported_at ?? summary.worker_convergence.reported_at),
          }
        : summary.worker_convergence;
    current.task_cluster = summary.task_cluster;
    current.runtime_worker_control = summary.runtime_worker_control;
    current.keeper_feedback = summary.keeper_feedback;
  });
  await input.params.runWhitelistedScript({
    repoRoot: input.params.repoRoot,
    scriptName: "append_task_event",
    args: [
      taskDir,
      "scheduler-ops",
      `${input.operationId}:runtime-assembled`,
      "WORKER_RUNTIME_ASSEMBLED",
      "worker_runtime_view_ready",
      String(meta.state ?? ""),
      String(meta.state ?? ""),
    ],
  });
  if (previousBudgetLane !== "degraded" && view.budget.budget_lane === "degraded") {
    await input.params.runWhitelistedScript({
      repoRoot: input.params.repoRoot,
      scriptName: "append_task_event",
      args: [
        taskDir,
        "scheduler-ops",
        `${input.operationId}:budget-degraded`,
        "WORKER_BUDGET_DEGRADED",
        "token_budget_exceeded_fast_lane",
        String(meta.state ?? ""),
        String(meta.state ?? ""),
      ],
    });
  }
  if (view.budget.budget_lane === "reclaim_pending") {
    await input.params.runWhitelistedScript({
      repoRoot: input.params.repoRoot,
      scriptName: "append_task_event",
      args: [
        taskDir,
        "scheduler-ops",
        `${input.operationId}:reclaim-requested`,
        "WORKER_RECLAIM_REQUESTED",
        "token_budget_reclaim_pending",
        String(meta.state ?? ""),
        String(meta.state ?? ""),
      ],
    });
  }
  if (summary.runtime_worker_control.rebuild_ready === true) {
    await input.params.runWhitelistedScript({
      repoRoot: input.params.repoRoot,
      scriptName: "append_task_event",
      args: [
        taskDir,
        "scheduler-ops",
        `${input.operationId}:rebuilt`,
        "WORKER_REBUILT_WITH_BUDGET",
        String(summary.runtime_worker_control.rebuild_reason ?? "budget_or_refinement_amendment"),
        String(meta.state ?? ""),
        String(meta.state ?? ""),
      ],
    });
  }
  await submitKeeperFeedbackCandidates({
    params: input.params,
    taskDir,
    taskId: input.taskId,
    metaPath,
    meta,
    view,
    summary,
    operationId: input.operationId,
  });
  return view;
}

function normalizeCandidateToken(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._/:@+=,-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 240);
}

async function submitKeeperFeedbackCandidates(input: {
  params: RunSchedulerKernelTickParams;
  taskDir: string;
  taskId: string;
  metaPath: string;
  meta: Record<string, unknown>;
  view: WorkerRuntimeView;
  summary: ReturnType<typeof buildWorkerRuntimeMetaSummary>;
  operationId: string;
}): Promise<void> {
  const keeperFeedback = extractObject(input.summary.keeper_feedback);
  const feedbackTypes = Array.isArray(keeperFeedback.feedback_types)
    ? keeperFeedback.feedback_types.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (feedbackTypes.length === 0) {
    return;
  }
  const submittedFingerprints = new Set(
    Array.isArray(keeperFeedback.submitted_fingerprints)
      ? keeperFeedback.submitted_fingerprints.map((item) => String(item))
      : [],
  );
  const newlySubmitted: string[] = [];
  const newlySubmittedFingerprints: string[] = [];
  for (const feedbackType of feedbackTypes) {
    const fingerprint = buildKeeperFeedbackFingerprint({
      feedbackType: feedbackType as
        | "capacity_allocation_feedback"
        | "refinement_quality_feedback",
      reason: String(keeperFeedback.reason ?? ""),
      projectId: input.view.semantic.project_id,
      componentCandidates: input.view.semantic.component_candidates,
      budgetLane: input.view.budget.budget_lane,
    });
    if (submittedFingerprints.has(fingerprint)) {
      continue;
    }
    const title = normalizeCandidateToken(`${feedbackType}_${input.view.task_id}`);
    const problem = normalizeCandidateToken(
      keeperFeedback.reason
        ? `${feedbackType}_${String(keeperFeedback.reason)}`
        : `${feedbackType}_worker_runtime_signal`,
    );
    const fixPattern = normalizeCandidateToken(
      feedbackType === "capacity_allocation_feedback"
        ? `raise_budget_or_rebuild_${input.view.budget.budget_lane}`
        : `refine_split_or_replan_${input.view.convergence.reclaim_reason || "stalled"}`,
    );
    const scope = normalizeCandidateToken(
      input.view.semantic.component_candidates.join("_") || input.view.semantic.project_id || "generic",
    );
    const tags = normalizeCandidateToken(
      [
        "worker-runtime-v2",
        feedbackType,
        input.view.dispatch.role_type,
        input.view.semantic.project_id,
      ].join(","),
    );
    await input.params.runWhitelistedScript({
      repoRoot: input.params.repoRoot,
      scriptName: "kb_submit_candidate",
      args: [input.taskId, "scheduler-ops", title, tags, problem, fixPattern, scope],
    });
    newlySubmitted.push(feedbackType);
    newlySubmittedFingerprints.push(fingerprint);
  }
  if (newlySubmitted.length === 0) {
    return;
  }
  await updateTaskMeta(input.metaPath, (current) => {
    const nextKeeperFeedback = extractObject(current.keeper_feedback);
    const nextSubmitted = new Set(
      Array.isArray(nextKeeperFeedback.submitted_candidates)
        ? nextKeeperFeedback.submitted_candidates.map((item) => String(item))
        : [],
    );
    const nextFingerprints = new Set(
      Array.isArray(nextKeeperFeedback.submitted_fingerprints)
        ? nextKeeperFeedback.submitted_fingerprints.map((item) => String(item))
        : [],
    );
    for (const entry of newlySubmitted) {
      nextSubmitted.add(entry);
    }
    for (const fingerprint of newlySubmittedFingerprints) {
      nextFingerprints.add(fingerprint);
    }
    current.keeper_feedback = {
      ...nextKeeperFeedback,
      ...input.summary.keeper_feedback,
      submitted_candidates: Array.from(nextSubmitted),
      submitted_fingerprints: Array.from(nextFingerprints),
      last_submitted_at: new Date().toISOString(),
    };
  });
  await input.params.runWhitelistedScript({
    repoRoot: input.params.repoRoot,
    scriptName: "append_task_event",
    args: [
      input.taskDir,
      "scheduler-ops",
      `${input.operationId}:keeper-feedback`,
      "KEEPER_FEEDBACK_CANDIDATE_SUBMITTED",
      normalizeCandidateToken(newlySubmitted.join("_")),
      String(input.meta.state ?? ""),
      String(input.meta.state ?? ""),
    ],
  });
}

async function ensureRetryEvidence(tasksRoot: string, taskId: string): Promise<void> {
  const workPath = path.join(tasksRoot, taskId, "work.md");
  let content = "";
  try {
    content = await fs.readFile(workPath, "utf8");
  } catch {
    content = "";
  }
  const lines: string[] = [];
  if (!/retry|重试/i.test(content)) {
    lines.push("- Retry evidence: retry requested by scheduler kernel");
  }
  lines.push("- Latest action: retry requested by scheduler kernel");
  const next = `${content}${
    content.endsWith("\n") || content.length === 0 ? "" : "\n"
  }${lines.join("\n")}\n`;
  await fs.mkdir(path.dirname(workPath), { recursive: true });
  await fs.writeFile(workPath, next, "utf8");
}

async function loadEligibleTasks(tasksRoot: string): Promise<TaskMeta[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(tasksRoot);
  } catch {
    return [];
  }

  const metas: TaskMeta[] = [];
  for (const entry of dirs) {
    if (!entry.startsWith("task_")) {
      continue;
    }
    const taskDir = path.join(tasksRoot, entry);
    const metaPath = path.join(taskDir, "meta.json");
    try {
      const raw = await readJson<Record<string, unknown>>(metaPath, {});
      const state = String(raw.state ?? "");
      if (
        state === "CLOSED" ||
        state === "BLOCKED_AWAITING_CLARIFICATION" ||
        state === "BLOCKED_PENDING_APPROVAL"
      ) {
        continue;
      }
      const scheduler = normalizeScheduler(raw.scheduler);
      const updatedAt = String(raw.updated_at ?? "");
      scheduler.wait_age_seconds = computeAgeSeconds(updatedAt);
      metas.push({
        taskId: String(raw.id ?? entry),
        taskDir,
        metaPath,
        state,
        updatedAt,
        runtimeReplanConsumeStatus: normalizeRuntimeReplan(raw).consume_status,
        scheduler,
      });
    } catch {
      continue;
    }
  }
  return metas;
}

function selectDispatchBatch(params: {
  metas: TaskMeta[];
  maxTasks: number;
  retryPolicy: SchedulerConfigV1["retry"];
  laneQuota: SchedulerConfigV1["lane_quota"];
  aging: SchedulerConfigV1["aging"];
  profiles: SchedulerConfigV1["agent_profiles"];
}): SelectDispatchResult {
  const skipped: SchedulerDecisionTask[] = [];
  const recovery: Array<{ task: TaskMeta; score: SchedulerScoringBreakdown }> = [];
  const retry: Array<{ task: TaskMeta; score: SchedulerScoringBreakdown }> = [];
  const assigned: Array<{ task: TaskMeta; score: SchedulerScoringBreakdown }> = [];
  const scoring: SchedulerScoringBreakdown[] = [];
  const nowMs = Date.now();

  for (const meta of params.metas) {
    if (meta.runtimeReplanConsumeStatus === "paused") {
      skipped.push({
        task_id: meta.taskId,
        from_state: meta.state,
        action: "skip",
        reason: "runtime_replan.consume_status=paused",
        lane: "paused_by_replan",
      });
      continue;
    }
    if (meta.runtimeReplanConsumeStatus === "awaiting_revalidation") {
      skipped.push({
        task_id: meta.taskId,
        from_state: meta.state,
        action: "skip",
        reason: "runtime_replan.consume_status=awaiting_revalidation",
        lane: "awaiting_revalidation",
      });
      continue;
    }

    if (meta.state === "BLOCKED_SYSTEM_ERROR") {
      const score = buildScore(meta, "recovery", params.aging, params.profiles);
      scoring.push(score);
      recovery.push({ task: meta, score });
      continue;
    }

    if (meta.state === "REJECTED") {
      const backoffUntilMs = Date.parse(meta.scheduler.retry_backoff_until || "");
      const retryCount = Number.isFinite(meta.scheduler.retry_count)
        ? Math.max(0, Math.floor(meta.scheduler.retry_count))
        : 0;
      if (retryCount >= params.retryPolicy.max_attempts) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: `retry_max_reached=${params.retryPolicy.max_attempts}`,
          lane: "retry",
        });
        continue;
      }
      if (Number.isFinite(backoffUntilMs) && backoffUntilMs > nowMs) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: "retry_backoff_active",
          lane: "retry",
        });
        continue;
      }
      const score = buildScore(meta, "retry", params.aging, params.profiles);
      scoring.push(score);
      retry.push({ task: meta, score });
      continue;
    }

    if (meta.state === "ASSIGNED") {
      const score = buildScore(meta, "assigned_ready", params.aging, params.profiles);
      scoring.push(score);
      assigned.push({ task: meta, score });
      continue;
    }

    skipped.push({
      task_id: meta.taskId,
      from_state: meta.state,
      action: "skip",
      reason: "unsupported_state",
      lane: "unsupported",
    });
  }

  const limit = Math.max(1, params.maxTasks);
  const laneOrder = ["recovery", "retry", "assigned_ready"] as const;
  const laneBuckets: Record<(typeof laneOrder)[number], Array<{ task: TaskMeta; score: SchedulerScoringBreakdown }>> = {
    recovery: recovery.sort((a, b) => b.score.total - a.score.total),
    retry: retry.sort((a, b) => b.score.total - a.score.total),
    assigned_ready: assigned.sort((a, b) => b.score.total - a.score.total),
  };

  const quotas = {
    recovery: Math.min(laneBuckets.recovery.length, Math.ceil(limit * params.laneQuota.recovery_min_share)),
    retry: Math.min(laneBuckets.retry.length, Math.ceil(limit * params.laneQuota.retry_min_share)),
    assigned_ready: Math.min(
      laneBuckets.assigned_ready.length,
      Math.ceil(limit * params.laneQuota.assigned_ready_min_share),
    ),
  };

  const selected = new Map<string, SchedulerDecisionTask>();
  for (const lane of laneOrder) {
    for (let i = 0; i < quotas[lane]; i += 1) {
      const item = laneBuckets[lane][i];
      if (!item) {
        continue;
      }
      selected.set(item.task.taskId, toDecisionTask(item.task, lane));
    }
  }

  let overrideApplied = false;
  let overrideReason = "";
  let overrideScope: SelectDispatchResult["override"]["scope"] = "";

  let remaining = limit - selected.size;
  if (remaining > 0) {
    const leftovers = [
      ...laneBuckets.recovery.slice(quotas.recovery),
      ...laneBuckets.retry.slice(quotas.retry),
      ...laneBuckets.assigned_ready.slice(quotas.assigned_ready),
    ].sort((a, b) => b.score.total - a.score.total);

    for (const item of leftovers) {
      if (remaining <= 0) {
        break;
      }
      if (selected.has(item.task.taskId)) {
        continue;
      }
      selected.set(item.task.taskId, toDecisionTask(item.task, inferLane(item.task)));
      remaining -= 1;
    }

    if (selected.size > quotas.recovery + quotas.retry + quotas.assigned_ready) {
      overrideApplied = true;
      overrideReason = "quota_remainder_reallocated_by_scoring";
      overrideScope = "batch_selection";
    }
  }

  return {
    selected: Array.from(selected.values()),
    skipped,
    scoring,
    override: {
      applied: overrideApplied,
      reason: overrideReason,
      scope: overrideScope,
    },
  };
}

function toDecisionTask(
  meta: TaskMeta,
  lane: "recovery" | "retry" | "assigned_ready",
): SchedulerDecisionTask {
  if (lane === "recovery") {
    return {
      task_id: meta.taskId,
      from_state: meta.state,
      action: "recover",
      reason: "recovery_lane",
      lane,
    };
  }
  if (lane === "retry") {
    return {
      task_id: meta.taskId,
      from_state: meta.state,
      action: "retry",
      reason: "retry_lane",
      lane,
    };
  }
  return {
    task_id: meta.taskId,
    from_state: meta.state,
    action: "dispatch",
    reason: "assigned_ready",
    lane,
  };
}

function inferLane(meta: TaskMeta): "recovery" | "retry" | "assigned_ready" {
  if (meta.state === "BLOCKED_SYSTEM_ERROR") {
    return "recovery";
  }
  if (meta.state === "REJECTED") {
    return "retry";
  }
  return "assigned_ready";
}

function buildScore(
  meta: TaskMeta,
  lane: "recovery" | "retry" | "assigned_ready",
  aging: SchedulerConfigV1["aging"],
  profiles: SchedulerConfigV1["agent_profiles"],
): SchedulerScoringBreakdown {
  const laneBase = lane === "recovery" ? 300 : lane === "retry" ? 200 : 120;
  const queuePriority = meta.scheduler.queue_priority;
  const ageBoost = Math.min(
    aging.max_boost,
    Math.floor(meta.scheduler.wait_age_seconds / Math.max(1, aging.step_seconds)),
  );
  const retryPenalty = lane === "retry" ? meta.scheduler.retry_count * 10 : meta.scheduler.retry_count * 3;
  const profile = profiles[meta.scheduler.agent_type] ?? profiles.unknown;
  const failurePenalty = Math.round(meta.scheduler.recent_failure_rate * profile.failure_penalty_weight);
  const agentBoost = profile.base_weight;
  const total = laneBase + queuePriority + ageBoost - retryPenalty + agentBoost - failurePenalty;

  return {
    task_id: meta.taskId,
    lane,
    lane_base: laneBase,
    queue_priority: queuePriority,
    age_boost: ageBoost,
    retry_penalty: retryPenalty,
    agent_profile_boost: agentBoost,
    failure_penalty: failurePenalty,
    total,
  };
}

async function consumeDistributedQueueEvents(input: {
  params: RunSchedulerKernelTickParams;
  schedulerConfig: SchedulerConfigV1;
  tasksRoot: string;
  metas: TaskMeta[];
}): Promise<SchedulerInflightSummary> {
  const summary: SchedulerInflightSummary = {
    total: 0,
    timed_out: 0,
    acked: 0,
    failed_results: 0,
    heartbeat_expired: 0,
  };

  if (input.params.mode !== "distributed") {
    return summary;
  }

  const cfg = input.schedulerConfig.distributed.queue;
  const root = path.join(input.params.repoRoot, cfg.root);
  const statePath = path.join(root, ".consumer_state.json");
  const state = await readConsumerState(statePath);
  const seenWindow = buildSeenWindow(state.idempotency.keys, {
    maxKeys: input.schedulerConfig.distributed.consumer.idempotency_max_keys,
    ttlMs: input.schedulerConfig.distributed.consumer.idempotency_ttl_ms,
  });

  const ackStream = await readNdjsonFromOffset(
    path.join(root, `${cfg.ack_topic}.ndjson`),
    state.topics[cfg.ack_topic]?.offset ?? 0,
  );
  state.topics[cfg.ack_topic] = { offset: ackStream.nextOffset };

  const resultStream = await readNdjsonFromOffset(
    path.join(root, `${cfg.result_topic}.ndjson`),
    state.topics[cfg.result_topic]?.offset ?? 0,
  );
  state.topics[cfg.result_topic] = { offset: resultStream.nextOffset };

  const heartbeatStream = await readNdjsonFromOffset(
    path.join(root, `${cfg.heartbeat_topic}.ndjson`),
    state.topics[cfg.heartbeat_topic]?.offset ?? 0,
  );
  state.topics[cfg.heartbeat_topic] = { offset: heartbeatStream.nextOffset };

  const byTask = new Map<string, TaskMeta>(input.metas.map((meta) => [meta.taskId, meta]));

  for (const row of ackStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0) {
      continue;
    }
    const key = `${taskId}:${seq}:${op}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, row.timestamp);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    summary.acked += 1;
    summary.total += 1;
    await patchInflight(task.metaPath, {
      operation_id: op,
      dispatch_seq: seq,
      ack_at: String(row.acked_at ?? new Date().toISOString()),
      last_heartbeat_at: String(row.acked_at ?? new Date().toISOString()),
    });
  }

  for (const row of heartbeatStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    const ts = String(row.timestamp ?? "");
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0 || !ts) {
      continue;
    }
    const baseKey = `${taskId}:${seq}:${op}`;
    const key = `${baseKey}:${stableRowFingerprint(row)}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, ts);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    await patchInflight(task.metaPath, {
      operation_id: op,
      dispatch_seq: seq,
      last_heartbeat_at: ts,
    });
  }

  for (const row of resultStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    const status = String(row.status ?? "").toLowerCase();
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0 || !status) {
      continue;
    }
    const key = `${taskId}:${seq}:${op}:${status}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, row.timestamp);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    summary.total += 1;
    if (status === "failed") {
      summary.failed_results += 1;
      await patchResultFailure(task.metaPath, input.schedulerConfig);
      await emitSchedulerEvent(input.params.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_retry_distributed_failed_${task.taskId}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_RETRY_SCHEDULED",
        task_id: task.taskId,
        operation_id: op,
        detail: "distributed_result_failed",
      });
      if (task.state === "IN_PROGRESS") {
        try {
          await runTransition({
            params: input.params,
            taskDir: task.taskDir,
            actor: "agent-orchestrator",
            fromState: "IN_PROGRESS",
            toState: "BLOCKED_SYSTEM_ERROR",
            operationId: `op_scheduler_dist_fail_${task.taskId}_${Date.now()}`,
            reason: "distributed result failed",
          });
        } catch {
          // keep soft-fail; retry lane can still be reached through future transitions
        }
      }
    }
    await clearInflight(task.metaPath);
  }

  const nowMs = Date.now();
  for (const task of input.metas) {
    const inflight = task.scheduler.inflight;
    if (!inflight.operation_id || inflight.dispatch_seq <= 0 || !inflight.requested_at) {
      continue;
    }

    const requestedAtMs = Date.parse(inflight.requested_at);
    if (Number.isFinite(requestedAtMs)) {
      const timeoutAt = requestedAtMs + cfg.visibility_timeout_ms;
      if (!inflight.ack_at && timeoutAt < nowMs) {
        summary.timed_out += 1;
        await patchResultFailure(task.metaPath, input.schedulerConfig);
        await emitSchedulerEvent(input.params.emitEvent, {
          schema_version: "scheduler-dispatch-event-v1",
          event_id: `evt_scheduler_retry_visibility_timeout_${task.taskId}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: "SCHEDULER_RETRY_SCHEDULED",
          task_id: task.taskId,
          operation_id: inflight.operation_id,
          detail: "distributed_visibility_timeout",
        });
        if (task.state === "IN_PROGRESS") {
          try {
            await runTransition({
              params: input.params,
              taskDir: task.taskDir,
              actor: "agent-orchestrator",
              fromState: "IN_PROGRESS",
              toState: "BLOCKED_SYSTEM_ERROR",
              operationId: `op_scheduler_dist_timeout_${task.taskId}_${Date.now()}`,
              reason: "distributed visibility timeout",
            });
          } catch {
            // keep soft-fail
          }
        }
        await clearInflight(task.metaPath);
        continue;
      }
    }

    if (inflight.last_heartbeat_at) {
      const hbMs = Date.parse(inflight.last_heartbeat_at);
      if (Number.isFinite(hbMs) && hbMs + cfg.heartbeat_timeout_ms < nowMs) {
        summary.heartbeat_expired += 1;
        await patchHeartbeatExpired(task.metaPath);
      }
    }
  }

  state.idempotency.keys = seenWindow.snapshot();
  await writeConsumerState(statePath, state);

  return summary;
}

async function patchInflight(
  metaPath: string,
  patch: {
    operation_id?: string;
    dispatch_seq?: number;
    requested_at?: string;
    ack_at?: string;
    last_heartbeat_at?: string;
  },
): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.inflight = {
      operation_id: patch.operation_id ?? scheduler.inflight.operation_id,
      dispatch_seq: patch.dispatch_seq ?? scheduler.inflight.dispatch_seq,
      requested_at: patch.requested_at ?? scheduler.inflight.requested_at,
      ack_at: patch.ack_at ?? scheduler.inflight.ack_at,
      last_heartbeat_at: patch.last_heartbeat_at ?? scheduler.inflight.last_heartbeat_at,
    };
    meta.scheduler = scheduler;
  });
}

async function clearInflight(metaPath: string): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.inflight = {
      operation_id: "",
      dispatch_seq: 0,
      requested_at: "",
      ack_at: "",
      last_heartbeat_at: "",
    };
    meta.scheduler = scheduler;
  });
}

async function patchResultFailure(metaPath: string, config: SchedulerConfigV1): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.retry_count = scheduler.retry_count + 1;
    const backoff = Math.min(
      config.retry.max_ms,
      config.retry.base_ms * Math.pow(2, Math.max(0, scheduler.retry_count - 1)),
    );
    scheduler.retry_backoff_until = new Date(Date.now() + backoff).toISOString();
    scheduler.recovery_hint = "distributed_result_failed";
    meta.scheduler = scheduler;
  });
}

async function patchHeartbeatExpired(metaPath: string): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.throttle_reason = "worker_heartbeat_timeout";
    meta.scheduler = scheduler;
  });
}

function normalizeRuntimeReplan(
  value: Record<string, unknown> | null | undefined,
): {
  consume_status: string;
} {
  const raw =
    value?.runtime_replan &&
    typeof value.runtime_replan === "object" &&
    !Array.isArray(value.runtime_replan)
      ? (value.runtime_replan as Record<string, unknown>)
      : {};
  return {
    consume_status: String(raw.consume_status ?? "").trim(),
  };
}

function normalizeScheduler(value: unknown): TaskMeta["scheduler"] {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const inflightRaw = raw.inflight && typeof raw.inflight === "object" && !Array.isArray(raw.inflight)
    ? (raw.inflight as Record<string, unknown>)
    : {};

  const agentType = String(raw.agent_type ?? "unknown").trim();
  const normalizedAgentType =
    agentType === "worker-delivery" ||
    agentType === "tester-ephemeral" ||
    agentType === "audit-guard"
      ? (agentType as TaskMeta["scheduler"]["agent_type"])
      : "unknown";

  const retryCount = Number(raw.retry_count ?? 0);
  const queuePriority = Number(raw.queue_priority ?? 30);
  const recentFailureRate = Number(raw.recent_failure_rate ?? 0);

  return {
    agent_type: normalizedAgentType,
    queue_priority: Number.isFinite(queuePriority) ? Math.floor(queuePriority) : 30,
    retry_count: Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0,
    retry_backoff_until: String(raw.retry_backoff_until ?? ""),
    last_dispatch_at: String(raw.last_dispatch_at ?? ""),
    last_dispatch_mode: String(raw.last_dispatch_mode ?? ""),
    throttle_reason: String(raw.throttle_reason ?? ""),
    recovery_hint: String(raw.recovery_hint ?? ""),
    wait_age_seconds: Number(raw.wait_age_seconds ?? 0),
    dispatch_seq: Number.isFinite(Number(raw.dispatch_seq))
      ? Math.max(0, Math.floor(Number(raw.dispatch_seq)))
      : 0,
    recent_failure_rate:
      Number.isFinite(recentFailureRate) && recentFailureRate >= 0
        ? Math.min(1, recentFailureRate)
        : 0,
    inflight: {
      operation_id: String(inflightRaw.operation_id ?? ""),
      dispatch_seq: Number.isFinite(Number(inflightRaw.dispatch_seq))
        ? Math.max(0, Math.floor(Number(inflightRaw.dispatch_seq)))
        : 0,
      requested_at: String(inflightRaw.requested_at ?? ""),
      ack_at: String(inflightRaw.ack_at ?? ""),
      last_heartbeat_at: String(inflightRaw.last_heartbeat_at ?? ""),
    },
  };
}

function computeAgeSeconds(iso: string): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function detectLogicalThreads(): number {
  if (typeof os.availableParallelism === "function") {
    return Math.max(1, os.availableParallelism());
  }
  return Math.max(1, os.cpus().length || 4);
}

async function emitSchedulerEvent(
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>,
  event: SchedulerDispatchEventV1,
): Promise<void> {
  await emitEvent(
    "orchestrate.scheduler.dispatch_event",
    event as unknown as Record<string, unknown>,
  );
}

async function readJson<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readNdjsonFromOffset(
  targetPath: string,
  offset: number,
): Promise<{ rows: Array<Record<string, unknown>>; nextOffset: number }> {
  try {
    const data = await fs.readFile(targetPath);
    const normalizedOffset = Math.max(0, Math.min(offset, data.length));
    const slice = data.subarray(normalizedOffset).toString("utf8");
    const rows = slice
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return {
      rows,
      nextOffset: data.length,
    };
  } catch {
    return {
      rows: [],
      nextOffset: 0,
    };
  }
}

async function readConsumerState(statePath: string): Promise<SchedulerConsumerState> {
  const fallback: SchedulerConsumerState = {
    schema_version: "scheduler-consumer-state-v1",
    topics: {},
    idempotency: {
      keys: [],
    },
  };
  const state = await readJson<SchedulerConsumerState>(statePath, fallback);
  if (!state || state.schema_version !== "scheduler-consumer-state-v1") {
    return fallback;
  }
  if (!state.topics || typeof state.topics !== "object" || Array.isArray(state.topics)) {
    state.topics = {};
  }
  if (!state.idempotency || !Array.isArray(state.idempotency.keys)) {
    state.idempotency = { keys: [] };
  }
  return state;
}

async function writeConsumerState(statePath: string, state: SchedulerConsumerState): Promise<void> {
  await writeJsonAtomic(statePath, state);
}

function buildSeenWindow(
  entries: Array<{ key: string; seen_at: string }>,
  limits: { maxKeys: number; ttlMs: number },
): {
  has: (key: string) => boolean;
  add: (key: string, seenAt: unknown) => void;
  snapshot: () => Array<{ key: string; seen_at: string }>;
} {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") {
      continue;
    }
    const seenAtMs = Date.parse(entry.seen_at);
    if (!Number.isFinite(seenAtMs)) {
      continue;
    }
    if (seenAtMs + limits.ttlMs < now) {
      continue;
    }
    map.set(entry.key, seenAtMs);
  }

  return {
    has: (key) => map.has(key),
    add: (key, seenAt) => {
      const parsed = Date.parse(String(seenAt ?? ""));
      map.set(key, Number.isFinite(parsed) ? parsed : Date.now());
    },
    snapshot: () => {
      const normalized = Array.from(map.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(-Math.max(1, limits.maxKeys))
        .map(([key, seenAtMs]) => ({
          key,
          seen_at: new Date(seenAtMs).toISOString(),
        }));
      return normalized;
    },
  };
}

function stableRowFingerprint(row: Record<string, unknown>): string {
  const input = JSON.stringify(row, Object.keys(row).sort());
  return createHash("sha1").update(input).digest("hex");
}

async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, targetPath);
}

async function updateSchedulerOwnedMeta(
  metaPath: string,
  mutate: (meta: Record<string, unknown>) => void,
): Promise<void> {
  const meta = await readJson<Record<string, unknown>>(metaPath, {});
  const plannerBefore = JSON.stringify(meta.planner_replan ?? null);
  const runtimeBefore = JSON.stringify(meta.runtime_replan ?? null);
  mutate(meta);
  if (JSON.stringify(meta.planner_replan ?? null) !== plannerBefore) {
    throw new Error("scheduler boundary violation: planner_replan is planner-owned");
  }
  if (JSON.stringify(meta.runtime_replan ?? null) !== runtimeBefore) {
    throw new Error("scheduler boundary violation: runtime_replan is not scheduler-owned in this path");
  }
  await writeJsonAtomic(metaPath, meta);
}

async function updateTaskMeta(
  metaPath: string,
  mutate: (meta: Record<string, unknown>) => void,
): Promise<void> {
  const current = await readJson<Record<string, unknown>>(metaPath, {});
  mutate(current);
  current.updated_at = new Date().toISOString();
  await fs.writeFile(metaPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

function normalizeWorkerBudgetLane(value: unknown): "fast" | "degraded" | "reclaim_pending" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "degraded" || raw === "reclaim_pending" ? raw : "fast";
}
