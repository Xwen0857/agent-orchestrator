import {
  readPlannerAmendmentWatermarkV2Store,
  readPlannerEffectivePatchV2Store,
  readReceptionistAmendmentLogV2Store,
  readReceptionistAmendmentQueueStore,
  writePlannerAmendmentWatermarkV2Store,
  writePlannerEffectivePatchV2Store,
  writeReceptionistAmendmentLogV2Store,
  writeReceptionistAmendmentQueueStore,
} from "./orchestrate-receptionist-state.js";
import type { IngressHydratedState, IngressRepository } from "./orchestrate-ingress-types.js";
import type { OrchestrateStateIo, OrchestrateStatePaths } from "./orchestrate-state.js";
import path from "node:path";

export function createIngressRepository(params: {
  io: OrchestrateStateIo;
  statePaths: OrchestrateStatePaths;
  taskFoldersRoot: string;
}): IngressRepository {
  async function refreshTaskMeta(state: IngressHydratedState): Promise<Record<string, unknown> | null> {
    const runTaskId = state.session.last_run?.task_id ?? "";
    if (state.session.status !== "RUNNING" || !runTaskId) {
      return null;
    }
    const taskMetaPath = path.join(params.taskFoldersRoot, runTaskId, "meta.json");
    if (!(await params.io.fileExists(taskMetaPath))) {
      return null;
    }
    return params.io.readJsonOrDefault<Record<string, unknown>>(taskMetaPath, {});
  }

  return {
    async hydrateState({ session, sessionKey }) {
      const runTaskId = session.last_run?.task_id ?? "";
      const queue = runTaskId
        ? await readReceptionistAmendmentQueueStore({
            io: params.io,
            paths: params.statePaths,
            sessionKey,
            taskId: runTaskId,
          })
        : null;
      const amendmentLog = runTaskId
        ? await readReceptionistAmendmentLogV2Store({
            io: params.io,
            paths: params.statePaths,
            sessionKey,
            taskId: runTaskId,
          })
        : null;
      const amendmentWatermark = runTaskId
        ? await readPlannerAmendmentWatermarkV2Store({
            io: params.io,
            paths: params.statePaths,
            sessionKey,
            taskId: runTaskId,
          })
        : null;
      const effectivePatch = runTaskId
        ? await readPlannerEffectivePatchV2Store({
            io: params.io,
            paths: params.statePaths,
            sessionKey,
            taskId: runTaskId,
          })
        : null;
      const state: IngressHydratedState = {
        session,
        queue,
        amendmentLog,
        amendmentWatermark,
        effectivePatch,
        effectivePatchPath: "",
        taskMeta: null,
      };
      state.taskMeta = await refreshTaskMeta(state);
      return state;
    },

    refreshTaskMeta,

    async persistQueueCapture(state) {
      if (!state.queue) {
        return;
      }
      await writeReceptionistAmendmentQueueStore({
        io: params.io,
        paths: params.statePaths,
        queue: state.queue,
      });
    },

    async persistAmendmentLedger(state) {
      if (state.amendmentLog) {
        await writeReceptionistAmendmentLogV2Store({
          io: params.io,
          paths: params.statePaths,
          log: state.amendmentLog,
        });
      }
      if (state.amendmentWatermark) {
        await writePlannerAmendmentWatermarkV2Store({
          io: params.io,
          paths: params.statePaths,
          watermark: state.amendmentWatermark,
        });
      }
    },

    async persistCompiledPatch(state) {
      if (!state.effectivePatch) {
        return "";
      }
      const target = await writePlannerEffectivePatchV2Store({
        io: params.io,
        paths: params.statePaths,
        patch: state.effectivePatch,
      });
      state.effectivePatchPath = target;
      return target;
    },

    async beginPatchRelease(state) {
      if (!state.amendmentWatermark) {
        return;
      }
      await writePlannerAmendmentWatermarkV2Store({
        io: params.io,
        paths: params.statePaths,
          watermark: state.amendmentWatermark,
        });
    },

    async completePatchRelease(state, now) {
      if (state.amendmentWatermark) {
        await writePlannerAmendmentWatermarkV2Store({
          io: params.io,
          paths: params.statePaths,
          watermark: state.amendmentWatermark,
        });
      }
      if (!state.queue) {
        return;
      }
      state.queue = {
        ...state.queue,
        status: "flushed",
        updated_at: now,
      };
      await writeReceptionistAmendmentQueueStore({
        io: params.io,
        paths: params.statePaths,
        queue: state.queue,
      });
    },
  };
}

export async function hydrateIngressState(params: {
  repository: IngressRepository;
  session: IngressHydratedState["session"];
  sessionKey: string;
}): Promise<IngressHydratedState> {
  return params.repository.hydrateState({
    session: params.session,
    sessionKey: params.sessionKey,
  });
}
