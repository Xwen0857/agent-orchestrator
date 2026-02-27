#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
SECURITY_DIR="$ROOT/templates/coordination/security"
GENERATED="$SECURITY_DIR/role_permissions.generated.json"
OVERRIDES="$SECURITY_DIR/role_permissions.overrides.json"
EFFECTIVE="$SECURITY_DIR/role_permissions.effective.json"

mkdir -p "$SECURITY_DIR"

if [[ ! -f "$OVERRIDES" ]]; then
  cat > "$OVERRIDES" <<'JSON'
{
  "roles": {}
}
JSON
fi

python3 - "$ROOT" "$GENERATED" "$OVERRIDES" "$EFFECTIVE" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1])
generated = Path(sys.argv[2])
overrides = Path(sys.argv[3])
effective = Path(sys.argv[4])

skills = {
    "planner-ops": root / "planner-ops/SKILL.md",
    "planner-core": root / "planner-core/SKILL.md",
    "scheduler-ops": root / "scheduler-ops/SKILL.md",
    "worker-delivery": root / "worker-delivery/SKILL.md",
    "tester-ephemeral": root / "tester-ephemeral/SKILL.md",
    "audit-guard": root / "audit-guard/SKILL.md",
}

header_re = re.compile(r"^##+\s*(.+)$")
path_re = re.compile(r"`([^`]+)`")


def normalize_path(p: str) -> str:
    p = p.strip()
    if p.startswith("/"):
        return p
    return p.strip("./")


def is_candidate_path(p: str) -> bool:
    if not p:
        return False
    if "<" in p or ">" in p:
        return False
    if p == "interface.json":
        return True
    return p.startswith("templates/") or p.startswith("runtime/") or p.startswith("projects/")


def dedup(arr):
    out = []
    seen = set()
    for i in arr:
        if not i:
            continue
        if i in seen:
            continue
        seen.add(i)
        out.append(i)
    return out

roles = {}
for role, path in skills.items():
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    section = ""
    allowed_read = []
    allowed_write = []
    forbidden = []
    for raw in text.splitlines():
        line = raw.strip()
        m = header_re.match(line)
        if m:
            section = m.group(1)
            continue
        found = path_re.findall(line)
        if not found:
            continue
        paths = [normalize_path(p) for p in found]
        paths = [p for p in paths if is_candidate_path(p)]
        if not paths:
            continue
        lower_section = section.lower()
        if "权限声明" in section:
            lower_line = line.lower()
            if "allowed_read_paths" in lower_line:
                allowed_read.extend(paths)
            elif "allowed_write_paths" in lower_line:
                allowed_write.extend(paths)
            elif "forbidden_paths" in lower_line:
                forbidden.extend(paths)
            continue
        if "输入文件" in section or "读取文件" in section or "read" in lower_section:
            allowed_read.extend(paths)
        if "输出文件" in section or "write" in lower_section:
            allowed_write.extend(paths)
        if ("禁止" in line or "forbid" in line.lower()) and ("权限声明" in section or "permission" in lower_section):
            forbidden.extend(paths)

    # Baseline defaults for workdomain + runtime access.
    allowed_read.extend([
        "templates/coordination/tasks/task_folders",
        "templates/coordination/orchestrator/execution_runtime.json",
        "templates/coordination/security/role_permissions.effective.json",
        "runtime/workdomains",
    ])
    if role == "worker-delivery":
        allowed_write.extend([
            "runtime/workdomains",
            "templates/coordination/tasks/task_folders",
            "templates/coordination/testers",
        ])
        forbidden.extend([
            "templates/coordination/tasks/worker_tasks",
            "templates/coordination/planner/config",
            "templates/coordination/audit/policy",
        ])
    elif role == "tester-ephemeral":
        allowed_write.extend([
            "templates/coordination/testers",
            "templates/coordination/tasks/task_folders",
            "projects",
        ])
        forbidden.extend([
            "templates/coordination/planner/config",
            "templates/coordination/audit/policy",
        ])
    elif role == "planner-ops":
        allowed_write.extend([
            "templates/coordination/planner",
            "templates/coordination/tasks/subchecklists",
            "templates/coordination/tasks/worker_tasks",
            "templates/coordination/workers",
            "templates/coordination/worker_lifecycle",
            "templates/coordination/tasks/task_folders",
            "runtime/workdomains",
        ])
    elif role == "scheduler-ops":
        allowed_write.extend([
            "templates/coordination/tasks/task_folders",
            "templates/coordination/orchestrator",
            "runtime/workdomains",
        ])
    elif role == "planner-core":
        allowed_write.extend([
            "templates/coordination/planner",
            "templates/coordination/tasks/subchecklists",
            "templates/coordination/tasks/worker_tasks",
            "templates/coordination/tasks/task_folders",
            "runtime/workdomains",
        ])
    elif role == "audit-guard":
        allowed_write.extend([
            "templates/coordination/tasks/task_folders",
            "templates/coordination/audit",
            "templates/coordination/security",
        ])

    roles[role] = {
        "allowed_read_paths": dedup(allowed_read),
        "allowed_write_paths": dedup(allowed_write),
        "forbidden_paths": dedup(forbidden),
    }

payload = {
    "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": {
        "planner-ops": "planner-ops/SKILL.md",
        "planner-core": "planner-core/SKILL.md",
        "scheduler-ops": "scheduler-ops/SKILL.md",
        "worker-delivery": "worker-delivery/SKILL.md",
        "tester-ephemeral": "tester-ephemeral/SKILL.md",
        "audit-guard": "audit-guard/SKILL.md",
    },
    "roles": roles,
}

generated.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

ov = {}
try:
    ov = json.loads(overrides.read_text(encoding="utf-8"))
except Exception:
    ov = {"roles": {}}

for role, extra in (ov.get("roles") or {}).items():
    if role not in payload["roles"]:
        payload["roles"][role] = {
            "allowed_read_paths": [],
            "allowed_write_paths": [],
            "forbidden_paths": [],
        }
    for key in ("allowed_read_paths", "allowed_write_paths", "forbidden_paths"):
        merged = payload["roles"][role].get(key, []) + list((extra or {}).get(key, []))
        payload["roles"][role][key] = dedup([normalize_path(str(v)) for v in merged])

payload["overrides_path"] = str(overrides.relative_to(root))
effective.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"status": "ok", "effective": str(effective), "version": payload["version"]}))
PY
