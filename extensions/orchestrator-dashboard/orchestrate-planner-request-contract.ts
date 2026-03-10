import {
  extractObject,
  normalizeExecutionTarget,
} from "./orchestrate-planner-contract-normalize.js";
import { buildDefaultPlannerPolicyDocument } from "./orchestrate-planner-policy-contract.js";
import type {
  PlannerExecutionTarget,
  PlannerPolicyDocument,
  PlannerRequestEnvelope,
  PlannerRequestView,
} from "./orchestrate-planner-contract.js";

export function buildPlannerRequestEnvelope(params: {
  strategy: Record<string, unknown>;
  meta: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  policy?: PlannerPolicyDocument;
  executionTarget?: PlannerExecutionTarget;
}): PlannerRequestEnvelope {
  const strategy = extractObject(params.strategy);
  const meta = extractObject(params.meta);
  const runtime = extractObject(params.runtime);
  const summaryInput = extractObject(strategy.summary_input);
  const budget = extractObject(strategy.budget);
  const workspace = extractObject(strategy.workspace);
  const taskId = String(meta.id ?? strategy.task_id ?? "");
  const runtimeIsolation = extractObject(runtime.agent_runtime_isolation);
  const policy = params.policy ?? buildDefaultPlannerPolicyDocument();
  const executionTarget = normalizeExecutionTarget(
    params.executionTarget ?? runtime.execution_target ?? runtime.mode,
  );

  return {
    schema_version: "planner-request-v1",
    request_id: `planner_request_${taskId || "unknown"}`,
    task: {
      task_id: taskId,
      parent_task_id: String(meta.parent_task_id ?? ""),
      task_goal: String(summaryInput.task_goal ?? strategy.goal ?? ""),
    },
    source: {
      summary_input: summaryInput,
      budget,
      workspace,
    },
    policy,
    runtime_context: {
      agent_runtime_isolation: runtimeIsolation,
      execution_target: executionTarget,
    },
    compat: {
      request_authority: "task_local_strategy_meta",
    },
  };
}

export function buildPlannerRequestView(params: {
  strategy: Record<string, unknown>;
  meta: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  policy?: PlannerPolicyDocument;
  executionTarget?: PlannerExecutionTarget;
}): PlannerRequestView {
  const envelope = buildPlannerRequestEnvelope(params);
  const runtimeIsolation = envelope.runtime_context.agent_runtime_isolation;

  return {
    task_id: envelope.task.task_id,
    parent_task_id: envelope.task.parent_task_id,
    task_goal: envelope.task.task_goal,
    summary_input: envelope.source.summary_input,
    budget: envelope.source.budget,
    workspace: envelope.source.workspace,
    authority_input: envelope.compat.request_authority,
    planner_agent_policy: envelope.policy.planner_agent,
    runtime_isolation: runtimeIsolation,
    mcp_soft_boundary_context: {
      enabled: Boolean(runtimeIsolation.enabled ?? false),
      orchestrator_profile_name: String(runtimeIsolation.orchestrator_profile_name ?? ""),
      project_profile_name: String(runtimeIsolation.project_profile_name ?? ""),
      orchestrator_namespace: extractObject(runtimeIsolation.orchestrator_namespace),
      project_namespace: extractObject(runtimeIsolation.project_namespace),
      execution_target: envelope.runtime_context.execution_target,
    },
  };
}
