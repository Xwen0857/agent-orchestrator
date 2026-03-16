import { describe, expect, it } from "vitest";
import { buildPlannerPolicyProvider, loadPlannerPolicyDocument } from "../orchestrate-planner-policy.js";

describe("orchestrate-planner-policy", () => {
  it("prefers planner_policy.json when present", async () => {
    const policy = await loadPlannerPolicyDocument({
      io: {
        readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
          if (targetPath === "/repo/planner_policy.json") {
            return {
              policy_id: "planner_remote_ready",
              compat: {
                allow_agent_runtime_fallback: true,
              },
              planner_agent: {
                token_priority: {
                  min_planning_tokens: 1600,
                },
              },
              execution_targets: {
                distributed: {
                  enabled: true,
                  planner_transport: "reserved",
                  dispatch_endpoint: "https://planner.internal/dispatch",
                },
              },
            } as T;
          }
          if (targetPath === "/repo/agent_runtime.local.json") {
            return {
              planner_agent: {
                token_priority: {
                  min_planning_tokens: 3200,
                },
              },
            } as T;
          }
          return fallback;
        },
      },
      paths: {
        plannerPolicyConfig: "/repo/planner_policy.json",
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
    });

    expect(policy.policy_id).toBe("planner_remote_ready");
    expect(policy.planner_agent.token_priority.min_planning_tokens).toBe(3200);
    expect(policy.execution_targets.distributed).toEqual({
      enabled: true,
      planner_transport: "reserved",
      dispatch_endpoint: "https://planner.internal/dispatch",
    });
  });

  it("falls back to legacy agent_runtime planner_agent when planner_policy.json is missing", async () => {
    const provider = buildPlannerPolicyProvider({
      io: {
        readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
          if (targetPath === "/repo/agent_runtime.json") {
            return {
              planner_agent: {
                token_priority: {
                  min_planning_tokens: 1800,
                },
              },
            } as T;
          }
          if (targetPath === "/repo/agent_runtime.local.json") {
            return {
              planner_agent: {
                token_priority: {
                  reserved_ratio: 0.5,
                },
              },
            } as T;
          }
          return fallback;
        },
      },
      paths: {
        plannerPolicyConfig: "/repo/planner_policy.json",
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
    });

    const policy = await provider.loadPlannerPolicy();

    expect(policy.policy_id).toBe("planner_legacy_fallback");
    expect(policy.compat.allow_agent_runtime_fallback).toBe(true);
    expect(policy.planner_agent.token_priority).toEqual({
      tier: "highest",
      reserved_ratio: 0.5,
      min_planning_tokens: 1800,
      max_planning_tokens: 6000,
      allow_inline_override: true,
    });
  });

  it("returns built-in defaults when both policy sources are absent", async () => {
    const policy = await loadPlannerPolicyDocument({
      io: {
        readJsonOrDefault: async <T>(_targetPath: string, fallback: T) => fallback,
      },
      paths: {
        plannerPolicyConfig: "/repo/planner_policy.json",
        agentRuntimeConfig: "/repo/agent_runtime.json",
      },
    });

    expect(policy.schema_version).toBe("planner-policy-v1");
    expect(policy.policy_id).toBe("planner_default");
    expect(policy.compat.allow_agent_runtime_fallback).toBe(true);
  });
});
