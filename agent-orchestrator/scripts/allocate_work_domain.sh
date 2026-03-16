#!/usr/bin/env bash
set -euo pipefail

# Allocates a worker-specific work domain for a task and records the workspace
# path back into task metadata.
# Inputs: task directory and optional worker id.
# Side effects: creates workspace directories and rewrites task meta.json.
# Failure model: exits non-zero when task metadata is missing or invalid.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
POLICY_FILE_DEFAULT="$ROOT/templates/coordination/security/role_permissions.effective.json"
BUILD_SCRIPT="$ROOT/agent-orchestrator/scripts/build_role_permissions.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir> [worker_id]"
  exit 2
fi

TASK_DIR="$1"
WORKER_ID="${2:-worker_default}"
META="$TASK_DIR/meta.json"

if [[ ! -f "$META" ]]; then
  echo "meta.json missing: $META"
  exit 1
fi

TASK_ID="$(jq -r '.id // empty' "$META")"
[[ -n "$TASK_ID" ]] || { echo "task id missing in meta"; exit 1; }

WORKDOMAIN_ROOT_REL="$(jq -r '.workdomain.root // "runtime/workdomains"' "$RUNTIME_CONFIG" 2>/dev/null || echo "runtime/workdomains")"
POLICY_PATH_REL="$(jq -r '.security.role_policy_path // "templates/coordination/security/role_permissions.effective.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/role_permissions.effective.json")"
WORKDOMAIN_ROOT="$ROOT/$WORKDOMAIN_ROOT_REL"
POLICY_PATH="$ROOT/$POLICY_PATH_REL"

if [[ ! -f "$POLICY_PATH" ]]; then
  "$BUILD_SCRIPT" >/dev/null
fi
if [[ ! -f "$POLICY_PATH" ]]; then
  POLICY_PATH="$POLICY_FILE_DEFAULT"
fi

ROLE_POLICY_VERSION="$(jq -r '.version // "unknown"' "$POLICY_PATH" 2>/dev/null || echo "unknown")"

WORK_DOMAIN_ID="wd_${TASK_ID}_${WORKER_ID}"
WORKSPACE_ROOT="$WORKDOMAIN_ROOT/$TASK_ID/$WORKER_ID"

mkdir -p "$WORKSPACE_ROOT/src" "$WORKSPACE_ROOT/tests" "$WORKSPACE_ROOT/artifacts"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TMP_META="$(mktemp "$TASK_DIR/.meta.workdomain.XXXXXX.json")"

# Update task metadata through a temp file so readers never see a partial write.
jq \
  --arg work_domain_id "$WORK_DOMAIN_ID" \
  --arg workspace_root "$WORKSPACE_ROOT" \
  --arg now "$NOW" \
  --arg role_constraints_version "$ROLE_POLICY_VERSION" \
  '.work_domain_id = $work_domain_id
  | .workspace_root = $workspace_root
  | .role_constraints_version = $role_constraints_version
  | .acl = (.acl // {denied_count:0,last_denied_at:"",last_denied_reason:""})
  | .acl.denied_count = (.acl.denied_count // 0)
  | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"

jq -cn \
  --arg status "ok" \
  --arg task_id "$TASK_ID" \
  --arg worker_id "$WORKER_ID" \
  --arg work_domain_id "$WORK_DOMAIN_ID" \
  --arg workspace_root "$WORKSPACE_ROOT" \
  --arg role_policy_version "$ROLE_POLICY_VERSION" \
  '{status:$status,task_id:$task_id,worker_id:$worker_id,work_domain_id:$work_domain_id,workspace_root:$workspace_root,role_policy_version:$role_policy_version}'
