import { describe, expect, it, vi } from "vitest";
import { buildOrchestratorBootstrapContext } from "../orchestrate-bootstrap-context.js";

describe("orchestrate-bootstrap-context", () => {
  it("builds normalized runtime paths and signature sources", () => {
    const ctx = buildOrchestratorBootstrapContext({
      api: {
        runtime: {
          state: {
            resolveStateDir: () => "/tmp/state",
          },
        },
      } as never,
      repoRoot: "/repo",
      pluginDir: "/repo/extensions/orchestrator-dashboard",
      cfg: {
        dashboardJsonPath: "templates/coordination/orchestrator/dashboard.json",
        systemHealthJsonPath: "templates/coordination/orchestrator/system-health.json",
        plannerCurrentPath: "templates/coordination/planner/config/current.md",
        plannerPropertiesPath: "templates/coordination/planner/properties.md",
        auditPolicyPath: "templates/coordination/audit/policy/current.json",
        configHistoryPath: "templates/coordination/planner/config/history/versions.ndjson",
        snapshotScriptPath: "agent-orchestrator/scripts/config_snapshot.sh",
        rollbackScriptPath: "agent-orchestrator/scripts/config_rollback.sh",
        agentRuntimeConfigPath: "templates/coordination/orchestrator/agent_runtime.json",
      },
      defaults: {
        requestsPath: "templates/coordination/orchestrator/requests",
        tasksRoot: "templates/coordination/tasks/task_folders",
      },
    });

    expect(ctx.eventsPath).toBe("/tmp/state/plugins/orchestrator-dashboard/events.ndjson");
    expect(ctx.paths.dashboardJson).toBe("/repo/templates/coordination/orchestrator/dashboard.json");
    expect(ctx.paths.entryAgentDecodeContract).toBe(
      "/repo/templates/coordination/orchestrator/entry_agent_decode_contract.md",
    );
    expect(ctx.runtimeSignatureFiles).toHaveLength(3);
    expect(ctx.externalRunnerScriptPath).toBe("/repo/agent-orchestrator/scripts/orchestrate_runner_daemon.sh");
  });
});
