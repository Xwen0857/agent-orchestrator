import type {
  ObserverRefinementPacketV1,
  ObserverViewHealth,
  SchedulerEscalationRequestV1,
} from "./orchestrate-observer-contract.js";
import {
  extractRecord,
  normalizeAttemptHistory,
  normalizeBlockedReasons,
  normalizeEvidencePaths,
  normalizeNonNegativeInt,
  normalizeString,
  normalizeTrigger,
} from "./orchestrate-observer-contract-support.js";

export function buildObserverRefinementPacket(params: {
  schedulerEscalationRequest: SchedulerEscalationRequestV1 | Record<string, unknown>;
  now?: string;
}): ObserverRefinementPacketV1 {
  const request = extractRecord(params.schedulerEscalationRequest);
  const schedulerContext = extractRecord(request.scheduler_context);
  const observationSnapshot = extractRecord(request.observation_snapshot);
  const failureSummary = extractRecord(request.failure_summary);
  const evidence = extractRecord(request.evidence);
  const routingIndexes = extractRecord(request.routing_indexes);
  const evidenceIndexes = extractRecord(request.evidence_indexes);
  const refinementSignal = extractRecord(request.refinement_signal);
  const attemptHistory = normalizeAttemptHistory(request.attempt_history);
  const blockedReasons = normalizeBlockedReasons(failureSummary.blocked_reasons);
  const evidencePaths = normalizeEvidencePaths(evidence.paths);
  return {
    schema_version: "observer-refinement-packet-v1",
    observed_at: params.now ?? new Date().toISOString(),
    task_id: normalizeString(request.task_id) || "task_unknown",
    request_id: normalizeString(request.request_id) || "observer_refinement_request_unknown",
    bridge_fingerprint: normalizeString(request.bridge_fingerprint) || "observer_bridge_fingerprint_unknown",
    escalation_reason: normalizeTrigger(request.trigger),
    execution_exhaustion: {
      retry_count: normalizeNonNegativeInt(schedulerContext.retry_count),
      recovery_count: normalizeNonNegativeInt(schedulerContext.recovery_count),
      consecutive_failure_count: normalizeNonNegativeInt(schedulerContext.consecutive_failure_count),
      last_dispatch_mode: normalizeString(schedulerContext.last_dispatch_mode),
      last_recovery_hint: normalizeString(schedulerContext.last_recovery_hint),
      dispatch_seq: normalizeNonNegativeInt(schedulerContext.dispatch_seq),
      last_worker_lifecycle_result:
        normalizeString(schedulerContext.last_worker_lifecycle_result) === "success"
          ? "success"
          : normalizeString(schedulerContext.last_worker_lifecycle_result) === "failure"
            ? "failure"
            : "",
      attempts: attemptHistory,
    },
    runtime_summary: {
      has_worker_fault: observationSnapshot.has_worker_fault === true,
      fault_class: normalizeString(observationSnapshot.fault_class),
      convergence_class: normalizeString(observationSnapshot.convergence_class),
      budget_lane: normalizeString(observationSnapshot.budget_lane),
      retention_decision: normalizeString(observationSnapshot.retention_decision),
      blocked_reasons: blockedReasons,
      observation_health:
        normalizeString(observationSnapshot.observation_health) === "missing_runtime" ||
        normalizeString(observationSnapshot.observation_health) === "missing_stage" ||
        normalizeString(observationSnapshot.observation_health) === "partial"
          ? (normalizeString(observationSnapshot.observation_health) as ObserverViewHealth)
          : "ok",
      all_milestones_met: observationSnapshot.all_milestones_met === true,
      milestone_target_count: normalizeNonNegativeInt(observationSnapshot.milestone_target_count),
      completed_milestone_count: normalizeNonNegativeInt(observationSnapshot.completed_milestone_count),
      current_instance_degraded: observationSnapshot.current_instance_degraded === true,
    },
    refinement_signal: {
      necessity_tier:
        normalizeString(refinementSignal.necessity_tier) === "critical" ||
        normalizeString(refinementSignal.necessity_tier) === "high"
          ? (normalizeString(refinementSignal.necessity_tier) as "high" | "critical")
          : "medium",
      necessity_fingerprint: normalizeString(refinementSignal.necessity_fingerprint),
    },
    routing_indexes: {
      module_id: normalizeString(routingIndexes.module_id),
      refinement_task_id:
        normalizeString(routingIndexes.refinement_task_id) ||
        normalizeString(request.task_id) ||
        "task_unknown",
      worker_instance_id: normalizeString(routingIndexes.worker_instance_id),
      failure_chain_id: normalizeString(routingIndexes.failure_chain_id),
    },
    evidence_bundle: {
      paths: evidencePaths,
      terminal_digest_path: normalizeString(evidenceIndexes.terminal_digest_path),
      raw_log_index_path: normalizeString(evidenceIndexes.raw_log_index_path),
      observer_view_path: normalizeString(evidenceIndexes.observer_view_path),
      attempt_count: attemptHistory.length,
      blocked_reason_count: blockedReasons.length,
    },
    core_ingress_hint: {
      re_refinement_candidate: true,
    },
  };
}
