import { describe, expect, it } from "vitest";
import { buildExecutionRuntimeReader } from "../orchestrate-execution-runtime.js";

describe("orchestrate-execution-runtime", () => {
  it("normalizes runtime defaults and derived fields", async () => {
    const reader = buildExecutionRuntimeReader({
      repoRoot: "/repo",
      paths: {
        executionRuntime: "/repo/runtime.json",
        dashboardJson: "/repo/dashboard.json",
      },
      io: {
        fileExists: async () => false,
        readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
          if (targetPath.endsWith("runtime.json")) {
            return {
              host: { logical_threads: 6, effective_worker_threads: 3 },
              local_threads: { max_parallel: 2 },
              security: { policy_mode: "warn" },
              workspace: { projects_root: "projects/custom" },
            } as T;
          }
          if (targetPath.endsWith("dashboard.json")) {
            return { active_pipelines: [{ task_id: "task_1" }] } as T;
          }
          return fallback;
        },
        readText: async () => "",
      },
    });

    const runtime = await reader.loadExecutionRuntime();
    expect(runtime.logicalThreads).toBe(6);
    expect(runtime.effectiveWorkerThreads).toBe(3);
    expect(runtime.parallelLimit).toBe(2);
    expect(runtime.queueDepth).toBe(1);
    expect(runtime.policyMode).toBe("warn");
    expect(runtime.projectsRoot).toBe("projects/custom");
  });
});
