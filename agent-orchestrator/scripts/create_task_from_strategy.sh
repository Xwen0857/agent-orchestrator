#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <strategy_json> [tasks_root] [template_dir]"
  exit 2
fi

STRATEGY_JSON="$1"
TASKS_ROOT="${2:-templates/coordination/tasks/task_folders}"
TEMPLATE_DIR="${3:-$TASKS_ROOT/_task_id_}"

if [[ ! -f "$STRATEGY_JSON" ]]; then
  echo "strategy json not found: $STRATEGY_JSON"
  exit 1
fi

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "template dir not found: $TEMPLATE_DIR"
  exit 1
fi

if ! jq -e . "$STRATEGY_JSON" >/dev/null 2>&1; then
  echo "invalid json: $STRATEGY_JSON"
  exit 1
fi

TASK_ID="$(jq -r '.task_id // empty' "$STRATEGY_JSON")"
TITLE="$(jq -r '.title // empty' "$STRATEGY_JSON")"
GOAL="$(jq -r '.goal // empty' "$STRATEGY_JSON")"
OWNER="$(jq -r '.owner // empty' "$STRATEGY_JSON")"
RISK_LEVEL="$(jq -r '.risk_level // empty' "$STRATEGY_JSON")"
MAX_TOKEN="$(jq -r '.budget.max_token_cost // empty' "$STRATEGY_JSON")"
MAX_TIME="$(jq -r '.budget.max_execution_time_seconds // empty' "$STRATEGY_JSON")"
PROJECT_ID="$(jq -r '.workspace.project_id // empty' "$STRATEGY_JSON")"
WORKSPACE_ROOT_HINT="$(jq -r '.workspace.workspace_root // empty' "$STRATEGY_JSON")"
WORKSPACE_SOURCE="$(jq -r '.workspace.source // empty' "$STRATEGY_JSON")"

if [[ -z "$TASK_ID" || -z "$TITLE" || -z "$GOAL" || -z "$OWNER" || -z "$RISK_LEVEL" || -z "$MAX_TOKEN" || -z "$MAX_TIME" ]]; then
  echo "strategy missing required fields"
  exit 1
fi

case "$RISK_LEVEL" in
  LOW|MEDIUM|HIGH|CRITICAL) ;;
  *)
    echo "invalid risk_level: $RISK_LEVEL"
    exit 1
    ;;
esac

if [[ ! "$TASK_ID" =~ ^task_[a-zA-Z0-9._-]+$ ]]; then
  echo "invalid task_id: $TASK_ID"
  exit 1
fi

if ! [[ "$MAX_TOKEN" =~ ^[0-9]+$ ]] || ! [[ "$MAX_TIME" =~ ^[0-9]+$ ]]; then
  echo "invalid budget values"
  exit 1
fi

if [[ -n "$PROJECT_ID" ]] && [[ ! "$PROJECT_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid workspace.project_id: $PROJECT_ID"
  exit 1
fi

if [[ -n "$WORKSPACE_ROOT_HINT" ]]; then
  if [[ "$WORKSPACE_ROOT_HINT" == /* ]]; then
    echo "workspace.workspace_root must be relative"
    exit 1
  fi
  if [[ "$WORKSPACE_ROOT_HINT" == *".."* ]]; then
    echo "workspace.workspace_root cannot contain .."
    exit 1
  fi
fi

if [[ -n "$WORKSPACE_SOURCE" ]]; then
  case "$WORKSPACE_SOURCE" in
    run_flag|path_default|runtime_default) ;;
    *)
      echo "invalid workspace.source: $WORKSPACE_SOURCE"
      exit 1
      ;;
  esac
fi

mkdir -p "$TASKS_ROOT"
TASKS_ROOT_ABS="$(cd "$TASKS_ROOT" && pwd -P)"
TASK_DIR="$TASKS_ROOT/$TASK_ID"
if [[ -e "$TASK_DIR" ]]; then
  echo "task already exists: $TASK_DIR"
  exit 1
fi
mkdir -p "$TASK_DIR"
TASK_DIR_ABS="$(cd "$TASK_DIR" && pwd -P)"

if [[ "$TASK_DIR_ABS" != "$TASKS_ROOT_ABS/"* ]]; then
  echo "refusing out-of-root task dir: $TASK_DIR_ABS"
  exit 1
fi

cp -R "$TEMPLATE_DIR/." "$TASK_DIR/"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

jq -n \
  --arg id "$TASK_ID" \
  --arg owner "$OWNER" \
  --arg risk_level "$RISK_LEVEL" \
  --arg project_id "$PROJECT_ID" \
  --arg workspace_root_hint "$WORKSPACE_ROOT_HINT" \
  --arg workspace_source "$WORKSPACE_SOURCE" \
  --arg created_at "$NOW" \
  --arg updated_at "$NOW" \
  --argjson max_token "$MAX_TOKEN" \
  --argjson max_time "$MAX_TIME" \
  '{
    id: $id,
    state: "CREATED",
    stage: "INTAKE",
    owner: $owner,
    risk_level: $risk_level,
    version: 1,
    budget: {
      max_token_cost: $max_token,
      max_execution_time_seconds: $max_time
    },
    consumption: {
      token_cost_used: 0,
      execution_time_used_seconds: 0,
      external_calls_used: 0
    },
    created_at: $created_at,
    updated_at: $updated_at,
    parents: [],
    artifacts: [
      { kind: "plan", path: "plan.md" },
      { kind: "work", path: "work.md" },
      { kind: "test", path: "test.md" },
      { kind: "audit", path: "audit.md" }
    ],
    knowledge_refs: [],
    last_error: ""
  }
  | if ($project_id|length) > 0 then .project_id = $project_id else . end
  | if ($workspace_root_hint|length) > 0 then .workspace_root_hint = $workspace_root_hint else . end
  | if ($workspace_source|length) > 0 then .workspace_config_source = $workspace_source else . end' > "$TASK_DIR/meta.json"

: > "$TASK_DIR/log.ndjson"
cp "$STRATEGY_JSON" "$TASK_DIR/${TASK_ID}.strategy.json"

if [[ -f "$TASK_DIR/plan.md" ]]; then
  PLAN_TMP="$(mktemp "$TASK_DIR/.plan.XXXXXX")"
  awk -v goal="$GOAL" '
    BEGIN { replaced = 0 }
    {
      if ($0 ~ /^- Goal:[[:space:]]*$/) {
        print "- Goal: " goal
        replaced = 1
      } else {
        print
      }
    }
    END {
      if (replaced == 0) {
        print ""
        print "- Goal: " goal
      }
    }
  ' "$TASK_DIR/plan.md" > "$PLAN_TMP"
  mv "$PLAN_TMP" "$TASK_DIR/plan.md"
fi

echo "$TASK_DIR"
