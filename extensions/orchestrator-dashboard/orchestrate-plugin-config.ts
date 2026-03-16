/**
 * Stable runtime config consumed by the plugin entrypoint and runtime services.
 * This module owns defaults, primitive coercion, and enum validation only.
 * It does not verify that referenced paths exist on disk.
 */
export type DashboardPluginConfig = {
  enabled: boolean;
  repoRoot: string;
  basePath: string;
  apiBasePath: string;
  dashboardJsonPath: string;
  systemHealthJsonPath: string;
  plannerCurrentPath: string;
  plannerPropertiesPath: string;
  auditPolicyPath: string;
  configHistoryPath: string;
  snapshotScriptPath: string;
  rollbackScriptPath: string;
  requireGatewayAuth: boolean;
  runnerEnabled: boolean;
  runnerIntervalSec: number;
  runnerExecutionMode: "local_threads" | "container" | "distributed";
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeConsistencyMode: "enforce" | "warn";
  runnerFallbackEnabled: boolean;
  runnerFallbackMode: "external_daemon" | "none";
  agentRuntimeConfigPath: string;
};

export const DEFAULT_REPO_ROOT =
  process.env.OPENCLAW_ORCHESTRATOR_REPO_ROOT?.trim() || process.cwd();
export const DEFAULT_BASE_PATH = "/plugins/orchestrator";
export const DEFAULT_API_BASE_PATH = "/api/plugins/orchestrator";
export const DEFAULT_REQUESTS_PATH = "templates/coordination/orchestrator/requests";
export const DEFAULT_TASKS_ROOT = "templates/coordination/tasks/task_folders";
export const DEFAULT_RUNNER_INTERVAL_SEC = 10;
export const DEFAULT_AGENT_RUNTIME_CONFIG_PATH =
  "templates/coordination/orchestrator/agent_runtime.json";

/**
 * Host-facing schema wrapper that delegates normalization to `parsePluginConfig`.
 */
export const configSchema = {
  safeParse(value: unknown) {
    const normalized = parsePluginConfig(value);
    return { success: true as const, data: normalized };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      repoRoot: { type: "string" },
      basePath: { type: "string", default: DEFAULT_BASE_PATH },
      apiBasePath: { type: "string", default: DEFAULT_API_BASE_PATH },
      dashboardJsonPath: { type: "string" },
      systemHealthJsonPath: { type: "string" },
      plannerCurrentPath: { type: "string" },
      plannerPropertiesPath: { type: "string" },
      auditPolicyPath: { type: "string" },
      configHistoryPath: { type: "string" },
      snapshotScriptPath: { type: "string" },
      rollbackScriptPath: { type: "string" },
      requireGatewayAuth: { type: "boolean", default: true },
      runnerEnabled: { type: "boolean", default: true },
      runnerIntervalSec: { type: "number", default: DEFAULT_RUNNER_INTERVAL_SEC },
      runnerExecutionMode: { type: "string", default: "local_threads" },
      runnerBatchSize: { type: "number", default: 4 },
      runnerMaxParallel: { type: "number", default: 2 },
      runtimeConsistencyMode: { type: "string", default: "enforce" },
      runnerFallbackEnabled: { type: "boolean", default: true },
      runnerFallbackMode: { type: "string", default: "external_daemon" },
      agentRuntimeConfigPath: { type: "string", default: DEFAULT_AGENT_RUNTIME_CONFIG_PATH },
    },
  },
};

function asString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function asExecutionMode(
  value: unknown,
  fallback: "local_threads" | "container" | "distributed",
): "local_threads" | "container" | "distributed" {
  const normalized = asString(value, fallback).toLowerCase();
  if (
    normalized === "local_threads" ||
    normalized === "container" ||
    normalized === "distributed"
  ) {
    return normalized;
  }
  return fallback;
}

function asConsistencyMode(value: unknown, fallback: "enforce" | "warn"): "enforce" | "warn" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "enforce" || normalized === "warn") {
    return normalized;
  }
  return fallback;
}

function asRunnerFallbackMode(
  value: unknown,
  fallback: "external_daemon" | "none",
): "external_daemon" | "none" {
  const normalized = asString(value, fallback).toLowerCase();
  if (normalized === "external_daemon" || normalized === "none") {
    return normalized;
  }
  return fallback;
}

function ensureLeadingSlash(input: string): string {
  if (!input) {
    return "/";
  }
  return input.startsWith("/") ? input : `/${input}`;
}

/**
 * Converts arbitrary plugin config input into a complete config object with defaults.
 * Invalid scalar values silently fall back so plugin startup remains deterministic.
 */
export function parsePluginConfig(value: unknown): DashboardPluginConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  // Route prefixes are normalized first because the rest of the plugin assumes
  // leading slashes and does not defend against malformed host config.
  const repoRoot = asString(raw.repoRoot, DEFAULT_REPO_ROOT);
  const basePath = ensureLeadingSlash(asString(raw.basePath, DEFAULT_BASE_PATH));
  const apiBasePath = ensureLeadingSlash(asString(raw.apiBasePath, DEFAULT_API_BASE_PATH));

  return {
    enabled: asBoolean(raw.enabled, true),
    repoRoot,
    basePath,
    apiBasePath,
    dashboardJsonPath: asString(
      raw.dashboardJsonPath,
      "templates/coordination/orchestrator/dashboard.json",
    ),
    systemHealthJsonPath: asString(
      raw.systemHealthJsonPath,
      "templates/coordination/orchestrator/system-health.json",
    ),
    plannerCurrentPath: asString(
      raw.plannerCurrentPath,
      "templates/coordination/planner/config/current.md",
    ),
    plannerPropertiesPath: asString(
      raw.plannerPropertiesPath,
      "templates/coordination/planner/properties.md",
    ),
    auditPolicyPath: asString(
      raw.auditPolicyPath,
      "templates/coordination/audit/policy/current.json",
    ),
    configHistoryPath: asString(
      raw.configHistoryPath,
      "templates/coordination/planner/config/history/versions.ndjson",
    ),
    snapshotScriptPath: asString(
      raw.snapshotScriptPath,
      "agent-orchestrator/scripts/config_snapshot.sh",
    ),
    rollbackScriptPath: asString(
      raw.rollbackScriptPath,
      "agent-orchestrator/scripts/config_rollback.sh",
    ),
    requireGatewayAuth: asBoolean(raw.requireGatewayAuth, true),
    runnerEnabled: asBoolean(raw.runnerEnabled, true),
    runnerIntervalSec: asPositiveInt(raw.runnerIntervalSec, DEFAULT_RUNNER_INTERVAL_SEC),
    runnerExecutionMode: asExecutionMode(raw.runnerExecutionMode, "local_threads"),
    runnerBatchSize: asPositiveInt(raw.runnerBatchSize, 4),
    runnerMaxParallel: asPositiveInt(raw.runnerMaxParallel, 2),
    runtimeConsistencyMode: asConsistencyMode(raw.runtimeConsistencyMode, "enforce"),
    runnerFallbackEnabled: asBoolean(raw.runnerFallbackEnabled, true),
    runnerFallbackMode: asRunnerFallbackMode(raw.runnerFallbackMode, "external_daemon"),
    agentRuntimeConfigPath: asString(raw.agentRuntimeConfigPath, DEFAULT_AGENT_RUNTIME_CONFIG_PATH),
  };
}
