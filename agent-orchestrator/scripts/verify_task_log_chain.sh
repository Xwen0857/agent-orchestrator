#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <task_dir>"
  exit 2
fi

TASK_DIR="$1"
LOG="$TASK_DIR/log.ndjson"

if [[ ! -f "$LOG" ]]; then
  echo "log file missing: $LOG"
  exit 1
fi

line_no=0
prev_hash=""

while IFS= read -r line; do
  line_no=$((line_no + 1))
  if [[ -z "$line" ]]; then
    continue
  fi

  echo "$line" | jq -e . >/dev/null
  hash_prev="$(echo "$line" | jq -r '.hash_prev // ""')"
  hash_self="$(echo "$line" | jq -r '.hash_self // ""')"

  if [[ "$hash_prev" != "$prev_hash" ]]; then
    echo "chain mismatch at line=$line_no expected_prev=$prev_hash actual_prev=$hash_prev"
    exit 1
  fi

  payload="$(printf "%s" "$line" | jq -c 'del(.hash_self)')"
  recompute="$(printf "%s" "$payload" | shasum -a 256 | awk '{print $1}')"
  if [[ "$recompute" != "$hash_self" ]]; then
    echo "hash mismatch at line=$line_no expected=$hash_self recomputed=$recompute"
    exit 1
  fi

  prev_hash="$hash_self"
done < "$LOG"

echo "log chain valid: $LOG lines=$line_no"
