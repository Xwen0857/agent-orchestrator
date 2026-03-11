import {
  readOrchestrateSessionStore,
  readPathStateStore,
  writeOrchestrateSessionStore,
  writePathStateStore,
  writeSummarySnapshotStore,
  type OrchestrateStateIo,
  type OrchestrateStatePaths,
} from "../orchestrate-state.js";
import { buildEmptyOrchestrateSession } from "../orchestrate-session.js";
import { buildEmptyPathState } from "../orchestrate-path.js";
import { describe, expect, it } from "vitest";

function createMemoryIo(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  const io: OrchestrateStateIo = {
    fileExists: async (filePath) => store.has(filePath),
    readJsonOrDefault: async (filePath, fallback) =>
      (store.has(filePath) ? (store.get(filePath) as typeof fallback) : fallback),
    writeJsonAtomic: async (filePath, payload) => {
      store.set(filePath, payload);
    },
  };
  return { io, store };
}

function buildPaths(): OrchestrateStatePaths {
  return {
    pathState: "/tmp/path_state.json",
    orchestrateSessionsDir: "/tmp/sessions",
    orchestrateRequestsDir: "/tmp/requests",
    orchestrateAmendmentsDir: "/tmp/amendments",
    orchestrateAmendmentBatchesDir: "/tmp/batches",
  };
}

describe("orchestrate-state persistence adapter", () => {
  it("reads and normalizes path state from storage", async () => {
    const paths = buildPaths();
    const { io } = createMemoryIo({
      [paths.pathState]: {
        updated_at: "2026-03-02T00:00:00.000Z",
        projects: {
          demo: {
            workspace_root: "apps/demo",
            updated_at: "2026-03-02T00:00:01.000Z",
            updated_by: "tester",
          },
          "../bad": {
            workspace_root: "apps/bad",
          },
        },
      },
    });

    const state = await readPathStateStore({ io, paths });
    expect(Object.keys(state.projects)).toEqual(["demo"]);
    expect(state.projects.demo?.workspace_root).toBe("apps/demo");
  });

  it("writes path state to the configured storage path", async () => {
    const paths = buildPaths();
    const { io, store } = createMemoryIo();
    const state = buildEmptyPathState("2026-03-02T00:00:00.000Z");
    state.projects.demo = {
      workspace_root: "apps/demo",
      updated_at: "2026-03-02T00:00:01.000Z",
      updated_by: "tester",
    };

    await writePathStateStore({ io, paths, state });
    expect(store.get(paths.pathState)).toEqual(state);
  });

  it("returns null when a session file does not exist", async () => {
    const result = await readOrchestrateSessionStore({
      io: createMemoryIo().io,
      paths: buildPaths(),
      sessionKey: "missing",
    });
    expect(result).toBeNull();
  });

  it("reads and writes orchestrate sessions through session file paths", async () => {
    const paths = buildPaths();
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess_demo",
      channel: "cli",
      senderId: "tester",
    });
    session.draft.task_goal = "Ship dashboard";

    const { io, store } = createMemoryIo();
    await writeOrchestrateSessionStore({ io, paths, session });

    const storedPath = [...store.keys()].find((entry) => entry.includes("/tmp/sessions/"));
    expect(storedPath).toBeTruthy();

    const loaded = await readOrchestrateSessionStore({
      io,
      paths,
      sessionKey: "sess_demo",
    });
    expect(loaded?.draft.task_goal).toBe("Ship dashboard");
  });

  it("writes summary snapshots and returns the snapshot path", async () => {
    const paths = buildPaths();
    const { io, store } = createMemoryIo();
    const summaryPath = await writeSummarySnapshotStore({
      io,
      paths,
      sessionKey: "sess_demo",
      summary: {
        summary_id: "sum_1",
        created_at: "2026-03-02T00:00:00.000Z",
        version: 1,
        status: "drafted",
        content: {
          task_goal: "Ship dashboard",
          project_id: "demo",
          workspace_root: "apps/demo",
          risk_level: "MEDIUM",
          budget: {
            max_token_cost: 50000,
            max_execution_time_seconds: 3600,
          },
          constraints: [],
          deliverables: [],
          notes: [],
        },
      },
    });

    expect(summaryPath).toContain("/tmp/requests/");
    expect(store.get(summaryPath)).toEqual({
      session_key: "sess_demo",
      summary: expect.objectContaining({
        summary_id: "sum_1",
      }),
    });
  });
});
