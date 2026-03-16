#!/usr/bin/env bash
set -euo pipefail

# Evaluates whether a role may perform an action against a target path under the
# current role policy.
# Inputs: role, action, target, and optional task context.
# Side effects: appends denied events and may update task ACL fields in meta.json.
# Failure model: exits non-zero when denied in enforce mode or when usage is invalid.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
BUILD_SCRIPT="$ROOT/agent-orchestrator/scripts/build_role_permissions.sh"

ROLE=""
ACTION=""
TARGET=""
TASK_ID=""
TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"

usage() {
  echo "usage: $0 --role <role> --action <read|write|append|exec> --target <path> [--task-id <task_id>] [--tasks-root <path>]"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || usage
      ROLE="$2"
      shift 2
      ;;
    --action)
      [[ $# -ge 2 ]] || usage
      ACTION="$2"
      shift 2
      ;;
    --target)
      [[ $# -ge 2 ]] || usage
      TARGET="$2"
      shift 2
      ;;
    --task-id)
      [[ $# -ge 2 ]] || usage
      TASK_ID="$2"
      shift 2
      ;;
    --tasks-root)
      [[ $# -ge 2 ]] || usage
      TASKS_ROOT="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$ROLE" && -n "$ACTION" && -n "$TARGET" ]] || usage

POLICY_MODE="$(jq -r '.security.policy_mode // "enforce"' "$RUNTIME_CONFIG" 2>/dev/null || echo enforce)"
POLICY_PATH_REL="$(jq -r '.security.role_policy_path // "templates/coordination/security/role_permissions.effective.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/role_permissions.effective.json")"
DENIED_PATH_REL="$(jq -r '.security.denied_events_path // "templates/coordination/security/acl_denied.ndjson"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/acl_denied.ndjson")"
POLICY_PATH="$ROOT/$POLICY_PATH_REL"
DENIED_PATH="$ROOT/$DENIED_PATH_REL"

if [[ ! -f "$POLICY_PATH" ]]; then
  "$BUILD_SCRIPT" >/dev/null
fi

# Python handles path normalization and glob matching because the rule set is
# easier to express safely there than in shell.
result_json="$(python3 - "$ROOT" "$POLICY_PATH" "$ROLE" "$ACTION" "$TARGET" <<'PY'
import json
import os
import fnmatch
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
policy_path = Path(sys.argv[2]).resolve()
role = sys.argv[3]
action = sys.argv[4]
target = sys.argv[5]

try:
    policy = json.loads(policy_path.read_text(encoding='utf-8'))
except Exception:
    print(json.dumps({"allowed": False, "reason": "policy_unreadable", "version": "unknown"}))
    raise SystemExit

roles = policy.get("roles") or {}
rp = roles.get(role)
if not rp:
    print(json.dumps({"allowed": False, "reason": "role_not_found", "version": policy.get("version", "unknown")}))
    raise SystemExit

def to_abs(p: str) -> str:
    p = (p or "").strip()
    if not p:
        return ""
    if os.path.isabs(p):
        return str(Path(p).resolve(strict=False))
    return str((root / p).resolve(strict=False))

def is_glob_rule(rule: str) -> bool:
    return any(c in rule for c in ("*", "?", "["))

def match_rule(target_abs: str, rule_raw: str) -> bool:
    rule_abs = to_abs(rule_raw)
    if not rule_abs:
        return False
    target_posix = Path(target_abs).as_posix()
    rule_posix = Path(rule_abs).as_posix()
    if is_glob_rule(rule_raw):
        if fnmatch.fnmatch(target_posix, rule_posix):
            return True
        if fnmatch.fnmatch(target_posix, rule_posix.rstrip("/") + "/*"):
            return True
        if fnmatch.fnmatch(target_posix + "/", rule_posix.rstrip("/") + "/"):
            return True
        return False
    return target_abs == rule_abs or target_abs.startswith(rule_abs + os.sep)

target_abs = to_abs(target)
allowed_key = "allowed_read_paths" if action in ("read", "exec") else "allowed_write_paths"
allowed_list = [str(p or "") for p in (rp.get(allowed_key) or [])]
forbidden_list = [str(p or "") for p in (rp.get("forbidden_paths") or [])]

allowed = False
for p in allowed_list:
    if match_rule(target_abs, p):
        allowed = True
        break
for p in forbidden_list:
    if match_rule(target_abs, p):
        allowed = False
        reason = "forbidden_path"
        break
else:
    reason = "allowed" if allowed else f"not_in_{allowed_key}"

print(json.dumps({
    "allowed": allowed,
    "reason": reason,
    "target_abs": target_abs,
    "version": policy.get("version", "unknown"),
}))
PY
)"

allowed="$(printf '%s' "$result_json" | jq -r '.allowed')"
reason="$(printf '%s' "$result_json" | jq -r '.reason')"
version="$(printf '%s' "$result_json" | jq -r '.version')"
target_abs="$(printf '%s' "$result_json" | jq -r '.target_abs // ""')"

if [[ "$allowed" == "true" ]]; then
  jq -cn --arg status "allow" --arg role "$ROLE" --arg action "$ACTION" --arg target "$target_abs" --arg version "$version" '{status:$status,role:$role,action:$action,target:$target,role_policy_version:$version}'
  exit 0
fi

mkdir -p "$(dirname "$DENIED_PATH")"
ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

jq -cn \
  --arg timestamp "$ts" \
  --arg role "$ROLE" \
  --arg action "$ACTION" \
  --arg target "$target_abs" \
  --arg task_id "$TASK_ID" \
  --arg reason "$reason" \
  --arg mode "$POLICY_MODE" \
  --arg role_policy_version "$version" \
  '{timestamp:$timestamp,role:$role,action:$action,target:$target,task_id:$task_id,reason:$reason,policy_mode:$mode,role_policy_version:$role_policy_version}' >> "$DENIED_PATH"

if [[ -n "$TASK_ID" ]]; then
  META="$TASKS_ROOT/$TASK_ID/meta.json"
  if [[ -f "$META" ]]; then
    tmp_meta="$(mktemp "$TASKS_ROOT/$TASK_ID/.meta.acl.XXXXXX.json")"
    jq \
      --arg now "$ts" \
      --arg reason "$reason" \
      --arg mode "$POLICY_MODE" \
      --arg target "$target_abs" \
      --arg role "$ROLE" \
      --arg version "$version" \
      '.acl = (.acl // {})
      | .acl.denied_count = ((.acl.denied_count // 0) + 1)
      | .acl.last_denied_at = $now
      | .acl.last_denied_reason = $reason
      | .acl.last_denied_role = $role
      | .acl.last_denied_target = $target
      | .acl.policy_mode = $mode
      | .role_constraints_version = $version
      | .updated_at = $now' "$META" > "$tmp_meta" && mv "$tmp_meta" "$META"
  fi
fi

# Warn mode logs and reports a soft denial but deliberately leaves the command
# path successful for observability-only deployments.
if [[ "$POLICY_MODE" == "warn" ]]; then
  jq -cn --arg status "warn" --arg role "$ROLE" --arg action "$ACTION" --arg target "$target_abs" --arg reason "$reason" --arg role_policy_version "$version" '{status:$status,role:$role,action:$action,target:$target,reason:$reason,role_policy_version:$role_policy_version}'
  exit 0
fi

jq -cn --arg status "deny" --arg role "$ROLE" --arg action "$ACTION" --arg target "$target_abs" --arg reason "$reason" --arg role_policy_version "$version" '{status:$status,role:$role,action:$action,target:$target,reason:$reason,role_policy_version:$role_policy_version}'
exit 1
