#!/usr/bin/env bash
set -euo pipefail

# Wraps keeper scheduler execution for one-shot runs, loop mode, or a simple
# local daemon lifecycle.
# Inputs: mode flag plus optional loop iteration count.
# Side effects: may start/stop a background scheduler and rewrite pid/log files.
# Failure model: exits non-zero on invalid usage or scheduler failures.

MODE="${1:---once}" # --once | --loop | --daemon-start | --daemon-stop | --daemon-status
ITERATIONS="${2:-0}"

SCHEDULER="keeper/scripts/keeper_scheduler.sh"
PID_FILE="templates/coordination/orchestrator/.keeper-scheduler.pid"
LOG_FILE="templates/coordination/orchestrator/keeper-scheduler.log"

mkdir -p "$(dirname "$PID_FILE")"

start_daemon() {
  # Clear stale pid files before relaunching so daemon state tracks a live
  # process only.
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "keeper daemon already running pid=$pid"
      exit 0
    fi
    rm -f "$PID_FILE"
  fi
  nohup bash "$SCHEDULER" --loop 0 >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "keeper daemon started pid=$(cat "$PID_FILE")"
}

stop_daemon() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "keeper daemon not running"
    exit 0
  fi
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" || true
    sleep 0.5
    # Escalate only if the graceful stop did not clear the process.
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" || true
    fi
  fi
  rm -f "$PID_FILE"
  echo "keeper daemon stopped"
}

status_daemon() {
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "keeper daemon running pid=$pid"
      exit 0
    fi
  fi
  echo "keeper daemon not running"
}

case "$MODE" in
  --once)
    bash "$SCHEDULER" --once
    ;;
  --loop)
    bash "$SCHEDULER" --loop "$ITERATIONS"
    ;;
  --daemon-start)
    start_daemon
    ;;
  --daemon-stop)
    stop_daemon
    ;;
  --daemon-status)
    status_daemon
    ;;
  *)
    echo "usage: $0 [--once|--loop <iterations>|--daemon-start|--daemon-stop|--daemon-status]"
    exit 2
    ;;
esac
