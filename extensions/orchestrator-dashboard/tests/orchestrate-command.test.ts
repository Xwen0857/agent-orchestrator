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
    expect("execution" in strategy).toBe(false);
    expect(strategy.summary_input).toEqual({
      task_goal: "Ship websocket calculator",
      constraints: ["python only", "use local port"],
      deliverables: ["source", "tests"],
      notes: ["prefer websocket transport"],
    });
    expect(strategy.raw_request).toBe("Ship websocket calculator");
  });

  it("does not let legacy requested_mode re-enter the strategy ingress envelope", () => {
    const legacySummary = {
      task_goal: "Ship websocket calculator",
      requested_mode: "multi",
      constraints: ["python only"],
      deliverables: ["source"],
      notes: ["compat field should be ignored"],
    } as {
      task_goal: string;
      requested_mode: "multi";
      constraints: string[];
      deliverables: string[];
      notes: string[];
    };
    const strategy = buildStrategyFromSummary({
      summary: legacySummary,
      taskId: "task_demo",
      channel: "cli",
      senderId: "tester",
      sessionKey: "sess_demo",
      messageThreadId: 7,
    });

    expect("execution" in strategy).toBe(false);
    expect(strategy.planning_decision).toBeUndefined();
    expect(strategy.summary_input).toEqual({
      task_goal: "Ship websocket calculator",
      constraints: ["python only"],
      deliverables: ["source"],
      notes: ["compat field should be ignored"],
    });
  });
});
