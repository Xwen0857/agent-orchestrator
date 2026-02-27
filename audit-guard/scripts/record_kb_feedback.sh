#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 6 ]]; then
  echo "usage: $0 <entry_id> <task_id> <outcome> <intervention_source> <auditor_grade> <notes>"
  exit 2
fi

ENTRY_ID="$1"
TASK_ID="$2"
OUTCOME="$3"
INTERVENTION_SOURCE="$4"
AUDITOR_GRADE="$5"
NOTES="$6"

KB_FEEDBACK_SCRIPT="agent-orchestrator/scripts/kb_record_feedback.sh"
"$KB_FEEDBACK_SCRIPT" "$ENTRY_ID" "$TASK_ID" "audit-guard" "$OUTCOME" "$INTERVENTION_SOURCE" "$AUDITOR_GRADE" "true" "$NOTES"
