import { extractRuntimeReplanSignals } from "./orchestrate-runtime-contract.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import type {
  PlannerAmendmentWatermarkV2,
  PlannerEffectivePatchV2,
  ReceptionistAmendmentLogV2,
  ReceptionistAmendmentQueue,
} from "./orchestrate-receptionist.js";

export type IngressDebugProjection = {
  session_status: OrchestrateSessionState["status"];
  action_route: OrchestrateSessionState["receptionist"]["action_route"];
  action_target_task_id: string | null;
  queue: {
    status: ReceptionistAmendmentQueue["status"] | "none";
    item_count: number;
  };
  log: {
    head_version: number;
    entry_count: number;
  };
  effective_patch: {
    from_version: number;
    to_version: number;
    conflict_count: number;
  };
  watermark: {
    head_version: number;
    applying_version: number;
    consumed_version: number;
    last_release_reason: PlannerAmendmentWatermarkV2["last_release_reason"];
  };
  replan: {
    status: string | null;
    execution_status: string | null;
  };
};

export function buildIngressDebugProjection(params: {
  session: OrchestrateSessionState;
  queue?: ReceptionistAmendmentQueue | null;
  amendmentLog?: ReceptionistAmendmentLogV2 | null;
  effectivePatch?: PlannerEffectivePatchV2 | null;
  amendmentWatermark?: PlannerAmendmentWatermarkV2 | null;
  taskMeta?: Record<string, unknown> | null;
}): IngressDebugProjection {
  const replan = extractRuntimeReplanSignals(params.taskMeta);
  return {
    session_status: params.session.status,
    action_route: params.session.receptionist.action_route,
    action_target_task_id: params.session.receptionist.action_target_task_id ?? null,
    queue: {
      status: params.queue?.status ?? "none",
      item_count: params.queue?.items.length ?? 0,
    },
    log: {
      head_version: params.amendmentLog?.head_version ?? 0,
      entry_count: params.amendmentLog?.entries.length ?? 0,
    },
    effective_patch: {
      from_version: params.effectivePatch?.compiled_from_versions.from_version ?? 0,
      to_version: params.effectivePatch?.compiled_from_versions.to_version ?? 0,
      conflict_count: params.effectivePatch?.conflicts.length ?? 0,
    },
    watermark: {
      head_version: params.amendmentWatermark?.head_version ?? 0,
      applying_version: params.amendmentWatermark?.applying_version ?? 0,
      consumed_version: params.amendmentWatermark?.consumed_version ?? 0,
      last_release_reason: params.amendmentWatermark?.last_release_reason ?? null,
    },
    replan: {
      status: replan.status,
      execution_status: replan.execution_status,
    },
  };
}

export function renderIngressDebugProjection(projection: IngressDebugProjection): string {
  return [
    "orchestrate ingress debug",
    `session_status: ${projection.session_status}`,
    `action_route: ${projection.action_route}`,
    `action_target_task_id: ${projection.action_target_task_id ?? "(none)"}`,
    `queue_status: ${projection.queue.status}`,
    `queue_item_count: ${String(projection.queue.item_count)}`,
    `log_head_version: ${String(projection.log.head_version)}`,
    `log_entry_count: ${String(projection.log.entry_count)}`,
    `effective_patch_from_version: ${String(projection.effective_patch.from_version)}`,
    `effective_patch_to_version: ${String(projection.effective_patch.to_version)}`,
    `effective_patch_conflict_count: ${String(projection.effective_patch.conflict_count)}`,
    `watermark_head_version: ${String(projection.watermark.head_version)}`,
    `watermark_applying_version: ${String(projection.watermark.applying_version)}`,
    `watermark_consumed_version: ${String(projection.watermark.consumed_version)}`,
    `watermark_last_release_reason: ${projection.watermark.last_release_reason ?? "(none)"}`,
    `replan_status: ${projection.replan.status ?? "(none)"}`,
    `replan_execution_status: ${projection.replan.execution_status ?? "(none)"}`,
  ].join("\n");
}
