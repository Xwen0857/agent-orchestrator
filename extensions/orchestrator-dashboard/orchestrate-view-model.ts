import { type RunSuccessResponseParams, type TaskStatusResponseParams } from "./orchestrate-response.js";

type RuntimeStatsInput = TaskStatusResponseParams["runtimeStats"];
type ExternalRunnerInput = TaskStatusResponseParams["externalRunner"];

function extractObject(
  value: unknown,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function buildTaskStatusResponseParams(input: {
  taskId: string;
  meta: Record<string, unknown>;
  runnerStatus: string;
  runnerLastTickAt: string;
  runnerLastTickResult: string;
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeStats: RuntimeStatsInput;
  lockMtime: string;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerInput;
  runnerFallbackEnabled: boolean;
  amendmentCount: number;
  lastAmendment: string;
  amendmentSource: "task_meta" | "none";
  legacyMirrorPresent?: boolean;
  plannerReplanStatus?: string;
  plannerReplanExecutionStatus?: string;
  amendmentWatermark?: {
    headVersion: number;
    applyingVersion: number;
    consumedVersion: number;
  } | null;
  recent: string[];
}): TaskStatusResponseParams {
  const { meta } = input;
  const splitUnitsPlanned = asPositiveInt(meta.split_units_planned, 1);
  const resolvedMode = String(
    meta.execution_mode ??
      (Array.isArray(meta.children) && meta.children.length > 0 ? "multi" : "single"),
  );
  const planningDecision = extractObject(meta.planning_decision);
  const acl = extractObject(meta.acl);
  const aggregate = extractObject(meta.aggregate);
  const executionRoles = extractObject(meta.execution_roles);

  return {
    ...input,
    resolvedMode,
    planningDecision,
    splitUnitsPlanned,
    acl,
    aggregate,
    executionRoles,
    legacyMirrorPresent: Boolean(input.legacyMirrorPresent),
    plannerReplanStatus: input.plannerReplanStatus ?? "",
    plannerReplanExecutionStatus: input.plannerReplanExecutionStatus ?? "",
    amendmentWatermark: input.amendmentWatermark ?? null,
  };
}

export function buildRunSuccessResponseParams(input: {
  taskId: string;
  sessionKeyForRun: string;
  summaryId: string;
  summaryPath: string;
  payload: Record<string, unknown>;
  singleWorkerId: string;
  strategyPath: string;
  basePath: string;
  runnerStatus: string;
  runnerLastTickAt: string;
  runnerLastTickResult: string;
  runnerLastTickError: string;
  runnerIntervalSec: number;
  runnerExecutionMode: string;
  runnerBatchSize: number;
  runnerMaxParallel: number;
  runtimeStats: RuntimeStatsInput;
  requestedModeDefault?: string;
  meta: Record<string, unknown>;
  workspaceConfigSourceDefault: string;
  workspaceValidatedDefault: boolean;
  runtimeConsistency: string;
  runtimeSignature: string;
  runtimeExpectedSignature: string;
  externalRunner: ExternalRunnerInput;
  runnerFallbackEnabled: boolean;
  checklistText: string;
  scriptTrace: string[];
  llmUsed: boolean;
  llmReason: string;
  llmAuthMode: string;
  llmKeySource: string;
}): RunSuccessResponseParams {
  const { meta } = input;
  const splitUnitsPlanned = asPositiveInt(meta.split_units_planned, 1);
  const resolvedMode = String(
    meta.execution_mode ??
      (Array.isArray(meta.children) && meta.children.length > 0 ? "multi" : "single"),
  );
  const planningDecision = extractObject(meta.planning_decision);
  const aggregate = extractObject(meta.aggregate);

  return {
    taskId: input.taskId,
    sessionKeyForRun: input.sessionKeyForRun,
    summaryId: input.summaryId,
    summaryPath: input.summaryPath,
    payload: input.payload,
    singleWorkerId: input.singleWorkerId,
    strategyPath: input.strategyPath,
    basePath: input.basePath,
    runnerStatus: input.runnerStatus,
    runnerLastTickAt: input.runnerLastTickAt,
    runnerLastTickResult: input.runnerLastTickResult,
    runnerLastTickError: input.runnerLastTickError,
    runnerIntervalSec: input.runnerIntervalSec,
    runnerExecutionMode: input.runnerExecutionMode,
    runnerBatchSize: input.runnerBatchSize,
    runnerMaxParallel: input.runnerMaxParallel,
    runtimeStats: input.runtimeStats,
    resolvedMode,
    planningDecision,
    splitUnitsPlanned,
    meta,
    workspaceConfigSource: String(
      meta.workspace_config_source ?? input.workspaceConfigSourceDefault,
    ),
    workspaceValidated: Boolean(
      (meta.workspace_validated as boolean | undefined) ?? input.workspaceValidatedDefault,
    ),
    aggregate,
    runtimeConsistency: input.runtimeConsistency,
    runtimeSignature: input.runtimeSignature,
    runtimeExpectedSignature: input.runtimeExpectedSignature,
    externalRunner: input.externalRunner,
    runnerFallbackEnabled: input.runnerFallbackEnabled,
    checklistText: input.checklistText,
    scriptTrace: input.scriptTrace,
    llmUsed: input.llmUsed,
    llmReason: input.llmReason,
    llmAuthMode: input.llmAuthMode,
    llmKeySource: input.llmKeySource,
  };
}
