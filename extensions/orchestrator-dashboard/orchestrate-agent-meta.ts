import type { PlannerAmendmentWatermarkV2, ReceptionistAmendmentQueue } from "./orchestrate-receptionist.js";
import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import { buildEntryActionGuidance } from "./orchestrate-entry-action-contract.js";
import {
  buildEntryActionPolicyView,
  buildEntryAgentToolPolicyView,
  buildRuntimeCoordinationState,
  extractRuntimeReplanSignals,
  type RuntimeReplanSignals,
} from "./orchestrate-runtime-contract.js";

export const ORCHESTRATE_AGENT_META_SCHEMA_VERSION = "orchestrate-agent-meta-v1";
export const ORCHESTRATE_AGENT_META_BEGIN = "BEGIN_ORCHESTRATE_AGENT_META";
export const ORCHESTRATE_AGENT_META_END = "END_ORCHESTRATE_AGENT_META";

export type OrchestrateAgentMeta = {
  schema_version: typeof ORCHESTRATE_AGENT_META_SCHEMA_VERSION;
  session: {
    session_key: string;
    conversation_status: "ACTIVE_DRAFTING" | "SUMMARY_READY" | "RUNNING" | "CLOSED";
    receptionist_active: boolean;
    receptionist_mode: "guided_intake";
    pending_questions: string[];
    amendment_queue_open: boolean;
  };
  draft: {
    task_goal: string;
    project_id: string;
    workspace_root: string;
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    budget: {
      max_token_cost: number;
      max_execution_time_seconds: number;
    };
    deliverables: string[];
    constraints: string[];
    notes: string[];
  };
  planner_ingress: {
    mode_selection: "planner_managed";
    split_decision: "planner_managed";
    raw_user_chat_forwarded: false;
  };
  run: {
    task_id: string | null;
    summary_id: string | null;
    started_at: string | null;
  };
  amendment: {
    queue_status: "none" | "open" | "batched" | "flushed";
    item_count: number;
    watermark: {
      head_version: number;
      applying_version: number;
      consumed_version: number;
      last_release_reason: "wait_timeout" | "batch_count" | "manual_flush" | null;
    };
  };
  action: {
    route: "amend_existing_task" | "intake_new_task" | "clarify_target";
    target_task_id: string | null;
    clarification_required: boolean;
    missing_configuration: Array<"task_goal" | "project_id" | "workspace_root" | "budget" | "risk_level">;
    guidance_reason: string;
  };
  replan: RuntimeReplanSignals;
  runtime_guard: {
    runtime_consistency: "ok" | "mismatch" | "unknown";
    should_block_side_effects: boolean;
  };
  recommended_triggers: {
    summary: boolean;
    status: boolean;
    resume_task_id: string | null;
    clarify: boolean;
  };
};

export function extractOrchestrateAgentReplan(
  meta: Record<string, unknown> | null | undefined,
): OrchestrateAgentMeta["replan"] {
  return extractRuntimeReplanSignals(meta);
}

export function buildOrchestrateAgentMeta(params: {
  session: OrchestrateSessionState;
  amendmentQueue?: ReceptionistAmendmentQueue | null;
  amendmentWatermark?: PlannerAmendmentWatermarkV2 | null;
  taskMeta?: Record<string, unknown> | null;
  runtimeConsistency?: Pick<RuntimeConsistencySnapshot, "runtimeConsistency"> | null;
}): OrchestrateAgentMeta {
  const runTaskId = params.session.last_run?.task_id?.trim() || null;
  const actionRoute = params.session.receptionist.action_route;
  const actionTargetTaskId = params.session.receptionist.action_target_task_id;
  const clarificationRequired = params.session.receptionist.clarification_required;
  const coordination = buildRuntimeCoordinationState({
    taskMeta: params.taskMeta,
    runtimeConsistency: params.runtimeConsistency,
  });
  const actionGuidance = buildEntryActionGuidance(
    {
      route: actionRoute,
      target_task_id: actionTargetTaskId,
      clarification_required: clarificationRequired,
      guidance_reason: clarificationRequired
        ? "clarification_required"
        : `route_${actionRoute}`,
      clarification_question: null,
    },
    params.session,
  );
  const actionPolicy = buildEntryActionPolicyView({
    clarificationRequired,
  });
  const toolPolicy = buildEntryAgentToolPolicyView({
    coordination,
    sessionStatus: params.session.status,
    runTaskId,
    hasDraftInput: Boolean(
      params.session.draft.task_goal.trim() ||
        params.session.draft.project_id.trim() ||
        params.session.draft.workspace_root.trim(),
    ),
    clarificationRequired: actionPolicy.allow_clarification_only,
  });

  return {
    schema_version: ORCHESTRATE_AGENT_META_SCHEMA_VERSION,
    session: {
      session_key: params.session.session_key,
      conversation_status: params.session.status,
      receptionist_active: params.session.receptionist.active,
      receptionist_mode: params.session.receptionist.mode,
      pending_questions: [...params.session.receptionist.pending_questions],
      amendment_queue_open: params.session.receptionist.amendment_queue_open,
    },
    draft: {
      task_goal: params.session.draft.task_goal,
      project_id: params.session.draft.project_id,
      workspace_root: params.session.draft.workspace_root,
      risk_level: params.session.draft.risk_level,
      budget: {
        max_token_cost: params.session.draft.budget.max_token_cost,
        max_execution_time_seconds: params.session.draft.budget.max_execution_time_seconds,
      },
      deliverables: [...params.session.draft.deliverables],
      constraints: [...params.session.draft.constraints],
      notes: [...params.session.draft.notes],
    },
    planner_ingress: {
      mode_selection: "planner_managed",
      split_decision: "planner_managed",
      raw_user_chat_forwarded: false,
    },
    run: {
      task_id: runTaskId,
      summary_id: params.session.last_run?.summary_id?.trim() || null,
      started_at: params.session.last_run?.started_at?.trim() || null,
    },
    amendment: {
      queue_status: params.amendmentQueue?.status ?? "none",
      item_count: params.amendmentQueue?.items.length ?? 0,
      watermark: {
        head_version: params.amendmentWatermark?.head_version ?? 0,
        applying_version: params.amendmentWatermark?.applying_version ?? 0,
        consumed_version: params.amendmentWatermark?.consumed_version ?? 0,
        last_release_reason: params.amendmentWatermark?.last_release_reason ?? null,
      },
    },
    action: {
      route: actionRoute,
      target_task_id: actionTargetTaskId,
      clarification_required: clarificationRequired,
      missing_configuration: actionGuidance.missing_configuration,
      guidance_reason: clarificationRequired
        ? "clarification_required"
        : `route_${actionRoute}`,
    },
    replan: coordination.replan,
    runtime_guard: {
      runtime_consistency: coordination.guard.runtime_consistency,
      should_block_side_effects: coordination.guard.should_block_side_effects,
    },
    recommended_triggers: {
      summary: toolPolicy.allow_summary_hint,
      status: toolPolicy.allow_status_hint,
      resume_task_id: toolPolicy.resume_task_id,
      clarify: toolPolicy.allow_clarify_hint,
    },
  };
}

export function renderOrchestrateAgentMetaBlock(meta: OrchestrateAgentMeta): string {
  return [
    ORCHESTRATE_AGENT_META_BEGIN,
    JSON.stringify(meta, null, 2),
    ORCHESTRATE_AGENT_META_END,
  ].join("\n");
}
