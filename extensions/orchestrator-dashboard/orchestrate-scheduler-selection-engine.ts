import type {
  SchedulerConfigV1,
  SchedulerDecisionTask,
  SchedulerScoringBreakdown,
} from "./orchestrate-scheduler-contract.js";
import type { SchedulerAgentPolicyContext, TaskMeta } from "./orchestrate-scheduler-task-model.js";

export type SchedulerSelectionResult = {
  selected: SchedulerDecisionTask[];
  skipped: SchedulerDecisionTask[];
  scoring: SchedulerScoringBreakdown[];
  override: {
    applied: boolean;
    reason: string;
    scope: "batch_selection" | "parallel_window" | "retry_policy" | "lane_route" | "";
  };
};

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
  // v1 lane routing remains state-driven; dispatch_capability_class is observable only for now.
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
  policy: SchedulerAgentPolicyContext,
  lane: "recovery" | "retry" | "assigned_ready",
  aging: SchedulerConfigV1["aging"],
): SchedulerScoringBreakdown {
  // v1 agent profiles affect scoring only; max_parallel_share is still reserved/inactive.
  const laneBase = lane === "recovery" ? 300 : lane === "retry" ? 200 : 120;
  const queuePriority = meta.scheduler.queue_priority;
  const ageBoost = Math.min(
    aging.max_boost,
    Math.floor(meta.scheduler.wait_age_seconds / Math.max(1, aging.step_seconds)),
  );
  const retryPenalty = lane === "retry" ? meta.scheduler.retry_count * 10 : meta.scheduler.retry_count * 3;
  const failurePenalty = Math.round(
    meta.scheduler.recent_failure_rate * policy.agent_profile.failure_penalty_weight,
  );
  const agentBoost = policy.agent_profile.base_weight;
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

export function selectDispatchBatch(params: {
  metas: TaskMeta[];
  policies: Map<string, SchedulerAgentPolicyContext>;
  maxTasks: number;
  retryPolicy: SchedulerConfigV1["retry"];
  recoveryPolicy: SchedulerConfigV1["recovery"];
  laneQuota: SchedulerConfigV1["lane_quota"];
  aging: SchedulerConfigV1["aging"];
}): SchedulerSelectionResult {
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

    const policy = params.policies.get(meta.taskId);
    if (!policy) {
      throw new Error(`scheduler_selection_invariant_failed: missing policy for ${meta.taskId}`);
    }
    if (!policy.dispatch_gate.allowed) {
      skipped.push({
        task_id: meta.taskId,
        from_state: meta.state,
        action: "skip",
        reason: policy.dispatch_gate.reason,
        lane: inferLane(meta),
      });
      continue;
    }
    if (!policy.skill_capability_gate.allowed) {
      skipped.push({
        task_id: meta.taskId,
        from_state: meta.state,
        action: "skip",
        reason: policy.skill_capability_gate.reason,
        lane: inferLane(meta),
      });
      continue;
    }

    if (meta.state === "BLOCKED_SYSTEM_ERROR") {
      if (!policy.lane_eligibility.recovery) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: "lane_ineligible:recovery",
          lane: "recovery",
        });
        continue;
      }
      const score = buildScore(meta, policy, "recovery", params.aging);
      scoring.push(score);
      recovery.push({ task: meta, score });
      continue;
    }

    if (meta.state === "REJECTED") {
      const backoffUntilMs = Date.parse(meta.scheduler.retry_backoff_until || "");
      const retryCount = Number.isFinite(meta.scheduler.retry_count)
        ? Math.max(0, Math.floor(meta.scheduler.retry_count))
        : 0;
      const recoveryCount = Number.isFinite(meta.scheduler.recovery_count)
        ? Math.max(0, Math.floor(meta.scheduler.recovery_count))
        : 0;
      if (retryCount >= params.retryPolicy.max_attempts && recoveryCount >= params.recoveryPolicy.max_attempts) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: `recovery_max_reached=${params.recoveryPolicy.max_attempts}`,
          lane: "retry",
        });
        continue;
      }
      if (retryCount >= params.retryPolicy.max_attempts) {
        if (!policy.lane_eligibility.recovery) {
          skipped.push({
            task_id: meta.taskId,
            from_state: meta.state,
            action: "skip",
            reason: "lane_ineligible:recovery",
            lane: "recovery",
          });
          continue;
        }
        const score = buildScore(meta, policy, "recovery", params.aging);
        scoring.push(score);
        recovery.push({ task: meta, score });
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
      if (!policy.lane_eligibility.retry) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: "lane_ineligible:retry",
          lane: "retry",
        });
        continue;
      }
      const score = buildScore(meta, policy, "retry", params.aging);
      scoring.push(score);
      retry.push({ task: meta, score });
      continue;
    }

    if (meta.state === "ASSIGNED") {
      if (!policy.lane_eligibility.assigned_ready) {
        skipped.push({
          task_id: meta.taskId,
          from_state: meta.state,
          action: "skip",
          reason: "lane_ineligible:assigned_ready",
          lane: "assigned_ready",
        });
        continue;
      }
      const score = buildScore(meta, policy, "assigned_ready", params.aging);
      scoring.push(score);
      assigned.push({ task: meta, score });
      continue;
    }

    skipped.push({
      // Defensive state-machine guard: unsupported states are not normal lane-routing outcomes.
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
      if (item) {
        selected.set(item.task.taskId, toDecisionTask(item.task, lane));
      }
    }
  }

  let overrideApplied = false;
  let overrideReason = "";
  let overrideScope: SchedulerSelectionResult["override"]["scope"] = "";
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
