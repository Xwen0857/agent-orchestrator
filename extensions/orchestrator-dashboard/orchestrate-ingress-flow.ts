import { orchestrateEntryActionStep } from "./orchestrate-entry-action-orchestrator.js";
import { buildIngressDebugProjection } from "./orchestrate-ingress-debug.js";
import { buildEntryAgentContextPayload } from "./orchestrate-ingress-presenter.js";
import { hydrateIngressState } from "./orchestrate-ingress-repository.js";
import {
  compileAndPersistEffectivePatch,
  releaseEffectivePatchIfNeeded,
} from "./orchestrate-ingress-release.js";
import {
  appendAmendmentEntriesToLogV2,
  buildInitialPlannerAmendmentWatermarkV2,
  type ReceptionistAmendmentItem,
} from "./orchestrate-receptionist.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import type { IngressHydratedState, IngressRepository } from "./orchestrate-ingress-types.js";

export { buildEntryAgentContextPayload } from "./orchestrate-ingress-presenter.js";
export { hydrateIngressState } from "./orchestrate-ingress-repository.js";

export async function processRunningAmendmentMessage(params: {
  state: IngressHydratedState;
  repository: IngressRepository;
  sessionKey: string;
  latestUserMessage: string;
  repoRoot: string;
  taskFoldersRoot: string;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "planner_apply_amendment_batch";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  now?: string;
}): Promise<IngressHydratedState> {
  const message = params.latestUserMessage.trim();
  if (!message || message.startsWith("/")) {
    return params.state;
  }
  const now = params.now ?? new Date().toISOString();
  const previousQueueItemCount = params.state.queue?.items.length ?? 0;
  const step = orchestrateEntryActionStep({
    session: params.state.session,
    latestUserMessage: message,
    existingQueue: params.state.queue,
    now,
  });
  params.state.session = step.nextSession;
  params.state.queue = step.nextQueue;
  await params.writeOrchestrateSession(params.state.session);
  if (step.queueMutation === "write_queue" && params.state.queue) {
    await params.repository.persistQueueCapture(params.state);
  }
  if (
    params.state.session.status === "RUNNING" &&
    params.state.session.last_run &&
    step.actionResolution?.route === "amend_existing_task" &&
    params.state.queue
  ) {
    const appendedItems: ReceptionistAmendmentItem[] =
      params.state.amendmentLog && params.state.amendmentLog.entries.length > 0
        ? params.state.queue.items.slice(previousQueueItemCount)
        : [...params.state.queue.items];
    if (appendedItems.length > 0) {
      const appendResult = appendAmendmentEntriesToLogV2({
        log: params.state.amendmentLog,
        sessionKey: params.sessionKey,
        taskId: params.state.session.last_run.task_id,
        items: appendedItems,
        now,
      });
      params.state.amendmentLog = appendResult.log;
      params.state.amendmentWatermark =
        params.state.amendmentWatermark ??
        buildInitialPlannerAmendmentWatermarkV2({
          sessionKey: params.sessionKey,
          taskId: params.state.session.last_run.task_id,
          now,
        });
      params.state.amendmentWatermark = {
        ...params.state.amendmentWatermark,
        head_version: params.state.amendmentLog.head_version,
        updated_at: now,
      };
      await params.repository.persistAmendmentLedger(params.state);
      await params.emitEvent("orchestrate.receptionist.amendment_logged_v2", {
        session_key: params.sessionKey,
        task_id: params.state.session.last_run.task_id,
        appended_count: appendResult.appended.length,
        head_version: params.state.amendmentLog.head_version,
        applying_version: params.state.amendmentWatermark.applying_version,
        consumed_version: params.state.amendmentWatermark.consumed_version,
      });
      await compileAndPersistEffectivePatch({
        state: params.state,
        repository: params.repository,
        sessionKey: params.sessionKey,
        now,
        emitEvent: params.emitEvent,
      });
    }
  }
  await releaseEffectivePatchIfNeeded({
    state: params.state,
    repository: params.repository,
    sessionKey: params.sessionKey,
    now,
    repoRoot: params.repoRoot,
    taskFoldersRoot: params.taskFoldersRoot,
    writeOrchestrateSession: params.writeOrchestrateSession,
    runWhitelistedScript: params.runWhitelistedScript,
    emitEvent: params.emitEvent,
    manualFlush: step.shouldFlush,
  });
  return params.state;
}

export function buildHydratedIngressDebugProjection(state: IngressHydratedState) {
  return buildIngressDebugProjection({
    session: state.session,
    queue: state.queue,
    amendmentLog: state.amendmentLog,
    effectivePatch: state.effectivePatch,
    amendmentWatermark: state.amendmentWatermark,
    taskMeta: state.taskMeta,
  });
}
