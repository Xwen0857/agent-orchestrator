import {
  buildRunSuccessResponseParams,
  buildTaskStatusResponseParams,
} from "../orchestrate-view-model.js";
import { describe, expect, it } from "vitest";

const runtimeStats = {
  logicalThreads: 8,
  effectiveWorkerThreads: 4,
  parallelLimit: 4,
  queueDepth: 16,
  policyMode: "enforce",
  workdomainRoot: "runtime/workdomains",
  projectsRoot: "projects",
  aclDeniedCount: 1,
  aclLastDeniedAt: "2026-03-02T00:00:00.000Z",
  sandboxEnabled: true,
  commitGuardEnabled: true,
  kbImportConfirmRequired: true,
  kbImportAutoEnabled: false,
  workspaceSyncSensitivity: "MEDIUM",
  skillMcpIsolationEnabled: true,
  protectOrchestratorConfig: true,
  projectRuntimeProfile: "project_execution",
  orchestratorRuntimeProfile: "orchestrator_control",
};

const externalRunner = {
  running: true,
  pid: 1234,
  lastTickAt: "2026-03-02T00:00:01.000Z",
  lastExitCode: "0",
};

describe("orchestrate view-model builders", () => {
  it("derives task status render params from meta", () => {
    const params = buildTaskStatusResponseParams({
      taskId: "task_1",
      meta: {
        requested_mode: "auto",
        execution_mode: "multi",
        split_units_planned: 5,
        planning_decision: { decision_source: "planner_rules_fallback" },
        acl: { denied_count: 2 },
        aggregate: { publish_status: "none" },
        execution_roles: { planning_actor: "planner-core" },
      },
      runnerStatus: "started",
      runnerLastTickAt: "",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      lockMtime: "",
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: false,
      amendmentCount: 0,
      lastAmendment: "",
      amendmentSource: "none",
      legacyMirrorPresent: false,
      plannerReplanStatus: "",
      plannerReplanExecutionStatus: "",
      amendmentWatermark: null,
      recent: [],
    });

    expect(params.resolvedMode).toBe("multi");
    expect(params.splitUnitsPlanned).toBe(5);
    expect(params.acl.denied_count).toBe(2);
    expect(params.executionRoles.planning_actor).toBe("planner-core");
    expect(params.amendmentSource).toBe("none");
    expect(params.legacyMirrorPresent).toBe(false);
  });

  it("derives run success render params from meta defaults", () => {
    const params = buildRunSuccessResponseParams({
      taskId: "task_2",
      sessionKeyForRun: "sess_1",
      summaryId: "sum_1",
      summaryPath: "/repo/summary.json",
      payload: { scheduling_actor: "scheduler-ops" },
      singleWorkerId: "worker_1",
      strategyPath: "/repo/strategy.json",
      basePath: "/plugins/orchestrator",
      runnerStatus: "started",
      runnerLastTickAt: "",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      meta: {
        split_units_planned: 1,
        project_id: "demo",
        aggregate: { publish_status: "none" },
      },
      workspaceConfigSourceDefault: "runtime_default",
      workspaceValidatedDefault: true,
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: false,
      checklistText: "ok",
      scriptTrace: [],
      llmUsed: false,
      llmReason: "disabled",
      llmAuthMode: "auto",
      llmKeySource: "",
    });

    expect(params.resolvedMode).toBe("single");
    expect(params.workspaceConfigSource).toBe("runtime_default");
    expect(params.workspaceValidated).toBe(true);
    expect(params.aggregate.publish_status).toBe("none");
  });
});
