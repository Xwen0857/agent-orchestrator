/**
 * Path state helpers for `/orchestrate path` and `/orchestrate run`.
 * This module normalizes persisted project-to-workspace mappings and resolves the
 * effective workspace for a run without performing file writes.
 */
import path from "node:path";

/**
 * Identifies which precedence layer supplied the workspace used for a run.
 */
export type WorkspaceConfigSource = "run_flag" | "path_default" | "runtime_default";

/**
 * Persisted per-project workspace default stored in the path state file.
 */
export type PathStateProjectEntry = {
  workspace_root: string;
  updated_at: string;
  updated_by: string;
};

/**
 * Serialized project workspace registry used by the dashboard plugin.
 */
export type PathState = {
  schema_version: "orchestrate-path-state-v1";
  updated_at: string;
  projects: Record<string, PathStateProjectEntry>;
};

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/**
 * Parses simple `--key value` segments while preserving non-flag tokens in order.
 */
export function parseKvFlags(payload: string): {
  flags: Record<string, string>;
  positionals: string[];
} {
  const tokens = payload.split(/\s+/).filter(Boolean);
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (token.startsWith("--")) {
      const key = token.slice(2).trim();
      const value = (tokens[i + 1] ?? "").trim();
      if (key && value) {
        flags[key] = value;
        i += 1;
        continue;
      }
    }
    positionals.push(token);
  }
  return { flags, positionals };
}

/**
 * Restricts project ids to a filesystem-safe slug used in state keys and path prefixes.
 */
export function isSafeProjectId(projectId: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(projectId);
}

/**
 * Rejects empty, absolute, and upward-traversing workspace roots before they are joined
 * against the shared projects root.
 */
export function validateWorkspaceRootRelative(workspaceRoot: string): string | null {
  if (!workspaceRoot) {
    return "workspace_root is required";
  }
  if (path.isAbsolute(workspaceRoot)) {
    return "workspace_root must be relative";
  }
  if (workspaceRoot.includes("..")) {
    return "workspace_root cannot contain ..";
  }
  const normalized = path.posix.normalize(workspaceRoot.replace(/\\/gu, "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === "."
  ) {
    return "workspace_root cannot escape projects root";
  }
  return null;
}

/**
 * Resolves a workspace under the configured projects root and throws if it escapes
 * that root after absolute-path normalization.
 */
export function resolveWorkspaceUnderProjects(params: {
  repoRoot: string;
  projectsRootRel: string;
  workspaceRootRel: string;
}): string {
  const projectsRootAbs = path.resolve(params.repoRoot, params.projectsRootRel);
  const resolved = path.resolve(projectsRootAbs, params.workspaceRootRel);
  const withSep = projectsRootAbs.endsWith(path.sep)
    ? projectsRootAbs
    : `${projectsRootAbs}${path.sep}`;
  if (resolved !== projectsRootAbs && !resolved.startsWith(withSep)) {
    throw new Error("workspace_root escapes projects root");
  }
  return resolved;
}

/**
 * Builds the empty persisted shape used when no path state exists yet.
 */
export function buildEmptyPathState(now = new Date().toISOString()): PathState {
  return {
    schema_version: "orchestrate-path-state-v1",
    updated_at: now,
    projects: {},
  };
}

/**
 * Filters arbitrary JSON into a safe path-state shape, dropping invalid project ids and
 * incomplete project entries instead of partially preserving them.
 */
export function normalizePathState(raw: unknown, fallback = buildEmptyPathState()): PathState {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const projectsRaw =
    record.projects && typeof record.projects === "object" && !Array.isArray(record.projects)
      ? (record.projects as Record<string, unknown>)
      : {};
  const projects: Record<string, PathStateProjectEntry> = {};

  for (const [projectId, value] of Object.entries(projectsRaw)) {
    if (!isSafeProjectId(projectId)) {
      continue;
    }
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const workspaceRoot = asString(row.workspace_root, "");
    if (!workspaceRoot) {
      continue;
    }
    projects[projectId] = {
      workspace_root: workspaceRoot,
      updated_at: asString(row.updated_at, new Date().toISOString()),
      updated_by: asString(row.updated_by, "unknown"),
    };
  }

  return {
    schema_version: "orchestrate-path-state-v1",
    updated_at: asString(record.updated_at, fallback.updated_at),
    projects,
  };
}

/**
 * Resolves the workspace used by `/orchestrate run`.
 * Precedence is: explicit run flags, then persisted project default, then runtime default.
 */
export function resolveWorkspaceConfigForRun(params: {
  repoRoot: string;
  projectsRootRel: string;
  pathState: PathState;
  projectIdFromFlag: string;
  workspaceRootFromFlag: string;
  taskId: string;
}): {
  projectId: string;
  workspaceRoot: string;
  source: WorkspaceConfigSource;
  validated: boolean;
} {
  const projectIdFlag = params.projectIdFromFlag.trim();
  const workspaceFlag = params.workspaceRootFromFlag.trim();

  if (workspaceFlag && !projectIdFlag) {
    throw new Error("run with --workspace-root requires --project-id");
  }
  if (projectIdFlag && !isSafeProjectId(projectIdFlag)) {
    throw new Error("invalid --project-id");
  }

  // Explicit run flags win as long as the workspace survives both relative-path validation
  // and absolute-path containment under the configured projects root.
  if (workspaceFlag) {
    const err = validateWorkspaceRootRelative(workspaceFlag);
    if (err) {
      throw new Error(`invalid --workspace-root: ${err}`);
    }
    resolveWorkspaceUnderProjects({
      repoRoot: params.repoRoot,
      projectsRootRel: params.projectsRootRel,
      workspaceRootRel: workspaceFlag,
    });
    return {
      projectId: projectIdFlag,
      workspaceRoot: workspaceFlag,
      source: "run_flag",
      validated: true,
    };
  }

  // Persisted defaults are accepted only when the saved workspace still passes the
  // current validation rules. Invalid saved values silently fall through.
  const projectForPath = projectIdFlag || "prj_default";
  const projectDefault = params.pathState.projects[projectForPath];
  if (projectDefault) {
    const err = validateWorkspaceRootRelative(projectDefault.workspace_root);
    if (!err) {
      resolveWorkspaceUnderProjects({
        repoRoot: params.repoRoot,
        projectsRootRel: params.projectsRootRel,
        workspaceRootRel: projectDefault.workspace_root,
      });
      return {
        projectId: projectForPath,
        workspaceRoot: projectDefault.workspace_root,
        source: "path_default",
        validated: true,
      };
    }
  }

  // The runtime default is deterministic so task bootstrap can proceed even when
  // no project-specific mapping has been recorded yet.
  return {
    projectId: projectIdFlag || "prj_default",
    workspaceRoot: `${projectIdFlag || "prj_default"}/runs/${params.taskId}/workspace`,
    source: "runtime_default",
    validated: true,
  };
}
