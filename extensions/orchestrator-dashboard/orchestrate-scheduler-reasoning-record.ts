import fs from "node:fs/promises";
import path from "node:path";

import type {
  SchedulerAgentHeartbeatV1,
  SchedulerBaselineDecision,
  SchedulerFlowPlan,
  SchedulerInferenceDivergenceRecordV1,
} from "./orchestrate-scheduler-contract.js";
import { writeJsonAtomic } from "./orchestrate-scheduler-repository.js";

function buildDownstreamImpactChain(flowPlan: SchedulerFlowPlan): string[] {
  switch (flowPlan.selected_flow) {
    case "selection_flow":
      return ["candidate_selection", "dispatch_batch_shape", "worker_dispatch_attempt"];
    case "retry_flow":
      return ["retry_policy", "retry_dispatch", "worker_relaunch"];
    case "recovery_flow":
      return ["recovery_budget_patch", "recovery_dispatch", "worker_relaunch"];
    case "degrade_flow":
      return ["runtime_budget_patch", "worker_budget_lane", "subsequent_dispatch_capacity"];
    case "lifecycle_flow":
      return ["worker_topology_profile", "lifecycle_template_selection"];
    case "escalation_flow":
      return ["observer_bridge_signal", "core_refinement_consume"];
    default:
      return [];
  }
}

function shouldPersistReasoningRecord(input: {
  baselineDecision: SchedulerBaselineDecision;
  flowPlan: SchedulerFlowPlan;
}): boolean {
  return (
    input.baselineDecision.decision_mode === "baseline_bypassed" ||
    input.flowPlan.reasoning_summary.parameter_adjustments.length > 0
  );
}

export async function persistSchedulerReasoningRecord(input: {
  repoRoot: string;
  requestId: string;
  baselineDecision: SchedulerBaselineDecision;
  flowPlan: SchedulerFlowPlan;
}): Promise<string> {
  if (!shouldPersistReasoningRecord(input)) {
    return "";
  }
  const timestamp = new Date().toISOString();
  const eventId = `scheduler_reasoning_${input.requestId}`;
  const record: SchedulerInferenceDivergenceRecordV1 = {
    schema_version: "scheduler-inference-divergence-record-v1",
    timestamp,
    event_id: eventId,
    baseline_reference: {
      flow: input.baselineDecision.baseline_flow,
      skill: input.baselineDecision.baseline_skill,
      main_tool: input.baselineDecision.baseline_main_tool,
      args: input.baselineDecision.baseline_args,
    },
    divergence_description:
      input.baselineDecision.decision_mode === "baseline_bypassed"
        ? input.baselineDecision.deviation_reason || "agent_bypassed_recommended_template"
        : "agent_adjusted_parameterized_execution_within_soft_constraints",
    inference_summary: input.flowPlan.reasoning_summary,
    operation_summary: {
      selected_flow: input.flowPlan.selected_flow,
      selected_skill: input.flowPlan.selected_skill,
      selected_main_tool: input.flowPlan.selected_main_tool,
      selected_tool_args: input.flowPlan.selected_tool_args,
    },
    downstream_impact_chain: buildDownstreamImpactChain(input.flowPlan),
    constraint_context: {
      hard_gates: input.flowPlan.blocked_by,
      flow_combination_bans: input.flowPlan.flow_combination_bans,
      governance_locked_fields_ignored: input.flowPlan.blocked_by
        .filter((entry) => entry.startsWith("governance_locked_tool_arg_override:"))
        .map((entry) => entry.replace("governance_locked_tool_arg_override:", "")),
    },
  };

  const baseDir = path.join(
    input.repoRoot,
    "templates/coordination/orchestrator/scheduler_reasoning_records",
  );
  const recordPath = path.join(baseDir, `${eventId}.json`);
  const indexPath = path.join(baseDir, "index.ndjson");
  await writeJsonAtomic(recordPath, record);
  await fs.mkdir(baseDir, { recursive: true });
  await fs.appendFile(
    indexPath,
    `${JSON.stringify({
      event_id: eventId,
      timestamp,
      request_id: input.requestId,
      selected_flow: input.flowPlan.selected_flow,
      selected_main_tool: input.flowPlan.selected_main_tool,
      record_path: path.relative(input.repoRoot, recordPath),
    })}\n`,
    "utf8",
  );
  return path.relative(input.repoRoot, recordPath);
}

export function attachReasoningRecordRef(
  heartbeat: SchedulerAgentHeartbeatV1,
  reasoningRecordRef: string,
): SchedulerAgentHeartbeatV1 {
  return {
    ...heartbeat,
    reasoning_record_ref: reasoningRecordRef,
  };
}
