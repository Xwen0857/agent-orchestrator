#!/usr/bin/env bash
set -euo pipefail

# Loads planner-facing summary variables from a strategy JSON file.
# Inputs: path to a generated strategy JSON.
# Side effects: exports TASK_GOAL, summary fields, and PLANNER_GOAL into the
# current shell environment.
# Failure model: returns non-zero when the strategy path is missing or unreadable.

load_planner_strategy_summary() {
  local strategy_path="${1:-}"
  if [[ -z "$strategy_path" ]]; then
    echo "usage: load_planner_strategy_summary <strategy_json_path>" >&2
    return 2
  fi
  if [[ ! -f "$strategy_path" ]]; then
    echo "strategy missing: $strategy_path" >&2
    return 1
  fi

  TASK_GOAL="$(jq -r '.summary_input.task_goal // .goal // ""' "$strategy_path")"
  SUMMARY_CONSTRAINTS="$(jq -r '((.summary_input.constraints // []) | map(select(type == "string") | gsub("^[[:space:]]+|[[:space:]]+$"; "") | select(length > 0)) | join("; "))' "$strategy_path")"
  SUMMARY_DELIVERABLES="$(jq -r '((.summary_input.deliverables // []) | map(select(type == "string") | gsub("^[[:space:]]+|[[:space:]]+$"; "") | select(length > 0)) | join("; "))' "$strategy_path")"
  SUMMARY_NOTES="$(jq -r '((.summary_input.notes // []) | map(select(type == "string") | gsub("^[[:space:]]+|[[:space:]]+$"; "") | select(length > 0)) | join("; "))' "$strategy_path")"

  # Build a multi-line planner prompt from the structured summary fields so the
  # downstream planner can consume either the raw goal or the enriched context.
  PLANNER_GOAL="$TASK_GOAL"
  if [[ -n "$SUMMARY_CONSTRAINTS" ]]; then
    PLANNER_GOAL+=$'\n'"Constraints: $SUMMARY_CONSTRAINTS"
  fi
  if [[ -n "$SUMMARY_DELIVERABLES" ]]; then
    PLANNER_GOAL+=$'\n'"Deliverables: $SUMMARY_DELIVERABLES"
  fi
  if [[ -n "$SUMMARY_NOTES" ]]; then
    PLANNER_GOAL+=$'\n'"Notes: $SUMMARY_NOTES"
  fi

  export TASK_GOAL
  export SUMMARY_CONSTRAINTS
  export SUMMARY_DELIVERABLES
  export SUMMARY_NOTES
  export PLANNER_GOAL
}
