#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 8 ]]; then
  echo "usage: $0 <entry_id> <task_id> <actor> <outcome> <intervention_source> <auditor_grade> <reused:true|false> <notes>"
  exit 2
fi

ENTRY_ID="$1"
TASK_ID="$2"
ACTOR="$3"
OUTCOME="$4"
INTERVENTION_SOURCE="$5"
AUDITOR_GRADE="$6"
REUSED="$7"
NOTES="$8"

FEEDBACK_FILE="knowledge-base/feedback/kb_feedback.ndjson"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

case "$OUTCOME" in
  SUCCESS|FAIL|PARTIAL) ;;
  *)
    echo "invalid outcome: $OUTCOME"
    exit 1
    ;;
esac

case "$INTERVENTION_SOURCE" in
  SELF_HEAL|HUMAN_CORRECTION|HUMAN_OVERRIDE) ;;
  *)
    echo "invalid intervention_source: $INTERVENTION_SOURCE"
    exit 1
    ;;
esac

case "$AUDITOR_GRADE" in
  A|B|C|NONE) ;;
  *)
    echo "invalid auditor_grade: $AUDITOR_GRADE"
    exit 1
    ;;
esac

if [[ "$REUSED" != "true" && "$REUSED" != "false" ]]; then
  echo "invalid reused flag: $REUSED"
  exit 1
fi

jq -cn \
  --arg timestamp "$NOW" \
  --arg entry_id "$ENTRY_ID" \
  --arg task_id "$TASK_ID" \
  --arg actor "$ACTOR" \
  --arg outcome "$OUTCOME" \
  --arg intervention_source "$INTERVENTION_SOURCE" \
  --arg auditor_grade "$AUDITOR_GRADE" \
  --argjson reused "$REUSED" \
  --arg notes "$NOTES" \
  '{
    timestamp: $timestamp,
    entry_id: $entry_id,
    task_id: $task_id,
    actor: $actor,
    outcome: $outcome,
    intervention_source: $intervention_source,
    auditor_grade: $auditor_grade,
    reused: $reused,
    notes: $notes
  }' >> "$FEEDBACK_FILE"

echo "kb feedback recorded: entry_id=$ENTRY_ID task_id=$TASK_ID"
