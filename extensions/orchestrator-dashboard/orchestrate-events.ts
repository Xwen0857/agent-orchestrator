import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { OrchestrateIo } from "./orchestrate-io.js";

export type EmitOrchestratorEvent = (
  type: string,
  payload: Record<string, unknown>,
  req?: IncomingMessage,
) => Promise<void>;

export function createOrchestratorEventEmitter(params: {
  eventsPath: string;
  io: Pick<OrchestrateIo, "appendNdjson">;
}): EmitOrchestratorEvent {
  return async (eventType, payload, req) => {
    await params.io.appendNdjson(params.eventsPath, {
      event_id: `evt_${randomUUID().replace(/-/g, "")}`,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      actor: req?.headers["x-openclaw-actor"] || "orchestrator-dashboard",
      resource: "orchestrator-config",
      payload,
      trace_id: `trace_${randomUUID().replace(/-/g, "")}`,
    });
  };
}
