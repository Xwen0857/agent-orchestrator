import {
  appendAmendmentItems,
  applyReceptionistIntakeMessage,
  buildReceptionistBriefing,
  buildReceptionistStartText,
  shouldFlushAmendmentQueue,
  type PlannerAmendmentWatermarkV2,
  type ReceptionistAmendmentQueue,
} from "./orchestrate-receptionist.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";

export function handleReceptionistStart(session: OrchestrateSessionState): string {
  return buildReceptionistStartText(session);
}

export function handleReceptionistBriefing(params: {
  session: OrchestrateSessionState;
  queue?: ReceptionistAmendmentQueue | null;
  amendmentWatermark?: PlannerAmendmentWatermarkV2 | null;
  replan?: {
    status: string;
    impact: string;
    workerPolicy: string;
    executionStatus: string;
  } | null;
}): string {
  return buildReceptionistBriefing(params);
}

export function handleReceptionistMessage(params: {
  session: OrchestrateSessionState;
  message: string;
  now?: string;
}): OrchestrateSessionState {
  return applyReceptionistIntakeMessage(params.session, params.message, { now: params.now });
}

export function handleReceptionistAmendment(params: {
  session: OrchestrateSessionState;
  existingQueue: ReceptionistAmendmentQueue | null;
  message: string;
  now?: string;
}): { session: OrchestrateSessionState; queue: ReceptionistAmendmentQueue | null; shouldFlush: boolean } {
  const result = appendAmendmentItems(params);
  return {
    ...result,
    shouldFlush: shouldFlushAmendmentQueue(result.queue, { now: params.now }),
  };
}
