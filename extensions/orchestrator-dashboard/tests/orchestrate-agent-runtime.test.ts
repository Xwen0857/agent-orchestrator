import { describe, expect, it, vi } from "vitest";
import { buildAgentRuntimeController } from "../orchestrate-agent-runtime.js";

describe("orchestrate-agent-runtime", () => {
  it("loads runtime config and safely skips llm when disabled", async () => {
    const controller = buildAgentRuntimeController({
      api: {
        config: {},
      },
      paths: {
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
      io: {
        readJsonOrDefault: async <T>(_targetPath: string, fallback: T) => fallback,
      },
      emitEvent: vi.fn(async () => {}),
      trimOutput: (value: string) => value,
    });

    const runtime = await controller.loadAgentRuntimeConfig();
    expect(runtime.llm.enabled).toBe(false);

    const result = await controller.enhanceStrategyWithLlm({
      strategy: {
        task_id: "task_demo",
        source: {
          channel: "cli",
          sender_id: "tester",
          session_key: "sess_demo",
          message_thread_id: null,
        },
        title: "Demo",
        raw_request: "ship demo",
        goal: "ship demo",
        risk_level: "MEDIUM",
        owner: "tester",
        budget: {
          max_token_cost: 50000,
          max_execution_time_seconds: 3600,
        },
        created_at: "2026-03-02T00:00:00Z",
        status: "drafted",
      },
      freeText: "ship demo",
      operationId: "op_1",
    });

    expect(result.used).toBe(false);
    expect(result.reason).toBe("llm_disabled");
  });
});
