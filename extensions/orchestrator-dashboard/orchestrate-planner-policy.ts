import {
  buildDefaultPlannerPolicyDocument,
  extractPlannerPolicyDocument,
  type PlannerPolicyDocument,
  type PlannerPolicyProvider,
} from "./orchestrate-planner-contract.js";

type JsonReader = <T>(targetPath: string, fallback: T) => Promise<T>;

export type LoadPlannerPolicyDocumentParams = {
  io: {
    readJsonOrDefault: JsonReader;
  };
  paths: {
    plannerPolicyConfig: string;
    agentRuntimeConfig: string;
  };
};

function hasKeys(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value as Record<string, unknown>).length > 0;
}

function mergeLegacyPlannerAgent(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const basePlanner =
    base.planner_agent && typeof base.planner_agent === "object" && !Array.isArray(base.planner_agent)
      ? (base.planner_agent as Record<string, unknown>)
      : undefined;
  const localPlanner =
    local.planner_agent && typeof local.planner_agent === "object" && !Array.isArray(local.planner_agent)
      ? (local.planner_agent as Record<string, unknown>)
      : undefined;

  if (!basePlanner && !localPlanner) {
    return undefined;
  }

  const baseToken =
    basePlanner?.token_priority && typeof basePlanner.token_priority === "object" && !Array.isArray(basePlanner.token_priority)
      ? (basePlanner.token_priority as Record<string, unknown>)
      : {};
  const localToken =
    localPlanner?.token_priority && typeof localPlanner.token_priority === "object" && !Array.isArray(localPlanner.token_priority)
      ? (localPlanner.token_priority as Record<string, unknown>)
      : {};
  const baseMcp =
    basePlanner?.mcp_soft_boundary &&
    typeof basePlanner.mcp_soft_boundary === "object" &&
    !Array.isArray(basePlanner.mcp_soft_boundary)
      ? (basePlanner.mcp_soft_boundary as Record<string, unknown>)
      : {};
  const localMcp =
    localPlanner?.mcp_soft_boundary &&
    typeof localPlanner.mcp_soft_boundary === "object" &&
    !Array.isArray(localPlanner.mcp_soft_boundary)
      ? (localPlanner.mcp_soft_boundary as Record<string, unknown>)
      : {};

  return {
    ...basePlanner,
    ...localPlanner,
    token_priority: {
      ...baseToken,
      ...localToken,
    },
    mcp_soft_boundary: {
      ...baseMcp,
      ...localMcp,
    },
  };
}

function applyLocalCompatOverride(
  policy: PlannerPolicyDocument,
  localRuntime: Record<string, unknown>,
): PlannerPolicyDocument {
  if (!policy.compat.allow_agent_runtime_fallback) {
    return policy;
  }
  const localPlanner = mergeLegacyPlannerAgent({}, localRuntime);
  if (!localPlanner) {
    return policy;
  }
  const mergedPlanner = mergeLegacyPlannerAgent(
    {
      planner_agent: policy.planner_agent as unknown as Record<string, unknown>,
    },
    {
      planner_agent: localPlanner,
    },
  );
  return extractPlannerPolicyDocument({
    ...policy,
    planner_agent: mergedPlanner,
  });
}

export async function loadPlannerPolicyDocument(
  params: LoadPlannerPolicyDocumentParams,
): Promise<PlannerPolicyDocument> {
  const [fromPolicy, fromAgentRuntime, fromAgentRuntimeLocal] = await Promise.all([
    params.io.readJsonOrDefault<Record<string, unknown>>(params.paths.plannerPolicyConfig, {}),
    params.io.readJsonOrDefault<Record<string, unknown>>(params.paths.agentRuntimeConfig, {}),
    params.io.readJsonOrDefault<Record<string, unknown>>(
      params.paths.agentRuntimeConfig.replace(/\.json$/u, ".local.json"),
      {},
    ),
  ]);

  if (hasKeys(fromPolicy)) {
    return applyLocalCompatOverride(extractPlannerPolicyDocument(fromPolicy), fromAgentRuntimeLocal);
  }

  const legacyPlannerAgent = mergeLegacyPlannerAgent(fromAgentRuntime, fromAgentRuntimeLocal);
  if (legacyPlannerAgent) {
    return extractPlannerPolicyDocument({
      policy_id: "planner_legacy_fallback",
      planner_agent: legacyPlannerAgent,
      compat: {
        allow_agent_runtime_fallback: true,
      },
    });
  }

  return buildDefaultPlannerPolicyDocument();
}

export function buildPlannerPolicyProvider(
  params: LoadPlannerPolicyDocumentParams,
): PlannerPolicyProvider {
  return {
    loadPlannerPolicy: async () => loadPlannerPolicyDocument(params),
  };
}
