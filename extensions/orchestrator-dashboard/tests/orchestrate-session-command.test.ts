import { handleSessionSubcommand } from "../orchestrate-session-command.js";
import { buildSessionFileStem } from "../orchestrate-session.js";
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
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
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
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      emitEvent,
    });

    expect(text).toContain("orchestrate receptionist mode activated");
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
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: false,
        action_route: "intake_new_task" as const,
        action_target_task_id: null,
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
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
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
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
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      emitEvent,
    });

    expect(text).toContain("summary_id:");
    expect(text).toContain("orchestrate receptionist briefing");
    expect(text).toContain("task_goal: Build websocket calculator");
    expect(writes.some((entry) => entry.path.includes(".summary.json"))).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.session.summary_created",
      expect.objectContaining({ session_key: "sess_demo" }),
    );
  });

  it("includes planner replan state in running receptionist briefings", async () => {
    const writes: Array<{ path: string; payload: unknown }> = [];
    const sessionStem = buildSessionFileStem("sess_demo");
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_demo",
      channel: "cli",
      sender_id: "tester",
      status: "RUNNING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: false,
        action_route: "amend_existing_task" as const,
        action_target_task_id: "task_demo",
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
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
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };

    const text = await handleSessionSubcommand({
      subcommand: "summary",
      ctx: { sessionKey: "sess_demo" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
      },
      io: {
        fileExists: vi.fn(
          async (target) =>
            target === "/repo/tasks/task_demo/meta.json" ||
            target === `/repo/batches/${sessionStem}.watermark.v2.json`,
        ),
        readJsonOrDefault: vi.fn(async (target, fallback) => {
          if (target === "/repo/tasks/task_demo/meta.json") {
            return {
              planner_replan: {
                status: "applied",
                impact: "hard",
                worker_policy: "pause_and_require_replan",
              },
              runtime_replan: {
                consume_status: "paused",
              },
            } as typeof fallback;
          }
          if (target === `/repo/batches/${sessionStem}.watermark.v2.json`) {
            return {
              schema_version: "planner-amendment-watermark-v2",
              session_key: "sess_demo",
              task_id: "task_demo",
              head_version: 5,
              applying_version: 5,
              consumed_version: 3,
              last_release_reason: "manual_flush",
              updated_at: "2026-03-02T00:06:00.000Z",
            } as typeof fallback;
          }
          return fallback;
        }),
        writeJsonAtomic: vi.fn(async (target, payload) => {
          writes.push({ path: target, payload });
        }),
      },
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async (next) => {
        writes.push({ path: "/repo/sessions/sess_demo.json", payload: next });
      }),
      runWhitelistedScript: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
      emitEvent: vi.fn(async () => {}),
    });

    expect(text).toContain("planner_replan_status: applied");
    expect(text).toContain("planner_replan_impact: hard");
    expect(text).toContain("planner_replan_worker_policy: pause_and_require_replan");
    expect(text).toContain("runtime_replan_consume_status: paused");
    expect(text).toContain("amendment_head_version: 5");
    expect(text).toContain("amendment_consumed_version: 3");
    expect(text).toContain("amendment_release_reason: manual_flush");
  });

  it("forces draft-summary path when running session is switched to intake_new_task", async () => {
    const writes: Array<{ path: string; payload: unknown }> = [];
    const session = {
      schema_version: "orchestrate-session-v1" as const,
      session_key: "sess_demo",
      channel: "cli",
      sender_id: "tester",
      status: "RUNNING" as const,
      started_at: "2026-03-02T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      entry_agent: { active: true, mode: "conversation_capture" as const },
      receptionist: {
        active: true,
        mode: "guided_intake" as const,
        last_briefing_at: "2026-03-02T00:00:00.000Z",
        pending_questions: [],
        amendment_queue_open: false,
        action_route: "intake_new_task" as const,
        action_target_task_id: null,
        clarification_required: false,
        last_action_at: "2026-03-02T00:00:00.000Z",
      },
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
      last_run: {
        task_id: "task_demo",
        started_at: "2026-03-02T00:05:00.000Z",
        summary_id: "sum_demo",
      },
    };
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const emitEvent = vi.fn(async () => {});

    const text = await handleSessionSubcommand({
      subcommand: "summary",
      ctx: { sessionKey: "sess_demo" },
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      paths: {
        pathState: "/repo/path_state.json",
        orchestrateSessionsDir: "/repo/sessions",
        orchestrateRequestsDir: "/repo/requests",
        orchestrateAmendmentsDir: "/repo/amendments",
        orchestrateAmendmentBatchesDir: "/repo/batches",
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
      runWhitelistedScript,
      emitEvent,
    });

    expect(text).toContain("summary_id:");
    expect(text).toContain("summary_path:");
    expect(text).not.toContain("planner_replan_status:");
    expect(runWhitelistedScript).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      "orchestrate.session.summary_created",
      expect.objectContaining({ session_key: "sess_demo" }),
    );
  });
});
