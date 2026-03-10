import type { OrchestrateStateIo } from "./orchestrate-state.js";

const ENTRY_AGENT_DECODE_CONTRACT_BEGIN = "BEGIN_ORCHESTRATE_AGENT_DECODE_CONTRACT";
const ENTRY_AGENT_DECODE_CONTRACT_END = "END_ORCHESTRATE_AGENT_DECODE_CONTRACT";
const ENTRY_AGENT_DECODE_CONTRACT_CACHE_TTL_MS = 5_000;
const ENTRY_AGENT_DECODE_CONTRACT_ISSUE_DEDUPE_MS = 60_000;

type DecodeContractCache = {
  path: string;
  loadedAtMs: number;
  block: string;
};

type DecodeContractIssueCache = {
  key: string;
  reportedAtMs: number;
};

let decodeContractCache: DecodeContractCache | null = null;
let decodeContractIssueCache: DecodeContractIssueCache | null = null;

export function resetDecodeContractCacheForTest(): void {
  decodeContractCache = null;
  decodeContractIssueCache = null;
}

async function emitDecodeContractIssue(params: {
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  issue: "missing" | "empty" | "read_failed";
  contractPath: string;
  errorMessage?: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = params.nowMs ?? Date.now();
  const key = `${params.issue}:${params.contractPath}`;
  if (
    decodeContractIssueCache &&
    decodeContractIssueCache.key === key &&
    nowMs - decodeContractIssueCache.reportedAtMs < ENTRY_AGENT_DECODE_CONTRACT_ISSUE_DEDUPE_MS
  ) {
    return;
  }
  decodeContractIssueCache = { key, reportedAtMs: nowMs };
  await params.emitEvent("orchestrate.entry_agent.decode_contract_issue", {
    issue: params.issue,
    contract_path: params.contractPath,
    error_message: params.errorMessage ?? "",
  });
}

export async function loadEntryAgentDecodeContractBlock(params: {
  contractPath: string;
  io: OrchestrateStateIo & { readText: (targetPath: string) => Promise<string> };
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<string> {
  const nowMs = Date.now();
  if (
    decodeContractCache &&
    decodeContractCache.path === params.contractPath &&
    nowMs - decodeContractCache.loadedAtMs < ENTRY_AGENT_DECODE_CONTRACT_CACHE_TTL_MS
  ) {
    return decodeContractCache.block;
  }
  if (!params.contractPath || !(await params.io.fileExists(params.contractPath))) {
    decodeContractCache = {
      path: params.contractPath,
      loadedAtMs: nowMs,
      block: "",
    };
    await emitDecodeContractIssue({
      emitEvent: params.emitEvent,
      issue: "missing",
      contractPath: params.contractPath,
      nowMs,
    });
    return "";
  }
  try {
    const content = (await params.io.readText(params.contractPath)).trim();
    if (!content) {
      decodeContractCache = {
        path: params.contractPath,
        loadedAtMs: nowMs,
        block: "",
      };
      await emitDecodeContractIssue({
        emitEvent: params.emitEvent,
        issue: "empty",
        contractPath: params.contractPath,
        nowMs,
      });
      return "";
    }
    const block = [
      ENTRY_AGENT_DECODE_CONTRACT_BEGIN,
      content,
      ENTRY_AGENT_DECODE_CONTRACT_END,
    ].join("\n");
    decodeContractCache = {
      path: params.contractPath,
      loadedAtMs: nowMs,
      block,
    };
    return block;
  } catch {
    decodeContractCache = {
      path: params.contractPath,
      loadedAtMs: nowMs,
      block: "",
    };
    await emitDecodeContractIssue({
      emitEvent: params.emitEvent,
      issue: "read_failed",
      contractPath: params.contractPath,
      nowMs,
    });
    return "";
  }
}
