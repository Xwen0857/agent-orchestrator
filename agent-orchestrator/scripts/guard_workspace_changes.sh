#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
RUNTIME_CONFIG="$ROOT/templates/coordination/orchestrator/execution_runtime.json"
ACL_SCRIPT="$ROOT/agent-orchestrator/scripts/enforce_role_acl.sh"

ROLE="worker-delivery"
TASK_ID=""
RUN_ROOT=""
TASKS_ROOT="$ROOT/templates/coordination/tasks/task_folders"

usage() {
  echo "usage: $0 --task-id <task_id> --run-root <path> [--role <role>] [--tasks-root <path>]"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --run-root) RUN_ROOT="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --tasks-root) TASKS_ROOT="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$TASK_ID" && -n "$RUN_ROOT" ]] || usage

ENABLED="$(jq -r '.security.commit_guard_enabled // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
DENIED_REL="$(jq -r '.security.commit_guard_denied_path // "templates/coordination/security/commit_guard_denied.ndjson"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/commit_guard_denied.ndjson")"
DENIED_PATH="$ROOT/$DENIED_REL"
PROTECT_ORCH_CONFIG="$(jq -r '.agent_runtime_isolation.protect_orchestrator_config // true' "$RUNTIME_CONFIG" 2>/dev/null || echo true)"
POLICY_PATH_REL="$(jq -r '.security.role_policy_path // "templates/coordination/security/role_permissions.effective.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "templates/coordination/security/role_permissions.effective.json")"
POLICY_PATH="$ROOT/$POLICY_PATH_REL"
mkdir -p "$(dirname "$DENIED_PATH")"

if [[ "$ENABLED" != "true" ]]; then
  jq -cn --arg status "skipped" '{status:$status}'
  exit 0
fi

CHANGED=()
RUN_ROOT_REL=""
if [[ "$RUN_ROOT" == "$ROOT"/* ]]; then
  RUN_ROOT_REL="${RUN_ROOT#$ROOT/}"
fi
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "$RUN_ROOT_REL" ]]; then
    while IFS= read -r p; do [[ -n "$p" ]] && CHANGED+=("$ROOT/$p"); done < <(git -C "$ROOT" diff --name-only -- "$RUN_ROOT_REL" || true)
    while IFS= read -r p; do [[ -n "$p" ]] && CHANGED+=("$ROOT/$p"); done < <(git -C "$ROOT" ls-files --others --exclude-standard -- "$RUN_ROOT_REL" || true)
  else
    # Fallback for non-repo or out-of-tree run roots.
    while IFS= read -r p; do [[ -n "$p" ]] && CHANGED+=("$ROOT/$p"); done < <(git -C "$ROOT" diff --name-only -- "$RUN_ROOT" || true)
    while IFS= read -r p; do [[ -n "$p" ]] && CHANGED+=("$ROOT/$p"); done < <(git -C "$ROOT" ls-files --others --exclude-standard -- "$RUN_ROOT" || true)
  fi
fi

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  while IFS= read -r p; do CHANGED+=("$p"); done < <(find "$RUN_ROOT" -type f 2>/dev/null || true)
fi

# Guard only user/project submission surfaces.
# Runtime control files (for example .openclaw-system, profile files) are managed by orchestrator.
if [[ ${#CHANGED[@]} -gt 0 ]]; then
  scoped_changed=()
  for target in "${CHANGED[@]}"; do
    rel="${target#$RUN_ROOT/}"
    case "$rel" in
      workspace/*|delivery/*|artifacts/*)
        scoped_changed+=("$target")
        ;;
      *)
        continue
        ;;
    esac
  done
  CHANGED=("${scoped_changed[@]}")
fi

# Drop ephemeral runtime files/dirs from commit-guard checks.
# These are build/runtime side effects and do not represent submitted delivery edits.
if [[ ${#CHANGED[@]} -gt 0 ]]; then
  filtered_changed=()
  for target in "${CHANGED[@]}"; do
    rel="${target#$RUN_ROOT/}"
    case "$rel" in
      env/*|.cache/*|build/*|dist/*|manifest.lock.json|env_build_report.json|build_manifest.json|workspace_change_report.json)
        continue
        ;;
      *)
        filtered_changed+=("$target")
        ;;
    esac
  done
  CHANGED=("${filtered_changed[@]}")
fi

# Deduplicate to avoid quadratic ACL checks when git returns repeated paths.
if [[ ${#CHANGED[@]} -gt 1 ]]; then
  uniq_changed=()
  while IFS= read -r p; do
    [[ -n "$p" ]] && uniq_changed+=("$p")
  done < <(printf '%s\n' "${CHANGED[@]}" | awk '!seen[$0]++')
  CHANGED=("${uniq_changed[@]}")
fi

DENIED=0
runtime_profile_file="$RUN_ROOT/$(jq -r '.agent_runtime_isolation.profiles_file // "agent_runtime_profiles.json"' "$RUNTIME_CONFIG" 2>/dev/null || echo "agent_runtime_profiles.json")"
protected_paths=()
if [[ "$PROTECT_ORCH_CONFIG" == "true" ]]; then
  protected_paths+=("$RUN_ROOT/.openclaw-system")
  protected_paths+=("$runtime_profile_file")
fi
for target in "${CHANGED[@]}"; do
  for p in "${protected_paths[@]}"; do
    if [[ "$target" == "$p" || "$target" == "$p/"* ]]; then
      DENIED=$((DENIED + 1))
      jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg target "$target" --arg reason "commit_guard_protected_runtime_path" '{timestamp:$ts,role:$role,task_id:$task_id,target:$target,reason:$reason}' >> "$DENIED_PATH"
      continue 2
    fi
  done
done

if [[ ${#CHANGED[@]} -gt 0 ]]; then
  if [[ ! -f "$POLICY_PATH" ]]; then
    # Fallback to existing ACL script behavior when policy is unavailable.
    for target in "${CHANGED[@]}"; do
      if ! "$ACL_SCRIPT" --role "$ROLE" --action write --target "$target" --task-id "$TASK_ID" --tasks-root "$TASKS_ROOT" >/dev/null 2>&1; then
        DENIED=$((DENIED + 1))
        jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg target "$target" --arg reason "commit_guard_acl_denied" '{timestamp:$ts,role:$role,task_id:$task_id,target:$target,reason:$reason}' >> "$DENIED_PATH"
      fi
    done
  else
    changed_file="$(mktemp "$RUN_ROOT/.guard.changed.XXXXXX.txt")"
    denied_file="$(mktemp "$RUN_ROOT/.guard.denied.XXXXXX.txt")"
    printf '%s\n' "${CHANGED[@]}" > "$changed_file"
    python3 - "$ROOT" "$POLICY_PATH" "$ROLE" "$changed_file" "$denied_file" <<'PY'
import fnmatch
import json
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
policy_path = Path(sys.argv[2]).resolve()
role = sys.argv[3]
changed_file = Path(sys.argv[4]).resolve()
denied_file = Path(sys.argv[5]).resolve()

policy = json.loads(policy_path.read_text(encoding="utf-8"))
roles = policy.get("roles") or {}
rp = roles.get(role) or {}
allowed = [str(x or "") for x in (rp.get("allowed_write_paths") or [])]
forbidden = [str(x or "") for x in (rp.get("forbidden_paths") or [])]

def to_abs(rule: str) -> str:
    rule = (rule or "").strip()
    if not rule:
        return ""
    if os.path.isabs(rule):
        return str(Path(rule).resolve(strict=False))
    return str((root / rule).resolve(strict=False))

def is_glob(rule: str) -> bool:
    return any(c in rule for c in ("*", "?", "["))

def match(target_abs: str, rule: str) -> bool:
    abs_rule = to_abs(rule)
    if not abs_rule:
        return False
    t = Path(target_abs).as_posix()
    r = Path(abs_rule).as_posix()
    if is_glob(rule):
        return (
            fnmatch.fnmatch(t, r)
            or fnmatch.fnmatch(t, r.rstrip("/") + "/*")
            or fnmatch.fnmatch(t + "/", r.rstrip("/") + "/")
        )
    return target_abs == abs_rule or target_abs.startswith(abs_rule + os.sep)

targets = []
for raw in changed_file.read_text(encoding="utf-8").splitlines():
    p = raw.strip()
    if not p:
        continue
    targets.append(str(Path(p).resolve(strict=False)))

denied = []
for t in targets:
    ok = any(match(t, r) for r in allowed)
    if any(match(t, r) for r in forbidden):
        ok = False
    if not ok:
        denied.append(t)

denied_file.write_text("\n".join(denied) + ("\n" if denied else ""), encoding="utf-8")
PY
    if [[ -s "$denied_file" ]]; then
      while IFS= read -r target; do
        [[ -n "$target" ]] || continue
        DENIED=$((DENIED + 1))
        jq -cn --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" --arg role "$ROLE" --arg task_id "$TASK_ID" --arg target "$target" --arg reason "commit_guard_acl_denied" '{timestamp:$ts,role:$role,task_id:$task_id,target:$target,reason:$reason}' >> "$DENIED_PATH"
      done < "$denied_file"
    fi
    rm -f "$changed_file" "$denied_file"
  fi
fi

if [[ $DENIED -gt 0 ]]; then
  jq -cn --arg status "deny" --argjson denied "$DENIED" '{status:$status,denied:$denied}'
  exit 1
fi

jq -cn --arg status "allow" --argjson checked "${#CHANGED[@]}" '{status:$status,checked:$checked}'
