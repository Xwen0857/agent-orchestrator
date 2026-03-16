#!/usr/bin/env bash
set -euo pipefail

# Builds the top-level orchestrator health report by combining task health, config drift,
# dashboard freshness, and keeper scheduler status.
# Inputs: optional task root, output JSON path, output markdown path, and stale threshold.
# Side effects: rewrites system-health output files and refreshes dashboard data.
# Failure model: exits non-zero on shell-level failures while individual sub-checks degrade into the output report.

ROOT="${1:-templates/coordination/tasks/task_folders}"
OUT_JSON="${2:-templates/coordination/orchestrator/system-health.json}"
OUT_MD="${3:-templates/coordination/orchestrator/system-health.md}"
STALE_SEC="${4:-3600}"

HEALTH_SCRIPT="agent-orchestrator/scripts/health_check.sh"
DASHBOARD_SCRIPT="agent-orchestrator/scripts/dashboard_summary.sh"
CONFIG="templates/coordination/planner/config/current.md"
PROPS="templates/coordination/planner/properties.md"
POINTER_FILE="templates/coordination/planner/config/current.pointer.json"
KEEPER_REPORT_JSON="templates/coordination/orchestrator/keeper-report.json"
KEEPER_PID_FILE="templates/coordination/orchestrator/.keeper-scheduler.pid"
KEEPER_LOCK_FILE="templates/coordination/orchestrator/.keeper-scheduler.lock"

# Ensure output directories exist before any health aggregation starts so later writes
# can be treated as atomic finalization steps.
mkdir -p "$(dirname "$OUT_JSON")"
mkdir -p "$(dirname "$OUT_MD")"

iso_to_epoch() {
  local ts="$1"
  local parsed
  parsed="$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null || true)"
  if [[ -n "$parsed" ]]; then
    echo "$parsed"
    return 0
  fi
  parsed="$(date -u -d "$ts" "+%s" 2>/dev/null || true)"
  if [[ -n "$parsed" ]]; then
    echo "$parsed"
    return 0
  fi
  date -u +%s
}

keeper_cycle_minutes="$(sed -n 's/^- keeper_cycle_minutes:[[:space:]]*//p' "$PROPS" | tail -n 1 | tr -d '\r')"
if [[ -z "$keeper_cycle_minutes" ]]; then
  keeper_cycle_minutes=60
fi
keeper_max_age_seconds=$((keeper_cycle_minutes * 120))
now_epoch="$(date -u +%s)"

# Task health is delegated to the lower-level checker; this script layers config and
# keeper state on top of that subsystem report.
health_json="$($HEALTH_SCRIPT "$ROOT" "$STALE_SEC")"
$DASHBOARD_SCRIPT "$ROOT" >/dev/null

config_pointer_present=false
config_history_present=false
config_drift=false
pointer_version_id=""
current_checksum=""
pointer_checksum=""

if [[ -f "$POINTER_FILE" ]]; then
  config_pointer_present=true
  pointer_version_id="$(jq -r '.current_version_id // ""' "$POINTER_FILE")"
  if [[ -n "$pointer_version_id" && -f "templates/coordination/planner/config/history/$pointer_version_id.md" ]]; then
    config_history_present=true
    current_checksum="$(shasum -a 256 templates/coordination/planner/config/current.md | awk '{print $1}')"
    pointer_checksum="$(shasum -a 256 "templates/coordination/planner/config/history/$pointer_version_id.md" | awk '{print $1}')"
    if [[ "$current_checksum" != "$pointer_checksum" ]]; then
      config_drift=true
    fi
  fi
fi

keeper_enabled="$(sed -n 's/^keeper_enabled:[[:space:]]*//p' "$CONFIG" | tail -n 1 | tr -d '\r')"
keeper_report_present=false
keeper_report_stale=false
keeper_status="DISABLED"
keeper_report_age_seconds=0

if [[ "$keeper_enabled" == "true" ]]; then
  keeper_status="MISSING"
  if [[ -f "$KEEPER_REPORT_JSON" ]]; then
    keeper_report_present=true
    keeper_status="$(jq -r '.status // "UNKNOWN"' "$KEEPER_REPORT_JSON")"
    report_ts="$(jq -r '.generated_at // ""' "$KEEPER_REPORT_JSON")"
    if [[ -n "$report_ts" ]]; then
      report_epoch="$(iso_to_epoch "$report_ts")"
      keeper_report_age_seconds=$((now_epoch - report_epoch))
      if [[ "$keeper_report_age_seconds" -gt "$keeper_max_age_seconds" ]]; then
        keeper_report_stale=true
      fi
    else
      keeper_report_stale=true
    fi
  fi
fi

keeper_pid_running=false
keeper_lock_present=false
keeper_lock_stale=false
if [[ -f "$KEEPER_PID_FILE" ]]; then
  pid="$(cat "$KEEPER_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    keeper_pid_running=true
  fi
fi
if [[ -f "$KEEPER_LOCK_FILE" ]]; then
  keeper_lock_present=true
  lock_mtime="$(stat -f "%m" "$KEEPER_LOCK_FILE" 2>/dev/null || stat -c "%Y" "$KEEPER_LOCK_FILE" 2>/dev/null || echo "$now_epoch")"
  lock_age=$((now_epoch - lock_mtime))
  if [[ "$lock_age" -gt "$keeper_max_age_seconds" ]] && [[ "$keeper_pid_running" != "true" ]]; then
    keeper_lock_stale=true
  fi
fi

issues_json="[]"
if [[ "$(printf '%s' "$health_json" | jq -r '.status')" != "HEALTHY" ]]; then
  issues_json="$(printf '%s' "$issues_json" | jq '. + ["task_health_degraded"]')"
fi
if [[ "$config_pointer_present" != "true" ]]; then
  issues_json="$(printf '%s' "$issues_json" | jq '. + ["config_pointer_missing"]')"
elif [[ "$config_history_present" != "true" ]]; then
  issues_json="$(printf '%s' "$issues_json" | jq '. + ["config_pointer_target_missing"]')"
elif [[ "$config_drift" == "true" ]]; then
  issues_json="$(printf '%s' "$issues_json" | jq '. + ["config_pointer_drift"]')"
fi
if [[ "$keeper_enabled" == "true" ]]; then
  if [[ "$keeper_report_present" != "true" ]]; then
    issues_json="$(printf '%s' "$issues_json" | jq '. + ["keeper_report_missing"]')"
  elif [[ "$keeper_report_stale" == "true" ]]; then
    issues_json="$(printf '%s' "$issues_json" | jq '. + ["keeper_report_stale"]')"
  fi
fi
if [[ "$keeper_lock_stale" == "true" ]]; then
  issues_json="$(printf '%s' "$issues_json" | jq '. + ["keeper_scheduler_lock_stale"]')"
fi

status="HEALTHY"
if [[ "$(printf '%s' "$issues_json" | jq 'length')" -gt 0 ]]; then
  status="DEGRADED"
fi

jq -n \
  --arg checked_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg status "$status" \
  --arg root "$ROOT" \
  --arg keeper_enabled "$keeper_enabled" \
  --arg keeper_status "$keeper_status" \
  --argjson keeper_report_present "$keeper_report_present" \
  --argjson keeper_report_stale "$keeper_report_stale" \
  --argjson keeper_report_age_seconds "$keeper_report_age_seconds" \
  --argjson keeper_pid_running "$keeper_pid_running" \
  --argjson keeper_lock_present "$keeper_lock_present" \
  --argjson keeper_lock_stale "$keeper_lock_stale" \
  --argjson config_pointer_present "$config_pointer_present" \
  --argjson config_history_present "$config_history_present" \
  --argjson config_drift "$config_drift" \
  --arg pointer_version_id "$pointer_version_id" \
  --arg current_checksum "$current_checksum" \
  --arg pointer_checksum "$pointer_checksum" \
  --argjson task_health "$health_json" \
  --argjson issues "$issues_json" \
  '{
    checked_at: $checked_at,
    status: $status,
    root: $root,
    issues: $issues,
    task_health: $task_health,
    config_health: {
      pointer_present: $config_pointer_present,
      pointer_history_present: $config_history_present,
      pointer_version_id: $pointer_version_id,
      drift: $config_drift,
      current_checksum_sha256: $current_checksum,
      pointer_checksum_sha256: $pointer_checksum
    },
    keeper_health: {
      keeper_enabled: ($keeper_enabled == "true"),
      keeper_status: $keeper_status,
      report_present: $keeper_report_present,
      report_stale: $keeper_report_stale,
      report_age_seconds: $keeper_report_age_seconds,
      scheduler_pid_running: $keeper_pid_running,
      scheduler_lock_present: $keeper_lock_present,
      scheduler_lock_stale: $keeper_lock_stale
    }
  }' > "$OUT_JSON"

jq -r '
  "# System Health Check\n\n"
  + "Checked at: \(.checked_at)\n\n"
  + "Status: \(.status)\n\n"
  + "## Issues\n\n"
  + (if (.issues | length) == 0 then "- none\n" else ((.issues | map("- " + .)) | join("\n")) + "\n" end)
  + "\n## Task Health\n\n"
  + "- status: \(.task_health.status)\n"
  + "- stale_in_progress: \(.task_health.stale_in_progress | length)\n"
  + "- orphan_locks: \(.task_health.orphan_locks | length)\n"
  + "- missing_artifacts: \(.task_health.missing_artifacts | length)\n"
  + "- invalid_log_chain: \(.task_health.invalid_log_chain | length)\n"
  + "\n## Config Health\n\n"
  + "- pointer_present: \(.config_health.pointer_present)\n"
  + "- pointer_history_present: \(.config_health.pointer_history_present)\n"
  + "- pointer_version_id: \(.config_health.pointer_version_id)\n"
  + "- drift: \(.config_health.drift)\n"
  + "\n## Keeper Health\n\n"
  + "- keeper_enabled: \(.keeper_health.keeper_enabled)\n"
  + "- keeper_status: \(.keeper_health.keeper_status)\n"
  + "- report_present: \(.keeper_health.report_present)\n"
  + "- report_stale: \(.keeper_health.report_stale)\n"
  + "- scheduler_pid_running: \(.keeper_health.scheduler_pid_running)\n"
  + "- scheduler_lock_present: \(.keeper_health.scheduler_lock_present)\n"
  + "- scheduler_lock_stale: \(.keeper_health.scheduler_lock_stale)\n"
' "$OUT_JSON" > "$OUT_MD"

echo "system health written:"
echo "  $OUT_MD"
echo "  $OUT_JSON"
