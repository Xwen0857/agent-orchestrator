import {
  applyMessageToDraft,
  buildEmptyOrchestrateSession,
  renderSessionSummary,
  resolveConversationSessionKey,
  type OrchestrateSessionState,
} from "./orchestrate-session.js";

type HandleIntakeSubcommandParams = {
  payload: string;
  ctx: {
    channel?: string;
    senderId?: string;
    sessionKey?: string;
    commandTargetSessionKey?: string;
  };
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  renderOrchestrateHelp: () => string;
};

export async function handleIntakeSubcommand(
  params: HandleIntakeSubcommandParams,
): Promise<string> {
  const freeText = params.payload.trim();
  if (!freeText) {
    return `missing request text\n\n${params.renderOrchestrateHelp()}`;
  }
  const sessionKey = resolveConversationSessionKey(params.ctx) || "legacy_intake";
  const existing =
    (await params.readOrchestrateSession(sessionKey)) ??
    buildEmptyOrchestrateSession({
      sessionKey,
      channel: params.ctx.channel ?? "cli",
      senderId: params.ctx.senderId ?? "unknown",
    });
  const next = applyMessageToDraft(existing, freeText);
  await params.writeOrchestrateSession(next);
  await params.emitEvent("orchestrate.intake.created", {
    session_key: sessionKey,
    compatibility: "legacy_intake_redirected_to_session",
  });
  return [
    "intake is now a legacy helper",
    "content was added into the current orchestrate session draft",
    "",
    renderSessionSummary(next),
    "",
    "recommended next steps:",
    "1. continue chatting in this session",
    "2. run /orchestrate summary",
    "3. run /orchestrate run",
  ].join("\n");
}
