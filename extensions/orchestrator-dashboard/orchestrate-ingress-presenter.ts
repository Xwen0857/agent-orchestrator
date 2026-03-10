import {
  buildOrchestrateAgentMeta,
  renderOrchestrateAgentMetaBlock,
} from "./orchestrate-agent-meta.js";
import { loadEntryAgentDecodeContractBlock } from "./orchestrate-entry-decode-contract.js";
import type { IngressHydratedState } from "./orchestrate-ingress-types.js";
import { buildEntryAgentContext } from "./orchestrate-session.js";
import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";
import type { OrchestrateStateIo } from "./orchestrate-state.js";

export async function buildEntryAgentContextPayload(params: {
  state: IngressHydratedState;
  entryAgentDecodeContractPath: string;
  io: OrchestrateStateIo & { readText: (targetPath: string) => Promise<string> };
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  runtimeConsistency?: Pick<RuntimeConsistencySnapshot, "runtimeConsistency"> | null;
}): Promise<{ prependContext: string }> {
  const agentMetaBlock = renderOrchestrateAgentMetaBlock(
    buildOrchestrateAgentMeta({
      session: params.state.session,
      amendmentQueue: params.state.queue,
      amendmentWatermark: params.state.amendmentWatermark,
      taskMeta: params.state.taskMeta,
      runtimeConsistency: params.runtimeConsistency,
    }),
  );
  const decodeContractBlock = await loadEntryAgentDecodeContractBlock({
    contractPath: params.entryAgentDecodeContractPath,
    io: params.io,
    emitEvent: params.emitEvent,
  });
  return {
    prependContext: buildEntryAgentContext(params.state.session, agentMetaBlock, decodeContractBlock),
  };
}
