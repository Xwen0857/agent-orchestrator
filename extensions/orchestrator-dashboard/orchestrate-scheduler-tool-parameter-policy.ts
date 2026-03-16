import type {
  SchedulerAgentFlowId,
  SchedulerAgentToolArgValue,
  SchedulerAgentToolParameterRange,
  SchedulerConfigV1,
} from "./orchestrate-scheduler-contract.js";

export type NormalizedSchedulerToolArgs = {
  args: Record<string, SchedulerAgentToolArgValue>;
  clamped_args: string[];
  governance_override_rejections: string[];
};

export function buildSchedulerToolParameterRanges(input: {
  flow: SchedulerAgentFlowId | "";
  schedulerConfig: SchedulerConfigV1;
  maxTasks: number;
  parallelLimit: number;
  effectiveWorkerThreads: number;
}): Record<string, SchedulerAgentToolParameterRange> {
  switch (input.flow) {
    case "selection_flow":
      return {
        max_tasks: {
          min: 1,
          max: Math.max(1, input.maxTasks),
          default: Math.max(1, input.maxTasks),
          agent_tunable: true,
          governance_locked: false,
        },
        parallel_limit: {
          min: 1,
          max: Math.max(1, input.effectiveWorkerThreads),
          default: Math.max(1, input.parallelLimit),
          agent_tunable: false,
          governance_locked: true,
        },
      };
    case "retry_flow":
      return {
        retry_max_attempts: {
          min: 1,
          max: Math.max(1, input.schedulerConfig.retry.max_attempts),
          default: Math.max(1, input.schedulerConfig.retry.max_attempts),
          agent_tunable: true,
          governance_locked: false,
        },
        retry_base_ms: {
          min: 100,
          max: Math.max(100, input.schedulerConfig.retry.max_ms),
          default: Math.max(100, input.schedulerConfig.retry.base_ms),
          agent_tunable: true,
          governance_locked: false,
        },
      };
    case "recovery_flow":
      return {
        recovery_max_attempts: {
          min: 1,
          max: Math.max(1, input.schedulerConfig.recovery.max_attempts),
          default: Math.max(1, input.schedulerConfig.recovery.max_attempts),
          agent_tunable: true,
          governance_locked: false,
        },
        token_uplift_ratio: {
          min: 0,
          max: 1,
          default: Math.max(0, Math.min(1, input.schedulerConfig.recovery.token_uplift_ratio)),
          agent_tunable: true,
          governance_locked: false,
        },
        stage_write_budget_uplift_ratio: {
          min: 0,
          max: 1,
          default: Math.max(
            0,
            Math.min(1, input.schedulerConfig.recovery.stage_write_budget_uplift_ratio),
          ),
          agent_tunable: true,
          governance_locked: false,
        },
      };
    case "degrade_flow":
      return {
        token_budget_decay_ratio: {
          min: 0,
          max: 1,
          default: Math.max(0, Math.min(1, input.schedulerConfig.degrade.token_budget_decay_ratio)),
          agent_tunable: true,
          governance_locked: false,
        },
        stage_write_budget_decay_ratio: {
          min: 0,
          max: 1,
          default: Math.max(
            0,
            Math.min(1, input.schedulerConfig.degrade.stage_write_budget_decay_ratio),
          ),
          agent_tunable: true,
          governance_locked: false,
        },
      };
    default:
      return {};
  }
}

export function buildDefaultSchedulerToolArgs(
  flow: SchedulerAgentFlowId | "",
  ranges: Record<string, SchedulerAgentToolParameterRange>,
): Record<string, SchedulerAgentToolArgValue> {
  const args: Record<string, SchedulerAgentToolArgValue> = {};
  for (const [key, value] of Object.entries(ranges)) {
    args[key] = value.default;
  }
  return args;
}

export function clampSchedulerToolArgs(
  input: Record<string, SchedulerAgentToolArgValue> | undefined,
  ranges: Record<string, SchedulerAgentToolParameterRange>,
): Record<string, SchedulerAgentToolArgValue> {
  return normalizeSchedulerToolArgs(input, ranges).args;
}

export function normalizeSchedulerToolArgs(
  input: Record<string, SchedulerAgentToolArgValue> | undefined,
  ranges: Record<string, SchedulerAgentToolParameterRange>,
): NormalizedSchedulerToolArgs {
  const args: Record<string, SchedulerAgentToolArgValue> = {};
  const clampedArgs: string[] = [];
  const governanceOverrideRejections: string[] = [];
  for (const [key, range] of Object.entries(ranges)) {
    const requested = input?.[key];
    if (typeof requested === "number" && Number.isFinite(requested)) {
      if (range.governance_locked) {
        if (requested !== range.default) {
          governanceOverrideRejections.push(key);
        }
        args[key] = range.default;
        continue;
      }
      if (range.agent_tunable) {
        const normalized = Math.max(range.min, Math.min(range.max, requested));
        if (normalized !== requested) {
          clampedArgs.push(`${key}=${normalized}(requested=${requested})`);
        }
        args[key] = normalized;
        continue;
      }
    }
    args[key] = range.default;
  }
  return {
    args,
    clamped_args: clampedArgs,
    governance_override_rejections: governanceOverrideRejections,
  };
}
