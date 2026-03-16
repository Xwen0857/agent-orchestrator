#!/usr/bin/env bash
set -euo pipefail

# Materializes the per-task workspace/run directory contract and runtime-profile files
# before worker or tester execution begins.
# Inputs: task directory and an optional execution profile.
# Side effects: creates run/workspace directories, writes runtime profile metadata,
# seeds dependency/convention files, and refreshes the workspace manifest.
# Failure model: exits non-zero on missing task metadata, invalid workspace hints, or contract write failures.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
REFRESH_SCRIPT="$ROOT/agent-orchestrator/scripts/workspace_refresh_manifest.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir> [execution_profile]"
  exit 2
fi

TASK_DIR="$1"
EXECUTION_PROFILE="${2:-local_threads}"
META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta missing: $META"; exit 1; }

TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing"; exit 1; }

PROJECTS_ROOT_REL="$(jq -r '.workspace.projects_root // "projects"' "$RUNTIME_CONFIG" 2>/dev/null || echo "projects")"
PROJECTS_ROOT="$ROOT/$PROJECTS_ROOT_REL"
PROJECT_ID="$(jq -r '.project_id // "prj_default"' "$META")"
RUN_ROOT="$PROJECTS_ROOT/$PROJECT_ID/runs/$TASK_ID"
WORKSPACE_ROOT_HINT="$(jq -r '.workspace_root_hint // empty' "$META")"
WORKSPACE_SOURCE="$(jq -r '.workspace_config_source // "runtime_default"' "$META")"
WORKSPACE_ROOT="$RUN_ROOT/workspace"
ISOLATION_ENABLED="$(jq -r '.agent_runtime_isolation.enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
PROFILE_FILE_NAME="$(jq -r '.agent_runtime_isolation.profiles_file // "agent_runtime_profiles.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "agent_runtime_profiles.json")"
ORCH_PROFILE_NAME="$(jq -r '.agent_runtime_isolation.orchestrator_profile_name // "orchestrator_control"' "$RUNTIME_CONFIG" 2>/dev/null || echo "orchestrator_control")"
PROJ_PROFILE_NAME="$(jq -r '.agent_runtime_isolation.project_profile_name // "project_execution"' "$RUNTIME_CONFIG" 2>/dev/null || echo "project_execution")"
ORCH_ROOT_REL="$(jq -r '.agent_runtime_isolation.orchestrator_namespace.root // ".openclaw-system"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-system")"
ORCH_SKILLS_REL="$(jq -r '.agent_runtime_isolation.orchestrator_namespace.skills_dir // ".openclaw-system/skills"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-system/skills")"
ORCH_MCP_REL="$(jq -r '.agent_runtime_isolation.orchestrator_namespace.mcp_dir // ".openclaw-system/mcp"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-system/mcp")"
ORCH_CONFIG_REL="$(jq -r '.agent_runtime_isolation.orchestrator_namespace.config_dir // ".openclaw-system/config"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-system/config")"
PROJ_ROOT_REL="$(jq -r '.agent_runtime_isolation.project_namespace.root // ".openclaw-project"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-project")"
PROJ_SKILLS_REL="$(jq -r '.agent_runtime_isolation.project_namespace.skills_dir // ".openclaw-project/skills"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-project/skills")"
PROJ_MCP_REL="$(jq -r '.agent_runtime_isolation.project_namespace.mcp_dir // ".openclaw-project/mcp"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-project/mcp")"
PROJ_CONFIG_REL="$(jq -r '.agent_runtime_isolation.project_namespace.config_dir // ".openclaw-project/config"' "$RUNTIME_CONFIG" 2>/dev/null || echo ".openclaw-project/config")"
ORCH_READ_ONLY="$(jq -r '.agent_runtime_isolation.orchestrator_namespace.read_only // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"

# A workspace_root_hint may override the generated runtime default, but it must stay
# inside the configured projects root.
if [[ -n "$WORKSPACE_ROOT_HINT" ]]; then
  if [[ "$WORKSPACE_ROOT_HINT" == /* ]]; then
    echo "workspace_root_hint must be relative: $WORKSPACE_ROOT_HINT"
    exit 1
  fi
  if [[ "$WORKSPACE_ROOT_HINT" == ".." || "$WORKSPACE_ROOT_HINT" == ../* || "$WORKSPACE_ROOT_HINT" == */../* ]]; then
    echo "workspace_root_hint cannot contain ..: $WORKSPACE_ROOT_HINT"
    exit 1
  fi
  WORKSPACE_CANDIDATE="$(cd "$PROJECTS_ROOT" && cd "$WORKSPACE_ROOT_HINT" 2>/dev/null && pwd -P || true)"
  if [[ -z "$WORKSPACE_CANDIDATE" ]]; then
    mkdir -p "$PROJECTS_ROOT/$WORKSPACE_ROOT_HINT"
    WORKSPACE_CANDIDATE="$(cd "$PROJECTS_ROOT/$WORKSPACE_ROOT_HINT" && pwd -P)"
  fi
  PROJECTS_ROOT_ABS="$(cd "$PROJECTS_ROOT" && pwd -P)"
  if [[ "$WORKSPACE_CANDIDATE" != "$PROJECTS_ROOT_ABS/"* ]]; then
    echo "workspace_root_hint escapes projects root: $WORKSPACE_ROOT_HINT"
    exit 1
  fi
  WORKSPACE_ROOT="$WORKSPACE_CANDIDATE"
fi

# Create the full runtime layout before writing any contract files so later steps can
# assume a complete directory structure.
mkdir -p \
  "$WORKSPACE_ROOT" \
  "$RUN_ROOT/delivery" \
  "$RUN_ROOT/evidence" \
  "$RUN_ROOT/env" \
  "$RUN_ROOT/build" \
  "$RUN_ROOT/dist" \
  "$RUN_ROOT/.cache"

PROFILE_FILE="$RUN_ROOT/$PROFILE_FILE_NAME"
ORCH_ROOT="$RUN_ROOT/$ORCH_ROOT_REL"
ORCH_SKILLS="$RUN_ROOT/$ORCH_SKILLS_REL"
ORCH_MCP="$RUN_ROOT/$ORCH_MCP_REL"
ORCH_CONFIG="$RUN_ROOT/$ORCH_CONFIG_REL"
PROJ_ROOT="$RUN_ROOT/$PROJ_ROOT_REL"
PROJ_SKILLS="$RUN_ROOT/$PROJ_SKILLS_REL"
PROJ_MCP="$RUN_ROOT/$PROJ_MCP_REL"
PROJ_CONFIG="$RUN_ROOT/$PROJ_CONFIG_REL"

# Runtime isolation writes one profile file that maps orchestrator and project
# namespaces to explicit environment variables consumed by the sandbox wrapper.
if [[ "$ISOLATION_ENABLED" == "true" ]]; then
  mkdir -p \
    "$ORCH_ROOT" "$ORCH_SKILLS" "$ORCH_MCP" "$ORCH_CONFIG" \
    "$PROJ_ROOT" "$PROJ_SKILLS" "$PROJ_MCP" "$PROJ_CONFIG"
  if [[ ! -f "$ORCH_CONFIG/runtime.lock.json" ]]; then
    jq -cn \
      --arg schema_version "orchestrator-runtime-lock-v1" \
      --arg created_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      --arg source_repo "$ROOT" \
      --arg note "orchestrator-managed dependency namespace; project agents must not mutate" \
      '{schema_version:$schema_version,created_at:$created_at,source_repo:$source_repo,note:$note}' > "$ORCH_CONFIG/runtime.lock.json"
  fi
  if [[ ! -f "$PROJ_CONFIG/runtime.profile.json" ]]; then
    jq -cn \
      --arg schema_version "project-runtime-profile-v1" \
      --arg created_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      --arg note "project-scoped dependency namespace for worker/tester execution" \
      '{schema_version:$schema_version,created_at:$created_at,note:$note}' > "$PROJ_CONFIG/runtime.profile.json"
  fi
  jq -cn \
    --arg schema_version "agent-runtime-profiles-v1" \
    --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg orchestrator_profile "$ORCH_PROFILE_NAME" \
    --arg project_profile "$PROJ_PROFILE_NAME" \
    --arg orch_skills "$ORCH_SKILLS" \
    --arg orch_mcp "$ORCH_MCP" \
    --arg orch_config "$ORCH_CONFIG" \
    --arg proj_skills "$PROJ_SKILLS" \
    --arg proj_mcp "$PROJ_MCP" \
    --arg proj_config "$PROJ_CONFIG" \
    --arg workspace_root "$WORKSPACE_ROOT" \
    --arg run_root "$RUN_ROOT" \
    '{
      schema_version:$schema_version,
      generated_at:$generated_at,
      profiles:{
        ($orchestrator_profile):{
          namespace:"orchestrator",
          env:{
            OPENCLAW_SKILLS_ROOT:$orch_skills,
            OPENCLAW_MCP_ROOT:$orch_mcp,
            OPENCLAW_AGENT_CONFIG_ROOT:$orch_config,
            OPENCLAW_AGENT_EXECUTION_SCOPE:"orchestrator"
          }
        },
        ($project_profile):{
          namespace:"project",
          env:{
            OPENCLAW_SKILLS_ROOT:$proj_skills,
            OPENCLAW_MCP_ROOT:$proj_mcp,
            OPENCLAW_AGENT_CONFIG_ROOT:$proj_config,
            OPENCLAW_AGENT_EXECUTION_SCOPE:"project",
            OPENCLAW_WORKSPACE_ROOT:$workspace_root
          }
        }
      },
      protected_paths:[
        $orch_skills,
        $orch_mcp,
        $orch_config
      ],
      writable_project_paths:[
        $proj_skills,
        $proj_mcp,
        $proj_config,
        $workspace_root
      ],
      run_root:$run_root
    }' > "$PROFILE_FILE"
  if [[ "$ORCH_READ_ONLY" == "true" ]]; then
    chmod -R a-w "$ORCH_ROOT" 2>/dev/null || true
  fi
fi

DEP_FILE="$RUN_ROOT/workspace.dep.yaml"
CONV_FILE="$RUN_ROOT/workspace.conventions.yaml"
ENVSPEC="$RUN_ROOT/.envspec.json"

if [[ ! -f "$DEP_FILE" ]]; then
  cat > "$DEP_FILE" <<'YAML'
version: 1
language: generic
package_manager: none
lock_required: false
install:
  command: ""
YAML
fi

if [[ ! -f "$CONV_FILE" ]]; then
  cat > "$CONV_FILE" <<'YAML'
version: 1
build:
  command: ""
  output_dir: "build"
  release_dir: "dist"
test:
  command: ""
lint:
  command: ""
YAML
fi

if [[ ! -f "$ENVSPEC" ]]; then
  cat > "$ENVSPEC" <<JSON
{
  "schema_version": "envspec-v1",
  "profile": "local-venv",
  "build": {
    "command": "",
    "output_dir": "build",
    "release_dir": "dist",
    "manifest": "build_manifest.json"
  },
  "python": {
    "version": "",
    "venv_dir": "env/venv"
  },
  "node": {
    "version": "",
    "package_manager": "pnpm"
  },
  "custom": {
    "command": ""
  }
}
JSON
fi

MANIFEST_JSON="$($REFRESH_SCRIPT "$RUN_ROOT")"
SNAPSHOT_ID="$(printf '%s' "$MANIFEST_JSON" | jq -r '.snapshot_id // ""')"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

TMP_META="$(mktemp "$TASK_DIR/.meta.workspace.XXXXXX.json")"
jq \
  --arg project_id "$PROJECT_ID" \
  --arg run_id "$TASK_ID" \
  --arg run_root "$RUN_ROOT" \
  --arg workspace_root "$WORKSPACE_ROOT" \
  --arg artifact_root "$WORKSPACE_ROOT/delivery" \
  --arg artifact_mode "workspace_primary" \
  --arg workspace_source "$WORKSPACE_SOURCE" \
  --arg workspace_validated "true" \
  --arg execution_profile "$EXECUTION_PROFILE" \
  --arg runtime_profile_file "$PROFILE_FILE" \
  --arg runtime_profile_project "$PROJ_PROFILE_NAME" \
  --arg runtime_profile_orchestrator "$ORCH_PROFILE_NAME" \
  --arg skill_mcp_isolation_enabled "$ISOLATION_ENABLED" \
  --arg snapshot_id "$SNAPSHOT_ID" \
  --arg now "$NOW" \
  '.project_id = $project_id
  | .run_id = $run_id
  | .run_root = $run_root
  | .workspace_root = $workspace_root
  | .artifact_root = $artifact_root
  | .artifact_mode = $artifact_mode
  | .workspace_config_source = $workspace_source
  | .workspace_validated = ($workspace_validated == "true")
  | .execution_profile = $execution_profile
  | .runtime_profile_file = $runtime_profile_file
  | .runtime_profile_project = $runtime_profile_project
  | .runtime_profile_orchestrator = $runtime_profile_orchestrator
  | .skill_mcp_isolation_enabled = ($skill_mcp_isolation_enabled == "true")
  | .workspace_version = (.workspace_version // 1)
  | .snapshot_id = $snapshot_id
  | .dirty_state = false
  | .workspace_user_change_seq = (.workspace_user_change_seq // 0)
  | .workspace_last_synced_seq = (.workspace_last_synced_seq // 0)
  | .workspace_last_sync_reason = (.workspace_last_sync_reason // "")
  | .kb_import = (.kb_import // {last_request_id:"",last_decision:"",last_decision_at:""})
  | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

jq -cn \
  --arg status "ok" \
  --arg task_id "$TASK_ID" \
  --arg project_id "$PROJECT_ID" \
  --arg run_root "$RUN_ROOT" \
  --arg workspace_root "$WORKSPACE_ROOT" \
  --arg snapshot_id "$SNAPSHOT_ID" \
  '{status:$status,task_id:$task_id,project_id:$project_id,run_root:$run_root,workspace_root:$workspace_root,snapshot_id:$snapshot_id}'
