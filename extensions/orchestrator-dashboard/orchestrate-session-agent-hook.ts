import {
  applyMessageToDraft,
  buildEntryAgentContext,
  extractLatestUserMessage,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";

export async function handleBeforeAgentStartHook(params: {
  event: { messages?: unknown[] };
  ctx: { sessionKey?: string };
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
}): Promise<{ prependContext: string } | undefined> {
  const sessionKey = (params.ctx.sessionKey ?? "").trim();
  if (!sessionKey) {
    return;
  }
  const existing = await params.readOrchestrateSession(sessionKey);
  if (!existing || (existing.status !== "ACTIVE_DRAFTING" && existing.status !== "SUMMARY_READY")) {
    return;
  }
  const latestUserMessage = extractLatestUserMessage(
    Array.isArray(params.event.messages) ? params.event.messages : undefined,
  );
  let next = existing;
  if (latestUserMessage && !latestUserMessage.startsWith("/")) {
    next = applyMessageToDraft(existing, latestUserMessage);
    await params.writeOrchestrateSession(next);
  }
  return {
    prependContext: buildEntryAgentContext(next),
  };
}
