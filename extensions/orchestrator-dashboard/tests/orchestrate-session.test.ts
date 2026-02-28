import {
  applyMessageToDraft,
  buildEmptyOrchestrateSession,
  buildSummaryFromDraft,
  getRunnableSummary,
  normalizeOrchestrateSession,
  normalizeOrchestrateSummary,
  parseOrchestrateArgs,
  renderSessionSummary,
  resolveConversationSessionKey,
  validateRunCommandPayload,
} from "../orchestrate-session.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-session pure logic", () => {
  it("parses supported subcommands and payloads", () => {
    expect(parseOrchestrateArgs("run")).toEqual({
      subcommand: "run",
      payload: "",
    });
    expect(parseOrchestrateArgs("path set --project-id demo")).toEqual({
      subcommand: "path",
      payload: "set --project-id demo",
    });
    expect(parseOrchestrateArgs("unknown thing")).toEqual({
      subcommand: "help",
      payload: "",
    });
  });

  it("resolves the effective session key from command context", () => {
    expect(
      resolveConversationSessionKey({
        sessionKey: " fallback ",
        commandTargetSessionKey: " target ",
      }),
    ).toBe("target");
    expect(resolveConversationSessionKey({ sessionKey: " only-session " })).toBe("only-session");
    expect(resolveConversationSessionKey(null)).toBe("");
  });

  it("builds a deterministic empty session shape", () => {
    const session = buildEmptyOrchestrateSession(
      {
        sessionKey: "sess-1",
        channel: "cli",
        senderId: "tester",
      },
      { now: "2026-02-28T08:00:00.000Z" },
    );

    expect(session).toMatchObject({
      session_key: "sess-1",
      channel: "cli",
      sender_id: "tester",
      status: "ACTIVE_DRAFTING",
      started_at: "2026-02-28T08:00:00.000Z",
      updated_at: "2026-02-28T08:00:00.000Z",
      draft: {
        risk_level: "MEDIUM",
        requested_mode: "auto",
        budget: {
          max_token_cost: 50000,
          max_execution_time_seconds: 3600,
        },
      },
    });
  });

  it("applies message content into draft metadata and dedupes duplicate messages", () => {
    const base = buildEmptyOrchestrateSession(
      {
        sessionKey: "sess-2",
        channel: "cli",
        senderId: "tester",
      },
      { now: "2026-02-28T08:00:00.000Z" },
    );

    const next = applyMessageToDraft(
      base,
      "Build websocket python service with tests and runbook. high risk. 强制多任务 project-id: prj_demo workspace-root: apps/demo budget: 1200,90",
      { now: "2026-02-28T08:05:00.000Z" },
    );
    const repeated = applyMessageToDraft(next, next.history[0]?.content ?? "", {
      now: "2026-02-28T08:06:00.000Z",
    });

    expect(next.draft.task_goal).toContain("Build websocket python service");
    expect(next.draft.project_id).toBe("prj_demo");
    expect(next.draft.workspace_root).toBe("apps/demo");
    expect(next.draft.risk_level).toBe("HIGH");
    expect(next.draft.requested_mode).toBe("multi");
    expect(next.draft.budget).toEqual({
      max_token_cost: 1200,
      max_execution_time_seconds: 90,
    });
    expect(next.draft.deliverables).toEqual(["RUNBOOK.md", "tests", "source"]);
    expect(next.history).toHaveLength(1);
    expect(repeated).toBe(next);
  });

  it("builds summaries from the current draft with injected ids", () => {
    const base = buildEmptyOrchestrateSession(
      {
        sessionKey: "sess-3",
        channel: "cli",
        senderId: "tester",
      },
      { now: "2026-02-28T08:00:00.000Z" },
    );
    const drafted = applyMessageToDraft(base, "ship feature", {
      now: "2026-02-28T08:01:00.000Z",
    });
    drafted.latest_summary = {
      summary_id: "sum_prev",
      created_at: "2026-02-28T08:02:00.000Z",
      version: 2,
      status: "drafted",
      content: {
        task_goal: "old",
        project_id: "",
        workspace_root: "",
        risk_level: "MEDIUM",
        budget: {
          max_token_cost: 50000,
          max_execution_time_seconds: 3600,
        },
        requested_mode: "auto",
        constraints: [],
        deliverables: [],
        notes: [],
      },
    };

    const summary = buildSummaryFromDraft(drafted, {
      now: "2026-02-28T08:03:00.000Z",
      createSummaryId: () => "sum_fixed",
    });

    expect(summary).toMatchObject({
      summary_id: "sum_fixed",
      created_at: "2026-02-28T08:03:00.000Z",
      version: 3,
      status: "drafted",
      content: {
        task_goal: "ship feature",
      },
    });
  });

  it("validates run preconditions from the latest summary", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess-4",
      channel: "cli",
      senderId: "tester",
    });

    expect(validateRunCommandPayload(" free text ")).toContain("usage: /orchestrate run");
    const missingSummary = getRunnableSummary(session);
    expect(missingSummary.ok).toBe(false);
    if (missingSummary.ok) {
      throw new Error("expected missing summary");
    }
    expect(missingSummary.error).toContain("ORCHESTRATE_SUMMARY_NOT_FOUND");

    session.latest_summary = {
      summary_id: "sum_ready",
      created_at: "2026-02-28T08:10:00.000Z",
      version: 1,
      status: "drafted",
      content: {
        task_goal: "do work",
        project_id: "",
        workspace_root: "",
        risk_level: "MEDIUM",
        budget: {
          max_token_cost: 50000,
          max_execution_time_seconds: 3600,
        },
        requested_mode: "auto",
        constraints: [],
        deliverables: [],
        notes: [],
      },
    };

    const runnable = getRunnableSummary(session);
    expect(runnable.ok).toBe(true);
    if (!runnable.ok) {
      throw new Error("expected runnable summary");
    }
    expect(runnable.summary.summary_id).toBe("sum_ready");
  });

  it("renders session summaries with placeholder fields", () => {
    const session = buildEmptyOrchestrateSession({
      sessionKey: "sess-5",
      channel: "cli",
      senderId: "tester",
    });

    expect(renderSessionSummary(session)).toContain("latest_summary_id: (none)");
    expect(renderSessionSummary(session)).toContain("task_goal: (none)");
  });

  it("normalizes malformed stored summaries into stable defaults", () => {
    const summary = normalizeOrchestrateSummary(
      {
        summary_id: 42,
        created_at: "",
        version: "0",
        status: "broken",
        content: {
          task_goal: "ship it",
          risk_level: "INVALID",
          budget: {
            max_token_cost: "abc",
            max_execution_time_seconds: "120",
          },
          requested_mode: "weird",
          constraints: ["keep", 42, ""],
          deliverables: [null, "tests"],
          notes: ["note"],
        },
      },
      { now: "2026-02-28T09:00:00.000Z" },
    );

    expect(summary).toEqual({
      summary_id: "",
      created_at: "2026-02-28T09:00:00.000Z",
      version: 1,
      status: "drafted",
      content: {
        task_goal: "ship it",
        project_id: "",
        workspace_root: "",
        risk_level: "MEDIUM",
        budget: {
          max_token_cost: 50000,
          max_execution_time_seconds: 120,
        },
        requested_mode: "auto",
        constraints: ["keep"],
        deliverables: ["tests"],
        notes: ["note"],
      },
    });
  });

  it("normalizes malformed stored sessions and preserves schema compatibility", () => {
    const fallback = buildEmptyOrchestrateSession(
      {
        sessionKey: "fallback-session",
        channel: "unknown",
        senderId: "unknown",
      },
      { now: "2026-02-28T09:10:00.000Z" },
    );

    const session = normalizeOrchestrateSession(
      {
        session_key: " persisted ",
        channel: " chat ",
        sender_id: " user-1 ",
        status: "INVALID",
        started_at: "",
        updated_at: "2026-02-28T09:11:00.000Z",
        draft: {
          task_goal: " build feature ",
          risk_level: "LOW",
          requested_mode: "multi",
          constraints: ["one", "", 2],
          deliverables: ["artifact", null],
          notes: [false, "note"],
          open_questions: ["q1", ""],
          budget: {
            max_token_cost: "700",
            max_execution_time_seconds: 0,
          },
        },
        history: [
          null,
          {
            timestamp: "",
            role: "entry_agent",
            kind: "summary",
            content: " sum_1 ",
          },
          {
            timestamp: "2026-02-28T09:12:00.000Z",
            role: "bad-role",
            kind: "bad-kind",
            content: 9,
          },
        ],
        latest_summary: {
          summary_id: "sum_2",
          created_at: "2026-02-28T09:13:00.000Z",
          version: "2",
          status: "confirmed",
          content: {
            task_goal: "ship",
          },
        },
        last_run: {
          task_id: "task_1",
          summary_id: "sum_2",
        },
      },
      {
        fallbackSession: fallback,
        now: "2026-02-28T09:15:00.000Z",
      },
    );

    expect(session).toMatchObject({
      schema_version: "orchestrate-session-v1",
      session_key: "persisted",
      channel: "chat",
      sender_id: "user-1",
      status: "ACTIVE_DRAFTING",
      started_at: "2026-02-28T09:10:00.000Z",
      updated_at: "2026-02-28T09:11:00.000Z",
      draft: {
        task_goal: "build feature",
        risk_level: "LOW",
        requested_mode: "multi",
        constraints: ["one"],
        deliverables: ["artifact"],
        notes: ["note"],
        open_questions: ["q1"],
        budget: {
          max_token_cost: 700,
          max_execution_time_seconds: 3600,
        },
      },
      latest_summary: {
        summary_id: "sum_2",
        version: 2,
        status: "confirmed",
      },
      last_run: {
        task_id: "task_1",
        started_at: "",
        summary_id: "sum_2",
      },
    });
    expect(session.history).toEqual([
      {
        timestamp: "2026-02-28T09:15:00.000Z",
        role: "entry_agent",
        kind: "summary",
        content: "sum_1",
      },
      {
        timestamp: "2026-02-28T09:12:00.000Z",
        role: "user",
        kind: "message",
        content: "",
      },
    ]);
  });
});
