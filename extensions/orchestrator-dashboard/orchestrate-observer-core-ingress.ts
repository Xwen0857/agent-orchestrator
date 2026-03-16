import {
  buildObserverRefinementPacket,
  type ObserverRefinementPacketV1,
} from "./orchestrate-observer-contract.js";

export type ObserverCoreRefinementIntakeV1 = {
  schema_version: "observer-core-refinement-intake-v1";
  task_id: string;
  request_id: string;
  bridge_fingerprint: string;
  candidate_source: "observer.bridge";
  escalation_reason: string;
  re_refinement_candidate: true;
  execution_exhaustion: ObserverRefinementPacketV1["execution_exhaustion"];
  routing_indexes: ObserverRefinementPacketV1["routing_indexes"];
  evidence_bundle: ObserverRefinementPacketV1["evidence_bundle"];
  fact_chain_key: string;
};

function extractRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildFactChainKey(packet: ObserverRefinementPacketV1): string {
  const moduleId = normalizeString(packet.routing_indexes.module_id) || "module_unassigned";
  const refinementTaskId =
    normalizeString(packet.routing_indexes.refinement_task_id) || packet.task_id || "task_unknown";
  const failureChainId =
    normalizeString(packet.routing_indexes.failure_chain_id) || packet.bridge_fingerprint || "bridge_unknown";
  return `${moduleId}::${refinementTaskId}::${failureChainId}`;
}

export function buildObserverCoreRefinementIntake(
  packetLike: ObserverRefinementPacketV1 | Record<string, unknown>,
): ObserverCoreRefinementIntakeV1 {
  const raw = extractRecord(packetLike);
  const schemaVersion = normalizeString(raw.schema_version);
  if (schemaVersion === "scheduler-escalation-request-v1") {
    throw new Error("observer core ingress rejects raw scheduler escalation requests");
  }
  if (schemaVersion !== "observer-refinement-packet-v1") {
    throw new Error("observer core ingress requires observer-refinement-packet-v1");
  }
  const packet =
    raw as ObserverRefinementPacketV1;
  return {
    schema_version: "observer-core-refinement-intake-v1",
    task_id: packet.task_id,
    request_id: packet.request_id,
    bridge_fingerprint: packet.bridge_fingerprint,
    candidate_source: "observer.bridge",
    escalation_reason: packet.escalation_reason,
    re_refinement_candidate: true,
    execution_exhaustion: packet.execution_exhaustion,
    routing_indexes: packet.routing_indexes,
    evidence_bundle: packet.evidence_bundle,
    fact_chain_key: buildFactChainKey(packet),
  };
}
