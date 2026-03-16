#!/usr/bin/env bash
set -euo pipefail

# Builds a dashboard snapshot from task metadata under the coordination tree.
# Inputs: optional source root plus markdown/json output paths.
# Side effects: rewrites the dashboard artifacts after generating temp files.
# Failure model: exits non-zero when jq/find or approval validation fails.

ROOT="${1:-templates/coordination/tasks/task_folders}"
OUT_MD="${2:-templates/coordination/orchestrator/dashboard.md}"
OUT_JSON="${3:-templates/coordination/orchestrator/dashboard.json}"
VALIDATE_APPROVAL_SCRIPT="agent-orchestrator/scripts/validate_approval.sh"
KEEPER_REPORT_JSON="templates/coordination/orchestrator/keeper-report.json"

mkdir -p "$(dirname "$OUT_MD")"
mkdir -p "$(dirname "$OUT_JSON")"

# Stage intermediate data in temp files so the published dashboard only updates
# after the full aggregation succeeds.
tmp_lines="$(mktemp)"
tmp_json="$(mktemp)"
tmp_md="$(mktemp)"
trap 'rm -f "$tmp_lines" "$tmp_json" "$tmp_md"' EXIT

if [[ -d "$ROOT" ]]; then
  while IFS= read -r -d '' meta; do
    task_dir="${meta%/meta.json}"
    if [[ "$(basename "$task_dir")" == "_task_id_" ]]; then
      continue
    fi
    has_lock=false
    if [[ -f "$task_dir/.lock" ]]; then
      has_lock=true
    fi
    approval_id=""
    if [[ -f "$task_dir/approval.json" ]]; then
      # Only surface approval ids that still validate against the audit source
      # of truth; expired or malformed approvals should look absent.
      if "$VALIDATE_APPROVAL_SCRIPT" "$task_dir" >/dev/null 2>&1; then
        approval_id="$(jq -r '.approval_id // empty' "$task_dir/approval.json")"
      fi
    fi

    jq -c \
      --arg task_dir "$task_dir" \
      --argjson has_lock "$has_lock" \
      --arg approval_id "$approval_id" \
      '. + { _task_dir: $task_dir, _has_lock: $has_lock, _approval_id: $approval_id }' \
      "$meta" >> "$tmp_lines"
  done < <(find "$ROOT" -mindepth 2 -maxdepth 2 -name meta.json -print0 | sort -z)
fi

if [[ ! -s "$tmp_lines" ]]; then
  # Publish an empty but well-formed dashboard when no tasks exist so downstream
  # readers can keep the same schema.
  cat > "$tmp_json" <<EOF
{"generated_at":"","source_root":"$ROOT","active_pipelines":[],"pending_actions":[],"system_health":{"open_tasks":0,"blocked_tasks":0,"stale_locks":[],"stale_in_progress":[]}}
EOF
else
  jq -s --arg root "$ROOT" '
    def now_iso: (now | todateiso8601);
    def pct(used; max): if (max // 0) > 0 then ((used // 0) / max * 100) else 0 end;
    map(select(.state != "CLOSED")) as $open
    | {
        generated_at: now_iso,
        source_root: $root,
        active_pipelines: (
          $open
          | map({
              task_id: .id,
              state: .state,
              stage: .stage,
              owner: .owner,
              risk_level: .risk_level,
              budget_token_pct: (pct(.consumption.token_cost_used; .budget.max_token_cost) | floor),
              budget_time_pct: (pct(.consumption.execution_time_used_seconds; .budget.max_execution_time_seconds) | floor),
              updated_at: .updated_at
            })
        ),
        pending_actions: (
          $open
          | map(
              if .state == "BLOCKED_PENDING_APPROVAL" then
                {task_id: .id, action: "WAIT_APPROVAL", owner: "master", reason: (.last_error // "approval required"), approval_id: (._approval_id // "")}
              elif .state == "BLOCKED_AWAITING_CLARIFICATION" then
                {task_id: .id, action: "ANSWER_CLARIFICATION", owner: "requester", reason: (.last_error // "clarification required"), approval_id: ""}
              elif ((pct(.consumption.token_cost_used; .budget.max_token_cost) >= 100)
                  or (pct(.consumption.execution_time_used_seconds; .budget.max_execution_time_seconds) >= 100))
                   and ((._approval_id // "") == "") then
                {task_id: .id, action: "APPROVE_OVER_BUDGET", owner: "master", reason: "budget exhausted", approval_id: (._approval_id // "")}
              else empty end
            )
        ),
        system_health: {
          open_tasks: ($open | length),
          blocked_tasks: ($open | map(select(.state | startswith("BLOCKED_"))) | length),
          stale_locks: ($open | map(select(._has_lock == true) | .id)),
          stale_in_progress: (
            $open
            | map(select(.state == "IN_PROGRESS"))
            | map(select((.updated_at | fromdateiso8601? // now) < (now - 3600)))
            | map(.id)
          )
        }
      }
  ' "$tmp_lines" > "$tmp_json"
fi

jq -r '
  "# Dashboard Summary\n\n"
  + "Generated at: \(.generated_at)\n\n"
  + "## Active Pipelines\n\n"
  + "| task_id | state | stage | owner | risk_level | token% | time% | updated_at |\n"
  + "|---|---|---|---|---|---|---|---|\n"
  + ((.active_pipelines | map("| \(.task_id) | \(.state) | \(.stage) | \(.owner) | \(.risk_level) | \(.budget_token_pct) | \(.budget_time_pct) | \(.updated_at) |")) | join("\n"))
  + "\n\n## Pending Actions\n\n"
  + "| task_id | action | owner | approval_id | reason |\n"
  + "|---|---|---|---|---|\n"
  + ((.pending_actions | map("| \(.task_id) | \(.action) | \(.owner) | \(.approval_id) | \(.reason) |")) | join("\n"))
  + "\n\n## System Health\n\n"
  + "- open_tasks: \(.system_health.open_tasks)\n"
  + "- blocked_tasks: \(.system_health.blocked_tasks)\n"
  + "- stale_locks: \((.system_health.stale_locks | join(", ")))\n"
  + "- stale_in_progress: \((.system_health.stale_in_progress | join(", ")))\n"
' "$tmp_json" > "$tmp_md"

if [[ -f "$KEEPER_REPORT_JSON" ]]; then
  # Keeper status is optional and should not block the main task dashboard.
  keeper_status="$(jq -r '.status // "UNKNOWN"' "$KEEPER_REPORT_JSON" 2>/dev/null || echo "UNKNOWN")"
  {
    echo ""
    echo "## Keeper"
    echo ""
    echo "- status: $keeper_status"
    echo "- report: templates/coordination/orchestrator/keeper-report.md"
  } >> "$tmp_md"
fi

# Atomic renames avoid leaving half-written dashboard outputs if the script is
# interrupted after generation.
mv "$tmp_json" "$OUT_JSON"
mv "$tmp_md" "$OUT_MD"

echo "dashboard written:"
echo "  $OUT_MD"
echo "  $OUT_JSON"
