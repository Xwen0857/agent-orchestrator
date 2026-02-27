#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
MULTI_ONCE_SCRIPT="$ROOT/agent-orchestrator/scripts/orchestrate_multi_once.sh"
TASKS_ROOT_DEFAULT="$ROOT/templates/coordination/tasks/task_folders"
STATE_DIR="$ROOT/templates/coordination/orchestrator"
PID_FILE="$STATE_DIR/.external-runner.pid"
LOG_FILE="$STATE_DIR/external-runner.log"
STATE_FILE="$STATE_DIR/.external-runner.state.json"

ACTION="${1:-}"
INTERVAL_SEC="${RUNNER_INTERVAL_SEC:-10}"
TASKS_ROOT="${TASKS_ROOT:-$TASKS_ROOT_DEFAULT}"
STATUS_FORMAT="${2:-text}"

usage() {
  cat <<'EOF'
usage:
  orchestrate_runner_daemon.sh start [interval_sec]
  orchestrate_runner_daemon.sh stop
  orchestrate_runner_daemon.sh status [--json]
EOF
}

run_loop() {
  local interval="${1:-10}"
  while true; do
    local tick_at
    local last_exit_code=0
    tick_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    "$MULTI_ONCE_SCRIPT" "$TASKS_ROOT" >> "$LOG_FILE" 2>&1 || last_exit_code=$?
    cat > "$STATE_FILE" <<EOF
{
  "last_tick_at": "$tick_at",
  "last_exit_code": "$last_exit_code"
}
EOF
    sleep "$interval"
  done
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_runner() {
  local interval="${1:-$INTERVAL_SEC}"
  if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 1 ]]; then
    echo "invalid interval_sec: $interval"
    exit 2
  fi
  if [[ ! -x "$MULTI_ONCE_SCRIPT" ]]; then
    echo "missing executable: $MULTI_ONCE_SCRIPT"
    exit 1
  fi
  mkdir -p "$STATE_DIR"

  if is_running; then
    echo "already_running pid=$(cat "$PID_FILE") log=$LOG_FILE"
    exit 0
  fi

  nohup "$0" _loop "$interval" >/dev/null 2>&1 &
  local pid="$!"
  echo "$pid" > "$PID_FILE"
  echo "started pid=$pid interval_sec=$interval tasks_root=$TASKS_ROOT log=$LOG_FILE"
}

stop_runner() {
  if ! [[ -f "$PID_FILE" ]]; then
    echo "not_running"
    exit 0
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
  echo "stopped"
}

status_runner() {
  local running=false
  local pid=0
  local last_tick_at=""
  local last_exit_code=""
  if [[ -f "$STATE_FILE" ]]; then
    last_tick_at="$(jq -r '.last_tick_at // empty' "$STATE_FILE" 2>/dev/null || true)"
    last_exit_code="$(jq -r '.last_exit_code // empty' "$STATE_FILE" 2>/dev/null || true)"
  fi
  if is_running; then
    pid="$(cat "$PID_FILE")"
    running=true
  fi

  if [[ "$STATUS_FORMAT" == "--json" ]]; then
    jq -cn \
      --argjson running "$running" \
      --argjson pid "${pid:-0}" \
      --arg log_file "$LOG_FILE" \
      --arg state_file "$STATE_FILE" \
      --arg last_tick_at "${last_tick_at:-}" \
      --arg last_exit_code "${last_exit_code:-}" \
      '{running:$running,pid:$pid,log_file:$log_file,state_file:$state_file,last_tick_at:$last_tick_at,last_exit_code:$last_exit_code}'
    return
  fi

  if [[ "$running" == "true" ]]; then
    echo "running pid=$pid log=$LOG_FILE"
    [[ -n "$last_tick_at" ]] && echo "last_tick_at=$last_tick_at last_exit_code=${last_exit_code:-n/a}"
    tail -n 5 "$LOG_FILE" 2>/dev/null || true
    return
  fi
  echo "not_running"
}

case "$ACTION" in
  start)
    start_runner "${2:-$INTERVAL_SEC}"
    ;;
  _loop)
    run_loop "${2:-$INTERVAL_SEC}"
    ;;
  stop)
    stop_runner
    ;;
  status)
    status_runner
    ;;
  *)
    usage
    exit 2
    ;;
esac
