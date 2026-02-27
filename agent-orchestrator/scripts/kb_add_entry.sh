#!/usr/bin/env bash
set -euo pipefail

CONFIG="templates/coordination/planner/config/current.md"
keeper_enabled="$(sed -n 's/^keeper_enabled:[[:space:]]*//p' "$CONFIG" 2>/dev/null | tail -n 1 | tr -d '\r')"

# Conditional write policy:
# - keeper_enabled=true  => only keeper ingestion path can write entries.
# - keeper_enabled=false => direct write is allowed.
if [[ "$keeper_enabled" == "true" && "${KEEPER_MODE:-false}" != "true" ]]; then
  echo "kb_add_entry is keeper-gated because keeper_enabled=true. Submit via kb_submit_candidate.sh"
  exit 1
fi

if [[ $# -lt 5 ]]; then
  echo "usage: $0 <title> <tags_csv> <problem> <fix> <applicability_scope>"
  exit 2
fi

TITLE="$1"
TAGS="$2"
PROBLEM="$3"
FIX="$4"
SCOPE="$5"

DATE_PREFIX="$(date -u +%Y%m%d-%H%M%S)"
SLUG="$(printf "%s" "$TITLE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
ENTRY_ID="kb_${DATE_PREFIX}_$$"
FILE="knowledge-base/entries/${DATE_PREFIX}-${SLUG}.md"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$FILE" <<EOF
# Knowledge Entry

entry_id: $ENTRY_ID
title: $TITLE
tags: $TAGS
created_at: $NOW
last_verified_at: $NOW
applicability_scope: $SCOPE
score: 50
status: CANDIDATE
reuse_count: 0
success_count: 0
human_override_count: 0
auditor_signal: 0
last_scored_at: $NOW

## Problem
$PROBLEM

## Fix Pattern
$FIX
EOF

echo "$ENTRY_ID|$FILE"
