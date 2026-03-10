import {
  extractObject,
  normalizeBoolean,
  normalizeNumber,
} from "./orchestrate-planner-contract-normalize.js";
import type {
  PlannerAgentPolicy,
  PlannerExecutionTargets,
  PlannerGranularityGuardrails,
  PlannerPolicyDocument,
} from "./orchestrate-planner-contract.js";

export function buildDefaultPlannerGranularityGuardrails(): PlannerGranularityGuardrails {
  return {
    mode: "soft",
    fragment_upper_bound: {
      max_meta_units: 4,
      max_leaf_units_per_meta: 8,
    },
    fragment_lower_bound: {
      min_meaningful_meta_units: 1,
      min_meaningful_leaf_scope: "component_sized",
    },
    guardrail_triggered: false,
    guardrail_notes: [],
  };
}

export function buildDefaultPlannerAgentPolicy(): PlannerAgentPolicy {
  return {
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
  };
}

export function extractPlannerAgentPolicy(value: unknown): PlannerAgentPolicy {
  const raw = extractObject(value);
  const defaults = buildDefaultPlannerAgentPolicy();
  const tokenPriority = extractObject(raw.token_priority);
  const mcpSoftBoundary = extractObject(raw.mcp_soft_boundary);
  const granularityGuardrails = extractObject(raw.granularity_guardrails);
  const metaUnits = extractObject(granularityGuardrails.meta_units);
  const leafUnitsPerMeta = extractObject(granularityGuardrails.leaf_units_per_meta);

  return {
    llm_role: "primary",
    token_priority: {
      tier: "highest",
      reserved_ratio: normalizeNumber(
        tokenPriority.reserved_ratio,
        defaults.token_priority.reserved_ratio,
        0,
      ),
      min_planning_tokens: Math.floor(
        normalizeNumber(
          tokenPriority.min_planning_tokens,
          defaults.token_priority.min_planning_tokens,
          1,
        ),
      ),
      max_planning_tokens: Math.floor(
        normalizeNumber(
          tokenPriority.max_planning_tokens,
          defaults.token_priority.max_planning_tokens,
          1,
        ),
      ),
      allow_inline_override: normalizeBoolean(
        tokenPriority.allow_inline_override,
        defaults.token_priority.allow_inline_override,
      ),
    },
    mcp_soft_boundary: {
      mode: "bias_plan",
      include_namespace: normalizeBoolean(
        mcpSoftBoundary.include_namespace,
        defaults.mcp_soft_boundary.include_namespace,
      ),
      include_read_only: normalizeBoolean(
        mcpSoftBoundary.include_read_only,
        defaults.mcp_soft_boundary.include_read_only,
      ),
      include_profile_name: normalizeBoolean(
        mcpSoftBoundary.include_profile_name,
        defaults.mcp_soft_boundary.include_profile_name,
      ),
      include_isolation_enabled: normalizeBoolean(
        mcpSoftBoundary.include_isolation_enabled,
        defaults.mcp_soft_boundary.include_isolation_enabled,
      ),
    },
    granularity_guardrails: {
      mode: "soft",
      meta_units: {
        min: Math.floor(
          normalizeNumber(
            metaUnits.min,
            defaults.granularity_guardrails.meta_units.min,
            1,
          ),
        ),
        max: Math.floor(
          normalizeNumber(
            metaUnits.max,
            defaults.granularity_guardrails.meta_units.max,
            1,
          ),
        ),
      },
      leaf_units_per_meta: {
        min_meaningful_scope: "component_sized",
        max: Math.floor(
          normalizeNumber(
            leafUnitsPerMeta.max,
            defaults.granularity_guardrails.leaf_units_per_meta.max,
            1,
          ),
        ),
      },
      allow_agent_override_with_reason: normalizeBoolean(
        granularityGuardrails.allow_agent_override_with_reason,
        defaults.granularity_guardrails.allow_agent_override_with_reason,
      ),
    },
  };
}

function buildDefaultPlannerExecutionTargets(): PlannerExecutionTargets {
  return {
    local_threads: {
      enabled: true,
    },
    container: {
      enabled: false,
      planner_transport: "reserved",
    },
    distributed: {
      enabled: false,
      planner_transport: "reserved",
      dispatch_endpoint: "",
    },
  };
}

export function buildDefaultPlannerPolicyDocument(): PlannerPolicyDocument {
  return {
    schema_version: "planner-policy-v1",
    policy_id: "planner_default",
    updated_at: "2026-03-03T00:00:00Z",
    planner_agent: buildDefaultPlannerAgentPolicy(),
    execution_targets: buildDefaultPlannerExecutionTargets(),
    compat: {
      allow_agent_runtime_fallback: true,
    },
  };
}

function extractPlannerExecutionTargets(value: unknown): PlannerExecutionTargets {
  const raw = extractObject(value);
  const defaults = buildDefaultPlannerExecutionTargets();
  const localThreads = extractObject(raw.local_threads);
  const container = extractObject(raw.container);
  const distributed = extractObject(raw.distributed);
  return {
    local_threads: {
      enabled: normalizeBoolean(localThreads.enabled, defaults.local_threads.enabled),
    },
    container: {
      enabled: normalizeBoolean(container.enabled, defaults.container.enabled),
      planner_transport:
        typeof container.planner_transport === "string" && container.planner_transport.trim()
          ? container.planner_transport
          : defaults.container.planner_transport,
    },
    distributed: {
      enabled: normalizeBoolean(distributed.enabled, defaults.distributed.enabled),
      planner_transport:
        typeof distributed.planner_transport === "string" && distributed.planner_transport.trim()
          ? distributed.planner_transport
          : defaults.distributed.planner_transport,
      dispatch_endpoint:
        typeof distributed.dispatch_endpoint === "string" ? distributed.dispatch_endpoint : "",
    },
  };
}

export function extractPlannerPolicyDocument(value: unknown): PlannerPolicyDocument {
  const raw = extractObject(value);
  const defaults = buildDefaultPlannerPolicyDocument();
  return {
    schema_version: "planner-policy-v1",
    policy_id:
      typeof raw.policy_id === "string" && raw.policy_id.trim() ? raw.policy_id : defaults.policy_id,
    updated_at:
      typeof raw.updated_at === "string" && raw.updated_at.trim()
        ? raw.updated_at
        : defaults.updated_at,
    planner_agent: extractPlannerAgentPolicy(raw.planner_agent),
    execution_targets: extractPlannerExecutionTargets(raw.execution_targets),
    compat: {
      allow_agent_runtime_fallback: normalizeBoolean(
        extractObject(raw.compat).allow_agent_runtime_fallback,
        defaults.compat.allow_agent_runtime_fallback,
      ),
    },
  };
}
