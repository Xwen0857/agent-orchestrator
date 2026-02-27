#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---once}" # --once | --loop
ITERATIONS="${2:-0}" # used only for --loop; 0 means infinite

CONFIG="templates/coordination/planner/config/current.md"
PROPS="templates/coordination/planner/properties.md"
RUN_SCRIPT="keeper/scripts/keeper_run.sh"
LOCK_FILE="templates/coordination/orchestrator/.keeper-scheduler.lock"
LOG_FILE="templates/coordination/orchestrator/keeper-scheduler.log"

mkdir -p "$(dirname "$LOCK_FILE")"

acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    existing_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "keeper scheduler already running: $LOCK_FILE pid=$existing_pid"
      exit 1
    fi
    rm -f "$LOCK_FILE"
  fi
  echo "$$" > "$LOCK_FILE"
}

release_lock() {
  rm -f "$LOCK_FILE"
}

trap release_lock EXIT
acquire_lock

keeper_enabled="$(sed -n 's/^keeper_enabled:[[:space:]]*//p' "$CONFIG" | tail -n 1 | tr -d '\r')"
if [[ "$keeper_enabled" != "true" ]]; then
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") keeper disabled, scheduler exit" | tee -a "$LOG_FILE"
  exit 0
fi

cycle_minutes="$(sed -n 's/^- keeper_cycle_minutes:[[:space:]]*//p' "$PROPS" | tail -n 1 | tr -d '\r')"
if [[ -z "$cycle_minutes" ]]; then
  cycle_minutes=60
fi
sleep_seconds=$((cycle_minutes * 60))

run_once() {
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "$ts keeper cycle start" | tee -a "$LOG_FILE"
  if bash "$RUN_SCRIPT" >>"$LOG_FILE" 2>&1; then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") keeper cycle ok" | tee -a "$LOG_FILE"
  else
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") keeper cycle failed" | tee -a "$LOG_FILE"
  fi
}

if [[ "$MODE" == "--once" ]]; then
  run_once
  exit 0
fi

if [[ "$MODE" != "--loop" ]]; then
  echo "usage: $0 [--once|--loop] [iterations]"
  exit 2
fi

count=0
while true; do
  run_once
  count=$((count + 1))
  if [[ "$ITERATIONS" -gt 0 && "$count" -ge "$ITERATIONS" ]]; then
    break
  fi
  sleep "$sleep_seconds"
done

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") keeper scheduler finished iterations=$count" | tee -a "$LOG_FILE"
