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
    expect(runtime.plannerPolicy.schema_version).toBe("planner-policy-v1");
    expect(runtime.plannerAgent).toEqual({
      llm_role: "primary",
      token_priority: {
        tier: "highest",
        reserved_ratio: 0.35,
        min_planning_tokens: 1200,
        max_planning_tokens: 6000,
        allow_inline_override: true,
      },
      mcp_soft_boundary: {
        mode: "bias_plan",
        include_namespace: true,
        include_read_only: true,
        include_profile_name: true,
        include_isolation_enabled: true,
      },
      granularity_guardrails: {
        mode: "soft",
        meta_units: {
          min: 1,
          max: 4,
        },
        leaf_units_per_meta: {
          min_meaningful_scope: "component_sized",
          max: 8,
        },
        allow_agent_override_with_reason: true,
      },
    });

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

  it("normalizes planner_agent overrides from runtime config", async () => {
    const controller = buildAgentRuntimeController({
      api: {
        config: {},
      },
      paths: {
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
      io: {
        readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
          if (targetPath === "/repo/agent_runtime.json") {
            return {
              planner_agent: {
                token_priority: {
                  reserved_ratio: 0.5,
                  min_planning_tokens: 2000,
                },
                mcp_soft_boundary: {
                  include_profile_name: false,
                },
              },
            } as T;
          }
          return fallback;
        },
      },
      emitEvent: vi.fn(async () => {}),
      trimOutput: (value: string) => value,
    });

    const runtime = await controller.loadAgentRuntimeConfig();

    expect(runtime.plannerPolicy.policy_id).toBe("planner_legacy_fallback");
    expect(runtime.plannerAgent).toEqual({
      llm_role: "primary",
      token_priority: {
        tier: "highest",
        reserved_ratio: 0.5,
        min_planning_tokens: 2000,
        max_planning_tokens: 6000,
        allow_inline_override: true,
      },
      mcp_soft_boundary: {
        mode: "bias_plan",
        include_namespace: true,
        include_read_only: true,
        include_profile_name: false,
        include_isolation_enabled: true,
      },
      granularity_guardrails: {
        mode: "soft",
        meta_units: {
          min: 1,
          max: 4,
        },
        leaf_units_per_meta: {
          min_meaningful_scope: "component_sized",
          max: 8,
        },
        allow_agent_override_with_reason: true,
      },
    });
  });

  it("prefers planner_policy.json over legacy planner_agent fallback", async () => {
    const controller = buildAgentRuntimeController({
      api: {
        config: {},
      },
      paths: {
        agentRuntimeConfig: "/repo/agent_runtime.json",
        plannerPolicyConfig: "/repo/planner_policy.json",
      },
      io: {
        readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
          if (targetPath === "/repo/planner_policy.json") {
            return {
              policy_id: "planner_policy_doc",
              planner_agent: {
                token_priority: {
                  min_planning_tokens: 3200,
                },
              },
            } as T;
          }
          if (targetPath === "/repo/agent_runtime.json") {
            return {
              planner_agent: {
                token_priority: {
                  min_planning_tokens: 1200,
                },
              },
            } as T;
          }
          return fallback;
        },
      },
      emitEvent: vi.fn(async () => {}),
      trimOutput: (value: string) => value,
    });

    const runtime = await controller.loadAgentRuntimeConfig();

    expect(runtime.plannerPolicy.policy_id).toBe("planner_policy_doc");
    expect(runtime.plannerAgent.token_priority.min_planning_tokens).toBe(3200);
  });
});
