import { resolvePath } from "./orchestrate-io.js";
import type { RuntimeStatsSnapshot } from "./orchestrate-response.js";

export type ExecutionRuntimeSnapshot = RuntimeStatsSnapshot & {
  rolePolicyPath: string;
};

export type ExecutionRuntimeReader = {
  loadExecutionRuntime: () => Promise<ExecutionRuntimeSnapshot>;
};

export type BuildExecutionRuntimeReaderParams = {
  repoRoot: string;
  paths: {
    executionRuntime: string;
    dashboardJson: string;
  };
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    readText: (targetPath: string) => Promise<string>;
  };
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

export function buildExecutionRuntimeReader(
  params: BuildExecutionRuntimeReaderParams,
): ExecutionRuntimeReader {
  return {
    loadExecutionRuntime: async (): Promise<ExecutionRuntimeSnapshot> => {
      const runtime = await params.io.readJsonOrDefault<Record<string, unknown>>(
        params.paths.executionRuntime,
        {},
      );
      const host =
        runtime.host && typeof runtime.host === "object" && !Array.isArray(runtime.host)
          ? (runtime.host as Record<string, unknown>)
          : {};
      const localThreads =
        runtime.local_threads &&
        typeof runtime.local_threads === "object" &&
        !Array.isArray(runtime.local_threads)
          ? (runtime.local_threads as Record<string, unknown>)
          : {};
      const dashboard = await params.io.readJsonOrDefault<Record<string, unknown>>(
        params.paths.dashboardJson,
        {},
      );
      const security =
        runtime.security && typeof runtime.security === "object" && !Array.isArray(runtime.security)
          ? (runtime.security as Record<string, unknown>)
          : {};
      const workdomain =
        runtime.workdomain && typeof runtime.workdomain === "object" && !Array.isArray(runtime.workdomain)
          ? (runtime.workdomain as Record<string, unknown>)
          : {};
      const workspace =
        runtime.workspace && typeof runtime.workspace === "object" && !Array.isArray(runtime.workspace)
          ? (runtime.workspace as Record<string, unknown>)
          : {};
      const kbImport =
        runtime.kb_import && typeof runtime.kb_import === "object" && !Array.isArray(runtime.kb_import)
          ? (runtime.kb_import as Record<string, unknown>)
          : {};
      const sync =
        runtime.sync && typeof runtime.sync === "object" && !Array.isArray(runtime.sync)
          ? (runtime.sync as Record<string, unknown>)
          : {};
      const isolation =
        runtime.agent_runtime_isolation &&
        typeof runtime.agent_runtime_isolation === "object" &&
        !Array.isArray(runtime.agent_runtime_isolation)
          ? (runtime.agent_runtime_isolation as Record<string, unknown>)
          : {};
      const deniedRel = asString(
        security.denied_events_path,
        "templates/coordination/security/acl_denied.ndjson",
      );
      const deniedPath = resolvePath(params.repoRoot, deniedRel);
      let aclDeniedCount = 0;
      let aclLastDeniedAt = "";
      if (await params.io.fileExists(deniedPath)) {
        const lines = (await params.io.readText(deniedPath))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        aclDeniedCount = lines.length;
        if (lines.length > 0) {
          try {
            const last = JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
            aclLastDeniedAt = String(last.timestamp ?? "");
          } catch {
            aclLastDeniedAt = "";
          }
        }
      }
      const active = Array.isArray(dashboard.active_pipelines) ? dashboard.active_pipelines.length : 0;
      return {
        logicalThreads: asPositiveInt(host.logical_threads, 4),
        effectiveWorkerThreads: asPositiveInt(host.effective_worker_threads, 1),
        parallelLimit: asPositiveInt(localThreads.max_parallel, 1),
        queueDepth: active,
        policyMode: asString(security.policy_mode, "enforce"),
        rolePolicyPath: asString(
          security.role_policy_path,
          "templates/coordination/security/role_permissions.effective.json",
        ),
        workdomainRoot: asString(workdomain.root, "runtime/workdomains"),
        projectsRoot: asString(workspace.projects_root, "projects"),
        aclDeniedCount,
        aclLastDeniedAt,
        sandboxEnabled: asBoolean(security.sandbox_enabled, true),
        commitGuardEnabled: asBoolean(security.commit_guard_enabled, true),
        kbImportConfirmRequired: asBoolean(kbImport.confirm_required, true),
        kbImportAutoEnabled: asBoolean(kbImport.auto_enabled, false),
        workspaceSyncSensitivity: asString(sync.workspace_sync_sensitivity, "MEDIUM"),
        skillMcpIsolationEnabled: asBoolean(isolation.enabled, true),
        protectOrchestratorConfig: asBoolean(isolation.protect_orchestrator_config, true),
        projectRuntimeProfile: asString(isolation.project_profile_name, "project_execution"),
        orchestratorRuntimeProfile: asString(
          isolation.orchestrator_profile_name,
          "orchestrator_control",
        ),
      };
    },
  };
}
