import { describe, expect, it, vi } from "vitest";
import {
  buildRunnerRuntimeController,
  normalizeSchedulerRuntimeConsistency,
} from "../orchestrate-runner-runtime.js";

describe("orchestrate-runner-runtime", () => {
  it("returns degraded when runner is disabled", async () => {
    const controller = buildRunnerRuntimeController({
      repoRoot: "/repo",
      runnerLockPath: "/repo/runner.lock",
      externalRunnerScriptPath: "/repo/external.sh",
      startupConsistencyPromise: Promise.resolve({ runtimeConsistency: "ok" }),
      cfg: {
        runnerEnabled: false,
        runnerFallbackEnabled: false,
        runnerFallbackMode: "none",
        runnerIntervalSec: 10,
        runnerExecutionMode: "local_threads",
        runnerBatchSize: 4,
        runnerMaxParallel: 2,
        runnerTasksRootArg: "templates/coordination/tasks/task_folders",
        executionRuntimePath: "/repo/runtime.json",
      },
      io: {
        fileExists: async () => false,
        readText: async () => "",
        readJsonOrDefault: async <T>(_path: string, fallback: T) => fallback,
        runScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "{}", stderr: "" })),
      emitEvent: vi.fn(async () => {}),
      trimOutput: (value: string) => value,
    });

    const status = await controller.ensureRunnerStarted();
    expect(status.schedulerStatus).toBe("degraded");
    expect(controller.getSnapshot().runnerStatus).toBe("degraded");
  });

  it("reports empty external runner status when fallback is disabled", async () => {
    const controller = buildRunnerRuntimeController({
      repoRoot: "/repo",
      runnerLockPath: "/repo/runner.lock",
      externalRunnerScriptPath: "/repo/external.sh",
      startupConsistencyPromise: Promise.resolve(null),
      cfg: {
        runnerEnabled: true,
        runnerFallbackEnabled: false,
        runnerFallbackMode: "none",
        runnerIntervalSec: 10,
        runnerExecutionMode: "local_threads",
        runnerBatchSize: 4,
        runnerMaxParallel: 2,
        runnerTasksRootArg: "templates/coordination/tasks/task_folders",
        executionRuntimePath: "/repo/runtime.json",
      },
      io: {
        fileExists: async () => false,
        readText: async () => "",
        readJsonOrDefault: async <T>(_path: string, fallback: T) => fallback,
        runScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
      },
      runWhitelistedScript: vi.fn(async () => ({ stdout: "{}", stderr: "" })),
      emitEvent: vi.fn(async () => {}),
      trimOutput: (value: string) => value,
    });

    await expect(controller.getExternalRunnerStatus()).resolves.toEqual({
      running: false,
      pid: 0,
      lastTickAt: "",
      lastExitCode: "",
    });
  });

  it("normalizes scheduler runtime consistency", () => {
    expect(normalizeSchedulerRuntimeConsistency(null)).toBe("unknown");
    expect(normalizeSchedulerRuntimeConsistency({})).toBe("unknown");
    expect(normalizeSchedulerRuntimeConsistency({ runtimeConsistency: "ok" })).toBe("ok");
    expect(normalizeSchedulerRuntimeConsistency({ runtimeConsistency: "mismatch" })).toBe("mismatch");
  });
});
