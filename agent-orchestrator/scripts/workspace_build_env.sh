#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <run_root> [profile]"
  exit 2
fi

RUN_ROOT="$1"
PROFILE_OVERRIDE="${2:-}"
ENVSPEC="$RUN_ROOT/.envspec.json"
REPORT="$RUN_ROOT/env_build_report.json"
BUILD_MANIFEST="$RUN_ROOT/build_manifest.json"

[[ -d "$RUN_ROOT" ]] || { echo "run_root not found: $RUN_ROOT"; exit 1; }
[[ -f "$ENVSPEC" ]] || { echo "envspec missing: $ENVSPEC"; exit 1; }

PROFILE="${PROFILE_OVERRIDE:-$(jq -r '.profile // "local-venv"' "$ENVSPEC" 2>/dev/null || echo local-venv)}"
STATUS="PASS"
DETAILS=""
CMD_RUN=""
BUILD_OUT_DIR="$(jq -r '.build.output_dir // "build"' "$ENVSPEC" 2>/dev/null || echo build)"
DIST_OUT_DIR="$(jq -r '.build.release_dir // "dist"' "$ENVSPEC" 2>/dev/null || echo dist)"
mkdir -p "$RUN_ROOT/$BUILD_OUT_DIR" "$RUN_ROOT/$DIST_OUT_DIR" "$RUN_ROOT/.cache" "$RUN_ROOT/env"

case "$PROFILE" in
  local-venv)
    VENV_REL="$(jq -r '.python.venv_dir // "env/venv"' "$ENVSPEC" 2>/dev/null || echo env/venv)"
    VENV_PATH="$RUN_ROOT/$VENV_REL"
    if [[ ! -x "$VENV_PATH/bin/python" ]]; then
      python3 -m venv "$VENV_PATH"
      DETAILS="created venv at $VENV_REL"
    else
      DETAILS="venv exists at $VENV_REL"
    fi
    CMD_RUN="python3 -m venv $VENV_REL"
    ;;
  node-pnpm)
    if ! command -v pnpm >/dev/null 2>&1; then
      STATUS="FAIL"
      DETAILS="pnpm not found"
    else
      if [[ -f "$RUN_ROOT/workspace/package.json" ]]; then
        (cd "$RUN_ROOT/workspace" && pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1)
        DETAILS="pnpm deps installed in workspace"
      else
        DETAILS="package.json missing; skipped"
      fi
    fi
    CMD_RUN="pnpm install"
    ;;
  custom-script)
    CUSTOM_CMD="$(jq -r '.custom.command // ""' "$ENVSPEC" 2>/dev/null || echo '')"
    if [[ -z "$CUSTOM_CMD" ]]; then
      STATUS="FAIL"
      DETAILS="custom.command is empty"
    else
      (cd "$RUN_ROOT" && sh -lc "$CUSTOM_CMD")
      DETAILS="custom command executed"
      CMD_RUN="$CUSTOM_CMD"
    fi
    ;;
  *)
    STATUS="FAIL"
    DETAILS="unsupported env profile: $PROFILE"
    ;;
esac

jq -n \
  --arg status "$STATUS" \
  --arg profile "$PROFILE" \
  --arg details "$DETAILS" \
  --arg command "$CMD_RUN" \
  --arg generated_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{status:$status,profile:$profile,details:$details,command:$command,generated_at:$generated_at}' > "$REPORT"

python3 - "$RUN_ROOT" "$BUILD_OUT_DIR" "$DIST_OUT_DIR" "$BUILD_MANIFEST" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

run_root = Path(sys.argv[1]).resolve()
build_dir = run_root / sys.argv[2]
dist_dir = run_root / sys.argv[3]
out = Path(sys.argv[4]).resolve()

def collect(base: Path):
    rows = []
    if not base.exists():
        return rows
    for p in sorted(base.rglob("*")):
        if p.is_file():
            rows.append({
                "path": p.relative_to(run_root).as_posix(),
                "size": p.stat().st_size,
            })
    return rows

build_files = collect(build_dir)
dist_files = collect(dist_dir)
payload = {
    "schema_version": "workspace-build-manifest-v1",
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "build_dir": str(build_dir.relative_to(run_root)),
    "dist_dir": str(dist_dir.relative_to(run_root)),
    "build_file_count": len(build_files),
    "dist_file_count": len(dist_files),
    "build_files": build_files,
    "dist_files": dist_files,
}
out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

if [[ "$STATUS" == "PASS" ]]; then
  jq -cn --arg status "$STATUS" --arg profile "$PROFILE" --arg report "$REPORT" --arg build_manifest "$BUILD_MANIFEST" '{status:$status,profile:$profile,report:$report,build_manifest:$build_manifest}'
  exit 0
fi

jq -cn --arg status "$STATUS" --arg profile "$PROFILE" --arg report "$REPORT" --arg details "$DETAILS" --arg build_manifest "$BUILD_MANIFEST" '{status:$status,profile:$profile,report:$report,details:$details,build_manifest:$build_manifest}'
exit 1
