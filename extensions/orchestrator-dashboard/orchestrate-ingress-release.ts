import {
  buildInitialPlannerAmendmentWatermarkV2,
  compilePlannerEffectivePatchV2,
  markPlannerAmendmentApplyingV2,
  markPlannerAmendmentConsumedV2,
  shouldReleasePlannerEffectivePatch,
} from "./orchestrate-receptionist.js";
import type { OrchestrateSessionState } from "./orchestrate-session.js";
import type { IngressHydratedState, IngressRepository } from "./orchestrate-ingress-types.js";
import path from "node:path";

export async function compileAndPersistEffectivePatch(params: {
  state: IngressHydratedState;
  repository: IngressRepository;
  sessionKey: string;
  now: string;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  const runTaskId = params.state.session.last_run?.task_id ?? "";
  if (!runTaskId || !params.state.amendmentLog) {
    return;
  }
  const fromVersion = Math.max(1, (params.state.amendmentWatermark?.consumed_version ?? 0) + 1);
  const toVersion = Math.max(fromVersion - 1, params.state.amendmentLog.head_version);
  params.state.effectivePatch = compilePlannerEffectivePatchV2({
    log: params.state.amendmentLog,
    fromVersion,
    toVersion,
    now: params.now,
  });
  params.state.effectivePatchPath = await params.repository.persistCompiledPatch(params.state);
  await params.emitEvent("orchestrate.receptionist.effective_patch_compiled_v2", {
    session_key: params.sessionKey,
    task_id: runTaskId,
    compiled_from_version: params.state.effectivePatch.compiled_from_versions.from_version,
    compiled_to_version: params.state.effectivePatch.compiled_from_versions.to_version,
    conflict_count: params.state.effectivePatch.conflicts.length,
    effective_patch_path: params.state.effectivePatchPath,
    compiled_at: params.state.effectivePatch.compiled_at,
  });
}

export async function releaseEffectivePatchIfNeeded(params: {
  state: IngressHydratedState;
  repository: IngressRepository;
  sessionKey: string;
  now: string;
  repoRoot: string;
  taskFoldersRoot: string;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "planner_apply_amendment_batch";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  manualFlush: boolean;
}): Promise<void> {
  const runTaskId = params.state.session.last_run?.task_id ?? "";
  if (!runTaskId) {
    return;
  }
  const releaseDecision = shouldReleasePlannerEffectivePatch({
    log: params.state.amendmentLog,
    watermark: params.state.amendmentWatermark,
    now: params.now,
    manualFlush: params.manualFlush,
  });
  if (!releaseDecision.should_release) {
    return;
  }
  if (!params.state.effectivePatch) {
    await compileAndPersistEffectivePatch({
      state: params.state,
      repository: params.repository,
      sessionKey: params.sessionKey,
      now: params.now,
      emitEvent: params.emitEvent,
    });
  }
  if (!params.state.effectivePatch) {
    throw new Error("effective patch v2 missing for release");
  }
  if (!params.state.effectivePatchPath) {
    params.state.effectivePatchPath = await params.repository.persistCompiledPatch(params.state);
  }
  params.state.amendmentWatermark =
    params.state.amendmentWatermark ??
    buildInitialPlannerAmendmentWatermarkV2({
      sessionKey: params.sessionKey,
      taskId: runTaskId,
      now: params.now,
    });
  params.state.amendmentWatermark = markPlannerAmendmentApplyingV2({
    watermark: params.state.amendmentWatermark,
    sessionKey: params.sessionKey,
    taskId: runTaskId,
    headVersion:
      params.state.amendmentLog?.head_version ?? params.state.effectivePatch.compiled_from_versions.to_version,
    reason: releaseDecision.reason ?? "wait_timeout",
    now: params.now,
  });
  await params.repository.beginPatchRelease(params.state);
  await params.emitEvent("orchestrate.receptionist.release_triggered_v2", {
    session_key: params.sessionKey,
    task_id: runTaskId,
    reason: params.state.amendmentWatermark.last_release_reason,
    head_version: params.state.amendmentWatermark.head_version,
    applying_version: params.state.amendmentWatermark.applying_version,
    consumed_version: params.state.amendmentWatermark.consumed_version,
    pending_count: releaseDecision.pending_count,
    wait_ms: releaseDecision.wait_ms,
  });
  const taskDir = path.join(params.taskFoldersRoot, runTaskId);
  await params.runWhitelistedScript({
    repoRoot: params.repoRoot,
    scriptName: "planner_apply_amendment_batch",
    args: [
      "--task-dir",
      path.relative(params.repoRoot, taskDir) || ".",
      "--effective-patch",
      path.relative(params.repoRoot, params.state.effectivePatchPath) || ".",
      "--expected-applying-version",
      String(params.state.amendmentWatermark.applying_version),
    ],
  });
  params.state.amendmentWatermark = markPlannerAmendmentConsumedV2({
    watermark: params.state.amendmentWatermark,
    now: new Date().toISOString(),
  });
  await params.repository.completePatchRelease(params.state, params.now);
  params.state.session = {
    ...params.state.session,
    receptionist: {
      ...params.state.session.receptionist,
      amendment_queue_open: false,
    },
  };
  await params.writeOrchestrateSession(params.state.session);
}
