#!/usr/bin/env bash
set -euo pipefail

# Detects workspace file changes for a task run and records a summarized change
# report.
# Inputs: task directory with a run_root recorded in meta.json.
# Side effects: rewrites workspace_change_report.json and may bump workspace
# change counters in meta.json.
# Failure model: exits non-zero when task metadata or run_root is missing.

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
REFRESH_SCRIPT="$ROOT/agent-orchestrator/scripts/workspace_refresh_manifest.sh"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
META="$TASK_DIR/meta.json"
[[ -f "$META" ]] || { echo "meta missing"; exit 1; }

RUN_ROOT="$(jq -r '.run_root // ""' "$META")"
[[ -n "$RUN_ROOT" ]] || { echo "run_root missing in meta"; exit 1; }
[[ -d "$RUN_ROOT" ]] || { echo "run_root not found"; exit 1; }

OUT_JSON="$RUN_ROOT/workspace_change_report.json"
MANIFEST_RESULT="$($REFRESH_SCRIPT "$RUN_ROOT")"
CHANGED_COUNT="$(printf '%s' "$MANIFEST_RESULT" | jq -r '.changed_count // 0')"
CHANGED_FILES_JSON="$(printf '%s' "$MANIFEST_RESULT" | jq -c '.changed_files // []')"
TOP_CHANGED_FILES_JSON="$(printf '%s' "$CHANGED_FILES_JSON" | jq -c '.[0:20]')"
TOP_CHANGED_FILES="$(printf '%s' "$TOP_CHANGED_FILES_JSON" | jq -r '[.[].path]')"

KEY_HITS=0
if find "$RUN_ROOT/workspace" -type f \( -name 'interface.json' -o -name 'package.json' -o -name 'pyproject.toml' -o -name 'Dockerfile' \) 2>/dev/null | grep -q .; then
  KEY_HITS=1
fi

# The semantic score is a lightweight heuristic that combines raw change count
# with the presence of high-signal files.
SEMANTIC_SCORE="$(python3 - <<PY
c=$CHANGED_COUNT
k=$KEY_HITS
score=min(1.0, c/10.0 + k*0.4)
print(f"{score:.3f}")
PY
)"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

jq -n \
  --arg generated_at "$NOW" \
  --argjson changed_count "$CHANGED_COUNT" \
  --argjson key_hits "$KEY_HITS" \
  --arg semantic_score "$SEMANTIC_SCORE" \
  --argjson changed_files "$TOP_CHANGED_FILES" \
  --argjson changed_files_raw "$TOP_CHANGED_FILES_JSON" \
  '{
    generated_at:$generated_at,
    changed_count:$changed_count,
    key_path_hits:$key_hits,
    semantic_score:($semantic_score|tonumber),
    changed_files:$changed_files,
    changed_files_raw:$changed_files_raw
  }' > "$OUT_JSON"

if [[ "$CHANGED_COUNT" -gt 0 ]]; then
  TMP_META="$(mktemp "$TASK_DIR/.meta.wschange.XXXXXX.json")"
  jq \
    --arg now "$NOW" \
    '.workspace_user_change_seq = ((.workspace_user_change_seq // 0) + 1)
    | .dirty_state = true
    | .updated_at = $now' "$META" > "$TMP_META" && mv "$TMP_META" "$META"
fi

cat "$OUT_JSON"
