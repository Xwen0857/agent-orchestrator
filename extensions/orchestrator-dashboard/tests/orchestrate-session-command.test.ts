import { handleSessionSubcommand } from "../orchestrate-session-command.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate session command handler", () => {
  it("starts a session and emits an event", async () => {
    const writes: unknown[] = [];
    const emitEvent = vi.fn(async () => {});

    const text = await handleSessionSubcommand({
      subcommand: "start",
      ctx: {
        sessionKey: "sess_demo",
        channel: "cli",
        senderId: "tester",
      },
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
      },
      io: {
        fileExists: vi.fn(async () => false),
        readJsonOrDefault: vi.fn(async (_target, fallback) => fallback),
        writeJsonAtomic: vi.fn(async (_target, payload) => {
          writes.push(payload);
        }),
      },
      readOrchestrateSession: vi.fn(async () => null),
      writeOrchestrateSession: vi.fn(async (next) => {
        writes.push(next);
      }),
      emitEvent,
    });

    expect(text).toContain("orchestrate mode activated");
    expect(writes).toHaveLength(1);
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.session.started",
      expect.objectContaining({ session_key: "sess_demo" }),
    );
  });

  it("creates a summary snapshot from an active session", async () => {
    const writes: Array<{ path: string; payload: unknown }> = [];
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_demo",
      channel: "cli",
      sender_id: "tester",
      status: "ACTIVE_DRAFTING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      draft: {
        goal_raw: "Build websocket calculator",
        task_goal: "Build websocket calculator",
        project_id: "prj_demo",
        workspace_root: "prj_demo/runs/demo/workspace",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
        requested_mode: "auto" as const,
        constraints: ["python"],
        deliverables: ["server.py"],
        notes: ["keep simple"],
        open_questions: [],
      },
      history: [],
    };
    const emitEvent = vi.fn(async () => {});

    const text = await handleSessionSubcommand({
      subcommand: "summary",
      ctx: { sessionKey: "sess_demo" },
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
      },
      io: {
        fileExists: vi.fn(async () => false),
        readJsonOrDefault: vi.fn(async (_target, fallback) => fallback),
        writeJsonAtomic: vi.fn(async (target, payload) => {
          writes.push({ path: target, payload });
        }),
      },
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async (next) => {
        writes.push({ path: "/repo/sessions/sess_demo.json", payload: next });
      }),
      emitEvent,
    });

    expect(text).toContain("summary_id:");
    expect(text).toContain("task_goal: Build websocket calculator");
    expect(writes.some((entry) => entry.path.includes(".summary.json"))).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.session.summary_created",
      expect.objectContaining({ session_key: "sess_demo" }),
    );
  });
});
