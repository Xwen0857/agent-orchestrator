#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
ACL_SCRIPT="$ROOT/agent-orchestrator/scripts/enforce_role_acl.sh"

ROLE=""
TASK_ID=""
TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"
WORKSPACE_ROOT=""
RUN_ROOT=""
RUNTIME_PROFILE=""

usage() {
  echo "usage: $0 --role <role> --task-id <task_id> --workspace-root <path> --run-root <path> [--runtime-profile <name>] -- <command...>"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      ROLE="$2"; shift 2 ;;
    --task-id)
      TASK_ID="$2"; shift 2 ;;
    --workspace-root)
      WORKSPACE_ROOT="$2"; shift 2 ;;
    --run-root)
      RUN_ROOT="$2"; shift 2 ;;
    --runtime-profile)
      RUNTIME_PROFILE="$2"; shift 2 ;;
    --tasks-root)
      TASKS_ROOT="$2"; shift 2 ;;
    --)
      shift
      break
      ;;
    *) usage ;;
  esac
done

[[ -n "$ROLE" && -n "$TASK_ID" && -n "$WORKSPACE_ROOT" && -n "$RUN_ROOT" ]] || usage
[[ $# -gt 0 ]] || usage

SANDBOX_ENABLED="$(jq -r '.security.sandbox_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
SANDBOX_DENIED_REL="$(jq -r '.security.sandbox_denied_path // "templates/coordination/security/sandbox_denied.ndjson"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/sandbox_denied.ndjson")"
SANDBOX_DENIED="$ROOT/$SANDBOX_DENIED_REL"
ISOLATION_ENABLED="$(jq -r '.agent_runtime_isolation.enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
PROFILE_FILE_NAME="$(jq -r '.agent_runtime_isolation.profiles_file // "agent_runtime_profiles.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "agent_runtime_profiles.json")"
DEFAULT_PROJECT_PROFILE="$(jq -r '.agent_runtime_isolation.project_profile_name // "project_execution"' "$RUNTIME_CONFIG" 2>/dev/null || echo "project_execution")"

if [[ -z "$RUNTIME_PROFILE" ]]; then
  RUNTIME_PROFILE="$DEFAULT_PROJECT_PROFILE"
fi

if [[ "$SANDBOX_ENABLED" != "true" ]]; then
  "$@"
  exit $?
fi

mkdir -p "$(dirname "$SANDBOX_DENIED")"

# Preflight ACL for declared writable roots.
if ! "$ACL_SCRIPT" --role "$ROLE" --action write --target "$WORKSPACE_ROOT" --task-id "$TASK_ID" --tasks-root "$TASKS_ROOT" >/dev/null; then
  jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg reason "workspace_root_not_allowed" --arg target "$WORKSPACE_ROOT" '{timestamp:$ts,role:$role,task_id:$task_id,reason:$reason,target:$target}' >> "$SANDBOX_DENIED"
  echo "sandbox deny: workspace root not allowed"
  exit 1
fi
if ! "$ACL_SCRIPT" --role "$ROLE" --action write --target "$RUN_ROOT" --task-id "$TASK_ID" --tasks-root "$TASKS_ROOT" >/dev/null; then
  jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg reason "run_root_not_allowed" --arg target "$RUN_ROOT" '{timestamp:$ts,role:$role,task_id:$task_id,reason:$reason,target:$target}' >> "$SANDBOX_DENIED"
  echo "sandbox deny: run root not allowed"
  exit 1
fi

if [[ "$ISOLATION_ENABLED" == "true" ]]; then
  PROFILE_FILE="$RUN_ROOT/$PROFILE_FILE_NAME"
  if [[ ! -f "$PROFILE_FILE" ]]; then
    jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg reason "runtime_profile_missing" --arg target "$PROFILE_FILE" '{timestamp:$ts,role:$role,task_id:$task_id,reason:$reason,target:$target}' >> "$SANDBOX_DENIED"
    echo "sandbox deny: runtime profile missing"
    exit 1
  fi
  export AGENT_RUNTIME_PROFILE="$RUNTIME_PROFILE"
  while IFS='=' read -r k v; do
    [[ -n "$k" ]] || continue
    export "$k"="$v"
  done < <(python3 - "$PROFILE_FILE" "$RUNTIME_PROFILE" <<'PY'
import json
import sys
from pathlib import Path

profile_file = Path(sys.argv[1]).resolve()
profile_name = sys.argv[2]
data = json.loads(profile_file.read_text(encoding="utf-8"))
profiles = data.get("profiles") or {}
profile = profiles.get(profile_name) or {}
env = profile.get("env") or {}
for k, v in env.items():
    if isinstance(k, str) and isinstance(v, str):
        print(f"{k}={v}")
PY
  )
  if [[ -z "${OPENCLAW_SKILLS_ROOT:-}" || -z "${OPENCLAW_MCP_ROOT:-}" || -z "${OPENCLAW_AGENT_CONFIG_ROOT:-}" ]]; then
    jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg reason "runtime_profile_invalid" --arg target "$RUNTIME_PROFILE" '{timestamp:$ts,role:$role,task_id:$task_id,reason:$reason,target:$target}' >> "$SANDBOX_DENIED"
    echo "sandbox deny: runtime profile invalid"
    exit 1
  fi
  if [[ "$ROLE" == "worker-delivery" || "$ROLE" == "tester-ephemeral" ]]; then
    if [[ "${OPENCLAW_AGENT_EXECUTION_SCOPE:-project}" != "project" ]]; then
      jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg reason "project_role_requires_project_scope" --arg target "${OPENCLAW_AGENT_EXECUTION_SCOPE:-}" '{timestamp:$ts,role:$role,task_id:$task_id,reason:$reason,target:$target}' >> "$SANDBOX_DENIED"
      echo "sandbox deny: worker/tester cannot run with orchestrator scope"
      exit 1
    fi
  fi
fi

# Lightweight local sandbox posture:
# - process-scoped cwd
# - readonly root hint env
# - strict temp dirs inside workspace
export AGENT_SANDBOX_ENABLED=true
export AGENT_SANDBOX_ROLE="$ROLE"
export AGENT_SANDBOX_TASK_ID="$TASK_ID"
export AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"
export AGENT_RUN_ROOT="$RUN_ROOT"
export TMPDIR="$WORKSPACE_ROOT/.tmp"
mkdir -p "$TMPDIR"
umask 077

(
  cd "$WORKSPACE_ROOT"
  "$@"
)
