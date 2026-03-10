import { resetDecodeContractCacheForTest } from "./orchestrate-entry-decode-contract.js";
import { createIngressRepository } from "./orchestrate-ingress-repository.js";
import {
  buildEntryAgentContextPayload,
  hydrateIngressState,
  processRunningAmendmentMessage,
} from "./orchestrate-ingress-flow.js";
import { extractLatestUserMessage, type OrchestrateSessionState } from "./orchestrate-session.js";
import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";
import type { OrchestrateStateIo, OrchestrateStatePaths } from "./orchestrate-state.js";

export { resetDecodeContractCacheForTest };

export async function handleBeforeAgentStartHook(params: {
  event: { messages?: unknown[] };
  ctx: { sessionKey?: string };
  repoRoot: string;
  taskFoldersRoot: string;
  entryAgentDecodeContractPath: string;
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  statePaths: OrchestrateStatePaths;
  io: OrchestrateStateIo & { readText: (targetPath: string) => Promise<string> };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "planner_apply_amendment_batch";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  getConsistencySnapshot?: () => RuntimeConsistencySnapshot;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<{ prependContext: string } | undefined> {
  const sessionKey = (params.ctx.sessionKey ?? "").trim();
  if (!sessionKey) {
    return;
  }

  const session = await params.readOrchestrateSession(sessionKey);
  if (!session || !session.receptionist.active) {
    return;
  }

  const latestUserMessage = extractLatestUserMessage(
    Array.isArray(params.event.messages) ? params.event.messages : undefined,
  );
  const repository = createIngressRepository({
    io: params.io,
    statePaths: params.statePaths,
    taskFoldersRoot: params.taskFoldersRoot,
  });
  const state = await hydrateIngressState({
    repository,
    session,
    sessionKey,
  });

  if (latestUserMessage) {
    await processRunningAmendmentMessage({
      state,
      repository,
      sessionKey,
      latestUserMessage,
      repoRoot: params.repoRoot,
      taskFoldersRoot: params.taskFoldersRoot,
      writeOrchestrateSession: params.writeOrchestrateSession,
      runWhitelistedScript: params.runWhitelistedScript,
      emitEvent: params.emitEvent,
    });
  }

  state.taskMeta = await repository.refreshTaskMeta(state);

  return buildEntryAgentContextPayload({
    state,
    entryAgentDecodeContractPath: params.entryAgentDecodeContractPath,
    io: params.io,
    emitEvent: params.emitEvent,
    runtimeConsistency: params.getConsistencySnapshot?.() ?? null,
  });
}
