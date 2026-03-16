export function renderOrchestrateHelp(): string {
  return [
    "/orchestrate start",
    "/orchestrate summary",
    "/orchestrate run",
    "/orchestrate stop",
    "/orchestrate session",
    "/orchestrate intake <free text> (legacy helper)",
    "/orchestrate status <task_id>",
    "/orchestrate status",
    "/orchestrate path set --project-id <project_id> --workspace-root <relative_path_under_projects>",
    "/orchestrate path get --project-id <project_id>",
    "/orchestrate path clear --project-id <project_id>",
    "/orchestrate path list",
    "/orchestrate amend <task_id> <extra requirement>",
    "/orchestrate resume <task_id>",
    "/orchestrate kb-sync <task_id> [approve|deny|auto-on|auto-off]",
    "/orchestrate help",
  ].join("\n");
}

export function renderRequiredConfigChecklist(): string {
  return [
    "required_config:",
    "- planner_current: version, state_machine, transition_script, audit_gate_script",
    "- planner_properties: worker_timeout_minutes, stale_in_progress_minutes, dashboard_refresh_minutes",
    "- audit_policy: rules[]",
    "- worker_profile: task-scoped worker id enabled",
  ].join("\n");
}

export function buildWorkerIdFromTaskId(taskId: string): string {
  const raw = taskId
    .replace(/^task_/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return `worker_${raw || "generic"}`;
}
