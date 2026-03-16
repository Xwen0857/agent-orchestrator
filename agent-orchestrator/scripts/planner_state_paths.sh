#!/usr/bin/env bash
set -euo pipefail

# Shared path helpers for planner runtime files under the agent-orchestrator
# state directory.
# Inputs: optional environment overrides via AGENT_ORCHESTRATOR_STATE_DIR,
# OPENCLAW_STATE_DIR, or CLAWDBOT_STATE_DIR.
# Side effects: helper functions may create runtime files from templates.
# Failure model: path resolvers return defaults; file creators exit only if copy/write fails.

resolve_agent_orchestrator_state_root() {
  local explicit="${AGENT_ORCHESTRATOR_STATE_DIR:-}"
  if [[ -n "$explicit" && "$explicit" == /* ]]; then
    printf '%s\n' "${explicit%/}"
    return
  fi

  local host_state="${OPENCLAW_STATE_DIR:-${CLAWDBOT_STATE_DIR:-}}"
  if [[ -n "$host_state" && "$host_state" == /* ]]; then
    printf '%s\n' "${host_state%/}/agent-orchestrator"
    return
  fi

  printf '%s\n' "${HOME}/.openclaw-state/agent-orchestrator"
}

resolve_planner_runtime_dir() {
  printf '%s\n' "$(resolve_agent_orchestrator_state_root)/planner"
}

resolve_planner_checklist_path() {
  printf '%s\n' "$(resolve_planner_runtime_dir)/checklist.md"
}

resolve_planner_primary_path() {
  printf '%s\n' "$(resolve_planner_runtime_dir)/primary.md"
}

resolve_tasks_runtime_dir() {
  printf '%s\n' "$(resolve_agent_orchestrator_state_root)/tasks"
}

resolve_subchecklists_runtime_dir() {
  printf '%s\n' "$(resolve_tasks_runtime_dir)/subchecklists"
}

resolve_worker_tasks_runtime_dir() {
  printf '%s\n' "$(resolve_tasks_runtime_dir)/worker_tasks"
}

ensure_planner_checklist_file() {
  local checklist_path="$1"
  local template_path="$2"

  mkdir -p "$(dirname "$checklist_path")"
  if [[ -f "$checklist_path" ]]; then
    return
  fi

  if [[ -f "$template_path" ]]; then
    cp "$template_path" "$checklist_path"
    return
  fi

  # Fall back to a stub checklist so planner flows still have a writable runtime
  # file even when the template is absent.
  cat > "$checklist_path" <<'TABLE'
# Planner Checklist Example

| checklist_item_id | title | owner_role | status | depends_on | acceptance | notes |
|---|---|---|---|---|---|---|
| CL-01 | Example milestone | planner | TODO |  | sample acceptance | replace with runtime entries |
TABLE
}

ensure_runtime_file_from_template() {
  local file_path="$1"
  local template_path="$2"

  mkdir -p "$(dirname "$file_path")"
  if [[ -f "$file_path" ]]; then
    return
  fi

  if [[ -f "$template_path" ]]; then
    cp "$template_path" "$file_path"
    return
  fi

  : > "$file_path"
}
