import { buildStrategyFromSummary } from "../orchestrate-command.js";
import { describe, expect, it } from "vitest";

describe("orchestrate-command transport boundaries", () => {
  it("keeps structured summary fields separate from the transport goal", () => {
    const strategy = buildStrategyFromSummary({
      summary: {
        task_goal: "Ship websocket calculator",
        constraints: ["python only", "use local port"],
        deliverables: ["source", "tests"],
        notes: ["prefer websocket transport"],
      },
      taskId: "task_demo",
      channel: "cli",
      senderId: "tester",
      sessionKey: "sess_demo",
      messageThreadId: 7,
    });

    expect(strategy.goal).toBe("Ship websocket calculator");
    expect(strategy.execution.requested_mode).toBe("auto");
    expect(strategy.summary_input).toEqual({
      task_goal: "Ship websocket calculator",
      constraints: ["python only", "use local port"],
      deliverables: ["source", "tests"],
      notes: ["prefer websocket transport"],
    });
    expect(strategy.raw_request).toBe("Ship websocket calculator");
  });
});
