import { handleStatusSubcommand } from "../orchestrate-status-command.js";
import { describe, expect, it, vi } from "vitest";

const runtimeStats = {
  logicalThreads: 8,
  effectiveWorkerThreads: 4,
  parallelLimit: 4,
  queueDepth: 16,
  policyMode: "enforce",
  workdomainRoot: "runtime/workdomains",
  projectsRoot: "projects",
  aclDeniedCount: 0,
  aclLastDeniedAt: "",
  sandboxEnabled: true,
  commitGuardEnabled: true,
  kbImportConfirmRequired: true,
  kbImportAutoEnabled: false,
  workspaceSyncSensitivity: "MEDIUM",
  skillMcpIsolationEnabled: true,
  protectOrchestratorConfig: true,
  projectRuntimeProfile: "project_execution",
  orchestratorRuntimeProfile: "orchestrator_control",
  rolePolicyPath: "/repo/templates/coordination/roles.json",
};

describe("orchestrate status command", () => {
  it("prefers task meta amendment authority over markdown mirror", async () => {
    const text = await handleStatusSubcommand({
      payload: "task_demo",
      cfg: {
        runnerEnabled: false,
        runnerFallbackEnabled: false,
      },
      ensureRunnerStarted: vi.fn(async () => ({})),
      paths: {
        dashboardJson: "/repo/dashboard.json",
        systemHealthJson: "/repo/system.json",
        taskFoldersRoot: "/repo/tasks",
      },
      io: {
        fileExists: vi.fn(
          async (targetPath: string) =>
            targetPath === "/repo/tasks/task_demo/meta.json" ||
            targetPath === "/repo/batches/task_demo.watermark.v2.json",
        ),
        readJsonOrDefault: vi.fn(async (targetPath: string, fallback) => {
          if (targetPath === "/repo/tasks/task_demo/meta.json") {
            return {
              id: "task_demo",
              state: "IN_PROGRESS",
              version: 2,
              project_id: "prj_demo",
              latest_requirement_amendment: "add websocket smoke test",
              latest_requirement_amended_at: "2026-03-10T00:00:00Z",
              requirement_amendment_count: 3,
              latest_effective_patch_path: "/repo/batches/task_demo.effective-patch.v2.json",
              planner_replan: {
                status: "queued",
              },
              runtime_replan: {
                consume_status: "pending_consume",
              },
            } as typeof fallback;
          }
          if (targetPath === "/repo/batches/task_demo.watermark.v2.json") {
            return {
              head_version: 5,
              applying_version: 4,
              consumed_version: 3,
            } as typeof fallback;
          }
          return fallback;
        }),
        readNdjson: vi.fn(async () => []),
      },
      runtime: {
        getRunnerLockMtime: vi.fn(async () => ""),
        loadExecutionRuntime: vi.fn(async () => runtimeStats),
        getExternalRunnerStatus: vi.fn(async () => ({
          running: false,
          pid: 0,
          lastTickAt: "",
          lastExitCode: "",
        })),
        getRunnerSnapshot: vi.fn(() => ({
          runnerTimerActive: true,
          runnerStatus: "started" as const,
          runnerLastTickAt: "",
          runnerLastTickResult: "ok" as const,
          runnerLastTickError: "",
          runnerIntervalSec: 10,
          runnerExecutionMode: "local_threads",
          runnerBatchSize: 4,
          runnerMaxParallel: 2,
        })),
        getConsistencySnapshot: vi.fn(() => ({
          runtimeConsistency: "ok" as const,
          runtimeSignature: "sig",
          runtimeExpectedSignature: "sig",
        })),
      },
      renderOrchestrateHelp: () => "help",
    });

    expect(text).toContain("amendments: 3");
    expect(text).toContain("last_amendment: add websocket smoke test");
    expect(text).toContain("amendment_source: task_meta");
    expect(text).toContain("legacy_mirror_present: false");
    expect(text).toContain("planner_replan_status: queued");
    expect(text).toContain("planner_replan_execution_status: pending_consume");
    expect(text).toContain("amendment_watermark: 5/4/3");
  });
});
