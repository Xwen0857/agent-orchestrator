import {
  isSafeProjectId,
  parseKvFlags,
  resolveWorkspaceUnderProjects,
  validateWorkspaceRootRelative,
  type PathState,
} from "./orchestrate-path.js";

type HandlePathSubcommandParams = {
  payload: string;
  senderId?: string;
  repoRoot: string;
  projectsRoot: string;
  readPathState: () => Promise<PathState>;
  writePathState: (next: PathState) => Promise<void>;
  now?: () => string;
};

export async function handlePathSubcommand(
  params: HandlePathSubcommandParams,
): Promise<string> {
  const {
    payload,
    senderId,
    repoRoot,
    projectsRoot,
    readPathState,
    writePathState,
    now = () => new Date().toISOString(),
  } = params;
  const { flags, positionals } = parseKvFlags(payload);
  const action = (positionals[0] ?? "").toLowerCase();
  const projectId = (flags["project-id"] ?? "").trim();
  const workspaceRoot = (flags["workspace-root"] ?? "").trim();

  if (!action || !["set", "get", "clear", "list"].includes(action)) {
    return "usage: /orchestrate path set|get|clear|list ...";
  }
  if (action !== "list" && (!projectId || !isSafeProjectId(projectId))) {
    return "path command requires valid --project-id";
  }

  const state = await readPathState();

  if (action === "list") {
    const rows = Object.entries(state.projects)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([pid, row]) =>
          `- ${pid} workspace_root=${row.workspace_root} updated_at=${row.updated_at} updated_by=${row.updated_by}`,
      );
    return [
      `schema_version: ${state.schema_version}`,
      `updated_at: ${state.updated_at}`,
      rows.length > 0 ? "projects:" : "projects: (none)",
      ...rows,
    ].join("\n");
  }

  if (action === "get") {
    const row = state.projects[projectId];
    if (!row) {
      return `project_id: ${projectId}\nworkspace_root: (not set)`;
    }
    return [
      `project_id: ${projectId}`,
      `workspace_root: ${row.workspace_root}`,
      `updated_at: ${row.updated_at}`,
      `updated_by: ${row.updated_by}`,
    ].join("\n");
  }

  if (action === "clear") {
    if (state.projects[projectId]) {
      delete state.projects[projectId];
      state.updated_at = now();
      await writePathState(state);
    }
    return `project_id: ${projectId}\nworkspace_root: (cleared)`;
  }

  const err = validateWorkspaceRootRelative(workspaceRoot);
  if (err) {
    return `invalid --workspace-root: ${err}`;
  }
  try {
    resolveWorkspaceUnderProjects({
      repoRoot,
      projectsRootRel: projectsRoot,
      workspaceRootRel: workspaceRoot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `invalid --workspace-root: ${message}`;
  }

  const updatedAt = now();
  state.projects[projectId] = {
    workspace_root: workspaceRoot,
    updated_at: updatedAt,
    updated_by: senderId?.trim() || "session_or_actor",
  };
  state.updated_at = updatedAt;
  await writePathState(state);
  return [
    `project_id: ${projectId}`,
    `workspace_root: ${workspaceRoot}`,
    `projects_root: ${projectsRoot}`,
    "status: set",
  ].join("\n");
}
