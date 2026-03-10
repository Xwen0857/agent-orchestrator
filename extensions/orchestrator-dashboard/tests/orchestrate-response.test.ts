import {
  renderRunSuccessResponse,
  renderTaskStatusResponse,
} from "../orchestrate-response.js";
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

describe("orchestrate response rendering", () => {
  it("renders task status output", () => {
    const text = renderTaskStatusResponse({
      taskId: "task_1",
      meta: {
        state: "IN_PROGRESS",
        version: 3,
        project_id: "demo",
        children: ["a", "b"],
        acl: { denied_count: 2 },
      },
      runnerStatus: "started",
      runnerLastTickAt: "2026-03-02T00:00:01.000Z",
      runnerLastTickResult: "ok",
      runnerLastTickError: "",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      planningDecision: {
        decision_source: "planner_rules_fallback",
        decision_reason: "complex task",
      },
      splitUnitsPlanned: 2,
      acl: { denied_count: 2 },
      aggregate: { publish_status: "none" },
      executionRoles: {},
      lockMtime: "2026-03-02T00:00:02.000Z",
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: true,
      amendmentCount: 1,
      lastAmendment: "latest",
      amendmentSource: "task_meta",
      legacyMirrorPresent: false,
      plannerReplanStatus: "queued",
      plannerReplanExecutionStatus: "pending_consume",
      amendmentWatermark: {
        headVersion: 5,
        applyingVersion: 4,
        consumedVersion: 3,
      },
      recent: ["2026-03-02T00:00:03.000Z TEST IN_PROGRESS"],
    });

    expect(text).toContain("task_id: task_1");
    expect(text).toContain("amendment_source: task_meta");
    expect(text).toContain("legacy_mirror_present: false");
    expect(text).toContain("planner_replan_status: queued");
    expect(text).toContain("amendment_watermark: 5/4/3");
    expect(text).toContain("recent_events:");
    expect(text).toContain("- 2026-03-02T00:00:03.000Z TEST IN_PROGRESS");
  });

  it("renders run success output", () => {
    const text = renderRunSuccessResponse({
      taskId: "task_2",
      sessionKeyForRun: "sess_1",
      summaryId: "sum_1",
      summaryPath: "/repo/summary.json",
      payload: {
        state: "ASSIGNED",
        version: 1,
        planning_actor: "planner-core",
        scheduling_actor: "scheduler-ops",
        actor_compat_mode: false,
        actor_compat_hits: 0,
        aggregate_audit_status: "(none)",
        aggregate_collisions_count: 0,
      },
      singleWorkerId: "worker_1",
      strategyPath: "/repo/strategy.json",
      basePath: "/plugins/orchestrator",
      runnerStatus: "degraded",
      runnerLastTickAt: "",
      runnerLastTickResult: "failed",
      runnerLastTickError: "boom",
      runnerIntervalSec: 10,
      runnerExecutionMode: "local_threads",
      runnerBatchSize: 4,
      runnerMaxParallel: 2,
      runtimeStats,
      planningDecision: {},
      splitUnitsPlanned: 1,
      meta: {
        project_id: "demo",
        acl: {},
      },
      workspaceConfigSource: "runtime_default",
      workspaceValidated: true,
      aggregate: {},
      runtimeConsistency: "ok",
      runtimeSignature: "abc",
      runtimeExpectedSignature: "abc",
      externalRunner,
      runnerFallbackEnabled: true,
      checklistText: "required_config: ok",
      scriptTrace: ["trace: script ok"],
      llmUsed: false,
      llmReason: "disabled",
      llmAuthMode: "auto",
      llmKeySource: "",
    });

    expect(text).toContain("task_id: task_2");
    expect(text).toContain("runner_fallback_hint: bash agent-orchestrator/scripts/orchestrate_runner_daemon.sh start 10");
    expect(text).toContain("llm_planner: fallback(disabled)");
    expect(text).toContain("required_config: ok");
    expect(text).toContain("trace: script ok");
  });
});
