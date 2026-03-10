import type {
  PlannerAmendmentWatermarkV2,
  PlannerEffectivePatchV2,
  ReceptionistAmendmentLogV2,
  ReceptionistAmendmentQueue,
} from "./orchestrate-receptionist.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";

export type IngressHydratedState = {
  session: OrchestrateSessionState;
  queue: ReceptionistAmendmentQueue | null;
  amendmentLog: ReceptionistAmendmentLogV2 | null;
  amendmentWatermark: PlannerAmendmentWatermarkV2 | null;
  effectivePatch: PlannerEffectivePatchV2 | null;
  effectivePatchPath: string;
  taskMeta: Record<string, unknown> | null;
};

export type IngressRepository = {
  hydrateState(params: {
    session: OrchestrateSessionState;
    sessionKey: string;
  }): Promise<IngressHydratedState>;
  refreshTaskMeta(state: IngressHydratedState): Promise<Record<string, unknown> | null>;
  persistQueueCapture(state: IngressHydratedState): Promise<void>;
  persistAmendmentLedger(state: IngressHydratedState): Promise<void>;
  persistCompiledPatch(state: IngressHydratedState): Promise<string>;
  beginPatchRelease(state: IngressHydratedState): Promise<void>;
  completePatchRelease(state: IngressHydratedState, now: string): Promise<void>;
};
