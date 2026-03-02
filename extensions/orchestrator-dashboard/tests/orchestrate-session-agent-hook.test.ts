import { handleBeforeAgentStartHook } from "../orchestrate-session-agent-hook.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate session agent hook", () => {
  it("updates active drafting session from latest user message", async () => {
    let writtenTaskGoal = "";
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
        goal_raw: "",
        task_goal: "",
        project_id: "",
        workspace_root: "",
        risk_level: "MEDIUM" as const,
        budget: { max_token_cost: 50000, max_execution_time_seconds: 3600 },
        requested_mode: "auto" as const,
        constraints: [],
        deliverables: [],
        notes: [],
        open_questions: [],
      },
      history: [],
    };

    const result = await handleBeforeAgentStartHook({
      event: {
        messages: [
          { role: "system", content: "ignore" },
          { role: "user", content: "Build a websocket calculator" },
        ],
      },
      ctx: { sessionKey: "sess_demo" },
      readOrchestrateSession: vi.fn(async () => session),
      writeOrchestrateSession: vi.fn(async (next) => {
        writtenTaskGoal = next.draft.task_goal;
      }),
    });

    expect(writtenTaskGoal).toContain("Build a websocket calculator");
    expect(result?.prependContext).toContain("Current draft:");
  });

  it("ignores closed or missing sessions", async () => {
    await expect(
      handleBeforeAgentStartHook({
        event: { messages: [] },
        ctx: { sessionKey: "sess_demo" },
        readOrchestrateSession: vi.fn(async () => null),
        writeOrchestrateSession: vi.fn(async () => {}),
      }),
    ).resolves.toBeUndefined();
  });
});
