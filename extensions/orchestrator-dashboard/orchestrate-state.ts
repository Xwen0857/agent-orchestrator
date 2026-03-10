import {
  buildSummaryFilePath,
  buildEmptyOrchestrateSession,
  buildSessionFilePath,
  normalizeOrchestrateSession,
  type OrchestrateSessionState,
  type OrchestrateSummary,
} from "./orchestrate-session.js";
import { buildEmptyPathState, normalizePathState, type PathState } from "./orchestrate-path.js";

export type OrchestrateStatePaths = {
  pathState: string;
  orchestrateSessionsDir: string;
  orchestrateRequestsDir: string;
  orchestrateAmendmentsDir: string;
  orchestrateAmendmentBatchesDir: string;
};

export type OrchestrateStateIo = {
  fileExists: (filePath: string) => Promise<boolean>;
  readJsonOrDefault: <T>(filePath: string, fallback: T) => Promise<T>;
  writeJsonAtomic: (filePath: string, payload: unknown) => Promise<void>;
};

export async function readPathStateStore(params: {
  io: OrchestrateStateIo;
  paths: OrchestrateStatePaths;
}): Promise<PathState> {
  const fallback = buildEmptyPathState(new Date(0).toISOString());
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(params.paths.pathState, fallback);
  return normalizePathState(raw, fallback);
}

export async function writePathStateStore(params: {
  io: OrchestrateStateIo;
  paths: OrchestrateStatePaths;
  state: PathState;
}): Promise<void> {
  await params.io.writeJsonAtomic(params.paths.pathState, params.state);
}

export async function readOrchestrateSessionStore(params: {
  io: OrchestrateStateIo;
  paths: OrchestrateStatePaths;
  sessionKey: string;
}): Promise<OrchestrateSessionState | null> {
  if (!params.sessionKey) {
    return null;
  }
  const sessionPath = buildSessionFilePath(params.paths.orchestrateSessionsDir, params.sessionKey);
  if (!(await params.io.fileExists(sessionPath))) {
    return null;
  }
  const fallback = buildEmptyOrchestrateSession({
    sessionKey: params.sessionKey,
    channel: "unknown",
    senderId: "unknown",
  });
  const raw = await params.io.readJsonOrDefault<Record<string, unknown>>(sessionPath, fallback);
  return normalizeOrchestrateSession(raw, { fallbackSession: fallback });
}

export async function writeOrchestrateSessionStore(params: {
  io: OrchestrateStateIo;
  paths: OrchestrateStatePaths;
  session: OrchestrateSessionState;
}): Promise<void> {
  await params.io.writeJsonAtomic(
    buildSessionFilePath(params.paths.orchestrateSessionsDir, params.session.session_key),
    params.session,
  );
}

export async function writeSummarySnapshotStore(params: {
  io: OrchestrateStateIo;
  paths: OrchestrateStatePaths;
  sessionKey: string;
  summary: OrchestrateSummary;
}): Promise<string> {
  const summaryPath = buildSummaryFilePath(
    params.paths.orchestrateRequestsDir,
    params.sessionKey,
    params.summary.summary_id,
  );
  await params.io.writeJsonAtomic(summaryPath, {
    session_key: params.sessionKey,
    summary: params.summary,
  });
  return summaryPath;
}
